package com.ssafy.b102.recommendation.service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.dto.PopularBooksResponse;
import com.ssafy.b102.book.service.PopularBookService;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.entity.KdcMainClass;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiRecommendationClient;
import com.ssafy.b102.recommendation.config.RecommendationProperties;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest.RecommendationWeights;
import com.ssafy.b102.recommendation.dto.AiRecommendationResponse;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.search.service.AuthorNameParser;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

@Service
public class RecommendationService {

	private static final RecommendationWeights DEFAULT_WEIGHTS = new RecommendationWeights(0.45, 0.25, 0.15, 0.10, 0.05);
	private static final String DEFAULT_REASON_TYPE = "SEGMENT_POPULAR";
	private static final String DEFAULT_REASON_TEXT = "지금 추천 후보로 살펴볼 만한 책이에요.";
	private static final String POPULAR_MODEL_VERSION = "segment-popular-v1";
	private static final String POPULAR_INDEX_VERSION = "book-loaned-top20";

	private static final Logger log = LoggerFactory.getLogger(RecommendationService.class);

	private final AiRecommendationClient aiClient;
	private final UserService userService;
	private final UserInterestRepository userInterestRepository;
	private final LibraryItemRepository libraryItemRepository;
	private final BookRepository bookRepository;
	private final PopularBookService popularBookService;
	private final RecommendationProperties properties;
	private final RecommendationSnapshotService snapshots;
	private final Clock clock;

