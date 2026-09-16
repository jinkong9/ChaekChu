package com.ssafy.b102.recommendation.service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiBookDnaClient;
import com.ssafy.b102.recommendation.config.BookDnaProperties;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.dto.BookDnaResponse;
import com.ssafy.b102.recommendation.service.BookDnaProfileStore.StoredProfile;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

/**
 * GET /users/me/dna — 서재 스냅샷을 AI 에 보내 프로필을 받고 canonical 책 정보와 합친다.
 * 계약(BOOK_DNA_API_CONTRACT §1)이 백엔드 몫으로 적은 것: 인증 · 서재 조회 · AI 호출 · 공개 응답 · 캐시.
 *
 * 스냅샷(API_SPEC §3.4): READ 를 완독일 내림차순(null 마지막)으로 먼저, WISH 는 뒤 — 최대 {@value #MAX_BOOKS}권. WISH 가 많아도 READ 가 잘리지 않는다.
 * 캐시·폴백(계약 §5·§6): 프로필은 user_dna_profiles(V8) 에 사용자당 한 행으로 저장한다(BookDnaProfileStore).
 *   서재 지문(행수·마지막 변경·관심 태그)이 같고 TTL 안이면 AI 를 부르지 않는다.
 *   AI 가 503·타임아웃이면 저장된 마지막 프로필을 generatedAt 그대로 낸다 — 프론트는 그 시각으로 오래됨을 안다. 저장된 것이 없을 때만 DNA_UNAVAILABLE.
 *   저장 실패는 응답을 막지 않는다.
 * 트랜잭션을 걸지 않는다 — AI 호출(최대 15초)이 DB 커넥션을 물고 있지 않게. 서재 조회는 book 을 fetch join 해 와서 밖에서도 읽힌다.
 * books[].analyzed: AI 인덱스에서 찾아 계산에 반영됐는가. 인덱스가 추천 후보 약 45만 권이라 서재 책이 빠질 수 있다(내부 응답 unresolvedIsbns).
 */
@Service
public class BookDnaService {

	private static final Logger log = LoggerFactory.getLogger(BookDnaService.class);
	static final int MAX_BOOKS = 200;

	private final AiBookDnaClient aiClient;
	private final UserService userService;
	private final UserInterestRepository interestRepository;
	private final LibraryItemRepository libraryRepository;
	private final BookSummaryMapper summaryMapper;
	private final BookDnaProfileStore profileStore;
	private final BookDnaProperties properties;
	private final Clock clock;

	public BookDnaService(AiBookDnaClient aiClient, UserService userService,
		UserInterestRepository interestRepository, LibraryItemRepository libraryRepository,
		BookSummaryMapper summaryMapper, BookDnaProfileStore profileStore, BookDnaProperties properties, Clock clock) {
		this.aiClient = aiClient;
		this.userService = userService;
		this.interestRepository = interestRepository;
		this.libraryRepository = libraryRepository;
		this.summaryMapper = summaryMapper;
		this.profileStore = profileStore;
		this.properties = properties;
		this.clock = clock;
	}

	public BookDnaResponse getMine(Long userId) {
		userService.getUser(userId);
		List<LibraryItem> items = libraryRepository.findDnaSnapshot(userId, ShelfStatus.READ, PageRequest.of(0, MAX_BOOKS));
		List<String> declaredTags = AiTagCodeMapper.toPublicCodes(interestRepository.findTagCodesByUserId(userId));
		String fingerprint = profileStore.fingerprint(userId, declaredTags);
		Instant now = Instant.now(clock);

		Optional<StoredProfile> stored = profileStore.find(userId);
		if (stored.isPresent() && stored.get().isFresh(fingerprint, now, properties.cacheTtl())) {
			log.debug("Book DNA 저장 프로필 사용 userId={} generatedAt={}", userId, stored.get().generatedAt());
			return assemble(items, declaredTags, stored.get());
		}

		AiBookDnaRequest request = new AiBookDnaRequest(
			"dna-" + userId + "-" + UUID.randomUUID(), String.valueOf(userId), declaredTags, seeds(items));
		long started = System.nanoTime();
		AiBookDnaResponse ai;
		try {
			ai = aiClient.profile(request);
		}
		catch (BusinessException e) {
			if (e.code() == ErrorCode.DNA_UNAVAILABLE && stored.isPresent()) {
				// 계약 §5 — AI 장애가 DNA 화면을 비우지 않게 마지막 프로필로 답한다. generatedAt 이 옛 시각이라 프론트가 구분한다
				log.warn("Book DNA AI 실패 → 저장된 프로필로 대신 응답 requestId={} storedAt={}",
					request.requestId(), stored.get().generatedAt());
				return assemble(items, declaredTags, stored.get());
			}
			throw e;
		}
		StoredProfile fresh = StoredProfile.of(fingerprint, request.requestId(), ai, now);
		try {
			profileStore.save(userId, fresh);
		}
		catch (RuntimeException e) {
			log.warn("Book DNA 프로필 저장 실패 — 응답은 그대로 낸다 requestId={}: {}", request.requestId(), e.getMessage());
		}
		// 계약 §6: 로그에는 requestId·버전·도서 수·처리 시간만. ISBN·사용자 데이터는 남기지 않는다
		log.info("Book DNA 계산 requestId={} books={} unresolved={} status={} versions={}/{}/{}/{} elapsedMs={}",
			request.requestId(), items.size(), ai.unresolvedIsbns().size(),
			ai.profile() == null ? null : ai.profile().status(),
			fresh.dnaVersion(), fresh.modelVersion(), fresh.indexVersion(), fresh.tagVersion(),
			(System.nanoTime() - started) / 1_000_000);
		return assemble(items, declaredTags, fresh);
	}

