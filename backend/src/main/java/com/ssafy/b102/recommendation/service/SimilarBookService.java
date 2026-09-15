package com.ssafy.b102.recommendation.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.SimilarBookResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.book.service.BookIdentifiers;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.recommendation.client.AiRecommendationClient;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest.RecommendationWeights;
import com.ssafy.b102.recommendation.dto.AiRecommendationResponse;

/**
 * API_SPEC §4.5 — 「비슷한 책」. 추천 엔진에 <b>기준 책 한 권만 seed 로</b> 넣은 것이다.
 *
 * AI 는 seed 의 벡터를 그대로 질의 벡터로 쓰고(태그가 없으면 가중 평균의 원소가 하나뿐이다) Qdrant 이웃을 찾는다.
 * 기준 책 자신은 AI 가 두 곳에서 제외한다(CandidateSearchRequest.hard_excluded_isbns · 폴백 정책의 필터).
 * 그래서 AI 쪽에 추가 구현이 없고 여기는 얇은 프록시다 — PostgreSQL 은 서지를 붙이는 데만 쓴다.
 *
 * 패키지 위치: 경로는 /books 아래지만 하는 일이 추천이라 recommendation 에 둔다.
 * recommendation → book 방향 의존은 이미 있고(RecommendationService), 반대로 두면 순환이 된다.
 */
@Service
public class SimilarBookService {

	public static final int DEFAULT_SIZE = 8;
	/** AI 계약이 size 를 1~10 으로 막는다(api.py RecommendationRequest.size). 넘겨 보내면 422 라 여기서 같은 값으로 제한한다. */
	public static final int MAX_SIZE = 10;

	/**
	 * 의미 유사도만 쓴다. 「비슷한 책」은 말 그대로 닮은 책이어야 하는데, trending·steady 에 가중치를 주면
	 * 덜 닮았지만 많이 빌린 책이 위로 올라온다. AI 는 가중치가 0 인 feature 를 분모에서 빼므로(reranking.score)
	 * 이 설정이면 최종 점수 = 의미 유사도다. 합이 1 일 필요는 없고 비율만 의미가 있다.
	 */
	private static final RecommendationWeights SEMANTIC_ONLY = new RecommendationWeights(1.0, 0, 0, 0, 0);

	private static final Logger log = LoggerFactory.getLogger(SimilarBookService.class);

	private final AiRecommendationClient aiClient;
	private final BookRepository bookRepository;
	private final BookSummaryMapper summaryMapper;

	public SimilarBookService(AiRecommendationClient aiClient, BookRepository bookRepository,
		BookSummaryMapper summaryMapper) {
		this.aiClient = aiClient;
		this.bookRepository = bookRepository;
		this.summaryMapper = summaryMapper;
	}

	@Transactional(readOnly = true)
	public SimilarBookResponse similar(String rawBookId, int size) {
		Book book = find(rawBookId);

		// [처리 ②] AI 계약이 seedIsbns 에 ^97[89]\d{10}$ 를 강제한다. ISBN 이 없는 책은 부르지 않는다 — 부르면 422 다.
		String isbn13 = book.getIsbn13() == null ? "" : book.getIsbn13().strip();
		if (!BookIdentifiers.isIsbn13(isbn13)) {
			log.debug("ISBN13 이 없어 비슷한 책을 건너뛴다 bookId={}", book.getId());
			return SimilarBookResponse.empty();
		}

		AiRecommendationRequest request = new AiRecommendationRequest(
			"similar-" + UUID.randomUUID(), "0", "PERSONALIZED", Math.min(size, MAX_SIZE),
			List.of(isbn13), List.of(), List.of(), SEMANTIC_ONLY);
		AiRecommendationResponse ai = aiClient.recommend(request);

		// [처리 ①] 기준 책의 벡터가 없으면 AI 가 수요 인기 도서로 대체하고 fallback=true 를 준다(RecommendationFallbackPolicy).
		//         추천 화면에서는 맞는 동작이지만 여기서는 「비슷한 책」이라는 제목 아래 무관한 베스트셀러가 뜨는 셈이라 버린다.
		if (ai.fallback()) {
			log.debug("벡터가 없어 폴백된 결과라 비운다 isbn13={} index={}", isbn13, ai.indexVersion());
			return SimilarBookResponse.empty();
		}

		List<SimilarBookResponse.Item> items = itemsOf(ai);
		if (items.isEmpty()) {
			return SimilarBookResponse.empty();
		}
		return new SimilarBookResponse(items, ai.modelVersion(), ai.indexVersion());
	}

	/** AI 가 준 ISBN 순서를 지키면서 카탈로그 서지를 붙인다. 카탈로그에 없는 ISBN 은 빠진다. */
	private List<SimilarBookResponse.Item> itemsOf(AiRecommendationResponse ai) {
		List<String> isbns = ai.items().stream()
			.map(AiRecommendationResponse.Item::isbn13)
			.filter(isbn -> isbn != null && !isbn.isBlank())
			.map(String::strip)
			.distinct()
			.toList();
		if (isbns.isEmpty()) {
			return List.of();
		}
		Map<String, Book> books = bookRepository.findByIsbn13In(isbns).stream()
			.collect(Collectors.toMap(b -> b.getIsbn13().strip(), Function.identity(),
				(first, ignored) -> first, LinkedHashMap::new));

		List<SimilarBookResponse.Item> items = new ArrayList<>(isbns.size());
		for (AiRecommendationResponse.Item item : ai.items()) {
			Book book = books.get(item.isbn13() == null ? "" : item.isbn13().strip());
			if (book == null) {
				continue;
			}
			items.add(new SimilarBookResponse.Item(
				summaryMapper.from(book), reasonOf(item), item.score() == null ? 0.0 : item.score()));
		}
		return List.copyOf(items);
	}

	/** AI 가 만든 한 문장. 없으면 이 경로의 뜻을 그대로 적는다 — 화면이 빈 칸을 그리지 않게. */
	private static String reasonOf(AiRecommendationResponse.Item item) {
		AiRecommendationResponse.Reason reason = item.primaryReason();
		if (reason == null || reason.text() == null || reason.text().isBlank()) {
			return "소개와 서지가 닮은 책이에요.";
		}
		return reason.text();
	}

	/** 13자리 ISBN 이면 isbn13 으로, 아니면 내부 id 로(§4.4 와 같은 규칙). 없으면 404. */
	private Book find(String rawBookId) {
		String id = BookIdentifiers.normalize(rawBookId);
		Long internalId = BookIdentifiers.isIsbn13(id) ? null : BookIdentifiers.asInternalId(id);
		return (BookIdentifiers.isIsbn13(id)
			? bookRepository.findByIsbn13(id)
			: internalId == null ? java.util.Optional.<Book>empty() : bookRepository.findById(internalId))
			.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", id)));
	}
}