	public RecommendationService(AiRecommendationClient aiClient, UserService userService,
		UserInterestRepository userInterestRepository, LibraryItemRepository libraryItemRepository,
		BookRepository bookRepository, PopularBookService popularBookService,
		RecommendationProperties properties, RecommendationSnapshotService snapshots, Clock clock) {
		this.aiClient = aiClient;
		this.userService = userService;
		this.userInterestRepository = userInterestRepository;
		this.libraryItemRepository = libraryItemRepository;
		this.bookRepository = bookRepository;
		this.popularBookService = popularBookService;
		this.properties = properties;
		this.snapshots = snapshots;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public RecommendationResponse recommend(Long userId, int requestedSize, List<String> requestedTags) {
		if (!userService.getUser(userId).isOnboarded()) {
			throw new BusinessException(ErrorCode.ONBOARDING_REQUIRED);
		}

		int size = Math.min(requestedSize, properties.maxSize());
		List<LibraryItem> library = libraryItemRepository.findByUser_IdOrderByUpdatedAtDesc(userId);
		List<String> excludeIsbns = distinct(library.stream().map(item -> item.getBook().getIsbn13()).toList());
		List<String> seedIsbns = distinct(library.stream()
			.filter(item -> item.getStatus() == ShelfStatus.READ && item.getRating() != null)
			.sorted(Comparator.comparing(LibraryItem::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
			.map(item -> item.getBook().getIsbn13())
			.limit(20)
			.toList());

		List<String> rawTags = requestedTags == null || requestedTags.isEmpty()
			? userInterestRepository.findTagCodesByUserId(userId)
			: requestedTags;
		List<String> aiTagCodes = new ArrayList<>(AiTagCodeMapper.map(rawTags).keySet());
		List<AiRecommendationRequest.TagPreference> tags = aiTagCodes.stream()
			.map(code -> new AiRecommendationRequest.TagPreference(code, 1.0))
			.toList();
		String mode = seedIsbns.isEmpty() && tags.isEmpty() ? "COLD_START" : "PERSONALIZED";
		Instant generatedAt = Instant.now(clock);
		if ("COLD_START".equals(mode)) {
			RecommendationResponse popularResponse = fromSegmentPopularity(userId, size, excludeIsbns, generatedAt);
			if (popularResponse != null) {
				return persisted(userId, popularResponse);
			}
		}

		AiRecommendationRequest request = new AiRecommendationRequest(
			"req-" + UUID.randomUUID(), String.valueOf(userId), mode, size,
			seedIsbns, excludeIsbns, tags, DEFAULT_WEIGHTS);
		AiRecommendationResponse aiResponse = aiClient.recommend(request);
		return persisted(userId, toResponse(aiResponse, request, seedIsbns.size(), generatedAt));
	}

	/**
	 * 내보내는 덱을 그대로 저장한다 — 이벤트가 「보여줬는데 안 눌렀다」를 계산할 때 쓰는 정본이다(API_SPEC §7).
	 * 저장 실패가 추천 화면을 막아서는 안 되므로 삼키고 로그만 남긴다.
	 */
	private RecommendationResponse persisted(Long userId, RecommendationResponse response) {
		try {
			snapshots.save(userId, response);
		}
		catch (RuntimeException e) {
			log.warn("추천 스냅샷 저장 실패 {} — 응답은 그대로 내보낸다: {}", response.recommendationId(), e.toString());
		}
		return response;
	}

	private RecommendationResponse fromSegmentPopularity(Long userId, int size, List<String> excludeIsbns,
		Instant generatedAt) {
		PopularBooksResponse popular = popularBookService.popularFor(userId, PopularBookService.MAX_SIZE);
		if (popular.items().isEmpty()) {
			return null;
		}

		List<BookSummaryResponse> candidates = popular.items().stream()
			.filter(book -> !excludeIsbns.contains(book.isbn13()))
			.limit(size)
			.toList();
		if (candidates.isEmpty()) {
			return null;
		}

		String reasonText = popular.segment() == null
			? "전체 이용자에게 많이 대출된 책이에요."
			: popular.segment().label() + "에서 많이 대출된 책이에요.";
		List<RecommendationResponse.Item> items = new ArrayList<>();
		for (int i = 0; i < candidates.size(); i++) {
			items.add(new RecommendationResponse.Item(
				candidates.get(i), i + 1, 100.0 - i, List.of(), List.of(),
				DEFAULT_REASON_TYPE, reasonText));
		}
		return new RecommendationResponse(
			"rec-" + UUID.randomUUID(), generatedAt, "COLD_START", true, 0,
			Map.of(), List.of(), POPULAR_MODEL_VERSION, POPULAR_INDEX_VERSION, items);
	}

	private RecommendationResponse toResponse(AiRecommendationResponse ai, AiRecommendationRequest request,
		int basedOnCount, Instant generatedAt) {
		List<String> isbns = ai.items().stream().map(AiRecommendationResponse.Item::isbn13)
			.filter(isbn -> isbn != null && !isbn.isBlank()).distinct().toList();
		Map<String, Book> books = isbns.isEmpty() ? Map.of() : bookRepository.findByIsbn13In(isbns).stream()
			.collect(Collectors.toMap(book -> book.getIsbn13().strip(), Function.identity(), (first, ignored) -> first, LinkedHashMap::new));

		List<RecommendationResponse.Item> items = new ArrayList<>();
		for (AiRecommendationResponse.Item item : ai.items()) {
			Book book = books.get(item.isbn13() == null ? "" : item.isbn13().strip());
			if (book == null) {
				continue;
			}
			AiRecommendationResponse.Reason reason = item.primaryReason();
			String reasonType = reason == null || reason.type() == null ? DEFAULT_REASON_TYPE : reason.type();
			String reasonText = reason == null || reason.text() == null || reason.text().isBlank()
				? DEFAULT_REASON_TEXT : reason.text();
			items.add(new RecommendationResponse.Item(
				toSummary(book),
				item.rank() == null ? items.size() + 1 : item.rank(),
				item.score() == null ? 0.0 : item.score(),
				item.featureScores().entrySet().stream()
					.map(entry -> new RecommendationResponse.FeatureScore(entry.getKey(), entry.getValue())).toList(),
				AiTagCodeMapper.toPublicCodes(item.matchedTags()), reasonType, reasonText));
		}

		return new RecommendationResponse(
			ai.recommendationId(), generatedAt, request.mode(), ai.fallback(), basedOnCount,
			weightsAsMap(request.weights()),
			AiTagCodeMapper.toPublicCodes(request.tags().stream().map(AiRecommendationRequest.TagPreference::code).toList()),
			ai.modelVersion(), ai.indexVersion(), items);
	}

	private static BookSummaryResponse toSummary(Book book) {
		return new BookSummaryResponse(
			String.valueOf(book.getId()), book.getIsbn13().strip(), book.getTitle(),
			AuthorNameParser.parse(book.getAuthor()), book.getPublisher(),
			book.getPubYear() == null ? null : book.getPubYear().intValue(), book.getCoverUrl(), null,
			KdcMainClass.labelOf(book.getCategoryCode()), book.getCategoryCode());
	}

	private static Map<String, Double> weightsAsMap(RecommendationWeights weights) {
		Map<String, Double> result = new LinkedHashMap<>();
		result.put("semantic", weights.semantic());
		result.put("tagMatch", weights.tagMatch());
		result.put("coLoan", weights.coLoan());
		result.put("trending", weights.trending());
		result.put("steady", weights.steady());
		return result;
	}

	private static List<String> distinct(Collection<String> values) {
		return values.stream().filter(value -> value != null && !value.isBlank()).map(String::strip)
			.collect(Collectors.collectingAndThen(Collectors.toCollection(LinkedHashSet::new), List::copyOf));
	}
}