	private static List<AiBookDnaRequest.Book> seeds(List<LibraryItem> items) {
		return items.stream()
			.map(item -> new AiBookDnaRequest.Book(
				item.getBook().getIsbn13(), item.getStatus().name(),
				item.getRating() == null ? null : item.getRating().intValue(), item.getFinishedAt()))
			.toList();
	}

	/** 책 목록은 항상 현재 서재, 프로필은 새것이든 저장된 것이든 넘어온 것. readCount = 스냅샷 안의 READ 수(온보딩 seed 포함). */
	private BookDnaResponse assemble(List<LibraryItem> items, List<String> declaredTags, StoredProfile profile) {
		Set<String> unresolved = Set.copyOf(profile.unresolvedIsbns());
		int readCount = (int) items.stream().filter(item -> item.getStatus() == ShelfStatus.READ).count();
		return new BookDnaResponse(
			profile.generatedAt(), profile.dnaVersion(), profile.modelVersion(), profile.indexVersion(), profile.tagVersion(),
			declaredTags, readCount,
			items.stream().map(item -> toBook(item, unresolved)).toList(),
			toProfile(profile.profile()));
	}

	private BookDnaResponse.Book toBook(LibraryItem item, Set<String> unresolved) {
		BookSummaryResponse summary = summaryMapper.from(item.getBook());
		return new BookDnaResponse.Book(summary.bookId(), summary.isbn13(), summary.title(), summary.authors(),
			summary.publisher(), summary.publicationYear(), summary.coverUrl(), summary.pageCount(), summary.category(),
			summary.classNo(), item.getStatus().name(), item.getRating() == null ? null : item.getRating().intValue(),
			item.getFinishedAt(), !unresolved.contains(item.getBook().getIsbn13()));
	}

	private static BookDnaResponse.Profile toProfile(AiBookDnaResponse.Profile profile) {
		if (profile == null) {
			return new BookDnaResponse.Profile("INSUFFICIENT_DATA", 0, List.of(), List.of(), List.of(), null,
				new BookDnaResponse.Evidence(0, 0, List.of(), List.of()));
		}
		return new BookDnaResponse.Profile(profile.status(), profile.basedOnCount(),
			profile.axes().stream().map(BookDnaService::toScore).toList(),
			profile.metrics().stream().map(BookDnaService::toScore).toList(),
			profile.keywords().stream().map(BookDnaService::toScore).toList(), toType(profile.type()),
			toEvidence(profile.evidence()));
	}

	private static BookDnaResponse.Score toScore(AiBookDnaResponse.Score score) {
		return new BookDnaResponse.Score(score.code(), score.label(), score.score());
	}

	private static BookDnaResponse.Type toType(AiBookDnaResponse.Type type) {
		return type == null ? null : new BookDnaResponse.Type(type.code(), type.name(), type.phrase(), type.summary());
	}

	private static BookDnaResponse.Evidence toEvidence(AiBookDnaResponse.Evidence evidence) {
		return evidence == null
			? new BookDnaResponse.Evidence(0, 0, List.of(), List.of())
			: new BookDnaResponse.Evidence(evidence.readBookCount(), evidence.ratedBookCount(), evidence.topGenres(), evidence.topTags());
	}
}
