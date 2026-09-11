package com.ssafy.b102.recommendation.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.recommendation.repository.RecommendationSnapshotRepository;
import com.ssafy.b102.recommendation.repository.RecommendationSnapshotRepository.ItemRow;

/**
 * 화면에 내보낸 추천 덱을 그대로 저장한다 — 「무엇을, 왜, 몇 점으로 골라 보냈나」의 정본.
 *
 * 이게 없으면 이벤트로 알 수 있는 것이 「무엇을 눌렀나」뿐이다. 안 누른 책이 무엇이었는지는 덱 안에만 있고,
 * 덱은 요청마다 새로 계산돼 사라진다(recommendationId 는 매 요청 새 UUID 의 해시다). 부정 신호와 품질 채점이 여기서 나온다.
 *
 * {@code REQUIRES_NEW} 인 이유: 부르는 쪽(RecommendationService.recommend)이 readOnly 트랜잭션이라
 * 같은 커넥션으로는 INSERT 가 거부된다. 저장이 실패해도 추천 응답은 그대로 나가야 하므로 예외는 부르는 쪽이 삼킨다.
 */
@Service
public class RecommendationSnapshotService {

	private static final int MAX_SCORE = 100;

	private static final Logger log = LoggerFactory.getLogger(RecommendationSnapshotService.class);

	private final RecommendationSnapshotRepository repository;
	private final ObjectMapper objectMapper;

	public RecommendationSnapshotService(RecommendationSnapshotRepository repository, ObjectMapper objectMapper) {
		this.repository = repository;
		this.objectMapper = objectMapper;
	}

	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void save(Long userId, RecommendationResponse response) {
		long recommendationId = repository.insertDeck(
			userId,
			response.recommendationId(),
			response.mode(),
			response.fallback(),
			response.basedOnCount(),
			json(response.weights(), "{}"),
			json(response.appliedTags(), "[]"),
			response.modelVersion(),
			response.indexVersion(),
			response.generatedAt());
		List<ItemRow> rows = itemRows(response);
		repository.insertItems(recommendationId, rows);
		log.debug("추천 스냅샷 저장 {} (사용자 {}, {}권)", response.recommendationId(), userId, rows.size());
	}

	/**
	 * 응답 항목 → 저장 행. 계약상 유니크한 값(rank · bookId)이 겹치면 그 항목만 버린다 —
	 * AI 가 같은 책을 두 번 주더라도 스냅샷 저장이 실패해 추천 응답까지 막는 일은 없어야 한다(uq_ri_rec_rank · uq_ri_rec_book).
	 */
	private List<ItemRow> itemRows(RecommendationResponse response) {
		List<ItemRow> rows = new ArrayList<>(response.items().size());
		Set<Integer> ranks = new HashSet<>();
		Set<Long> books = new HashSet<>();
		for (RecommendationResponse.Item item : response.items()) {
			Long bookId = parseId(item.book() == null ? null : item.book().bookId());
			if (bookId == null || !ranks.add(item.rank()) || !books.add(bookId)) {
				log.warn("추천 스냅샷 항목 제외 {} rank={} book={}", response.recommendationId(), item.rank(),
					item.book() == null ? null : item.book().bookId());
				continue;
			}
			rows.add(new ItemRow(bookId, item.rank(), clampScore(item.score()),
				json(item.tags(), "[]"), json(featureScores(item), "{}"),
				item.reasonType(), item.reasonText()));
		}
		return rows;
	}

	/** featureScores 를 { key: rawScore } 한 덩어리로. 값이 없는 feature 도 null 로 남긴다 — 계산에 안 쓰였다는 사실이 정보다. */
	private static Map<String, Double> featureScores(RecommendationResponse.Item item) {
		Map<String, Double> scores = new LinkedHashMap<>();
		if (item.featureScores() != null) {
			item.featureScores().forEach(score -> scores.put(score.key(), score.rawScore()));
		}
		return scores;
	}

	private String json(Object value, String fallback) {
		if (value == null) {
			return fallback;
		}
		try {
			return objectMapper.writeValueAsString(value);
		}
		catch (JsonProcessingException e) {
			log.warn("추천 스냅샷 JSON 직렬화 실패 — {} 로 대체한다: {}", fallback, e.toString());
			return fallback;
		}
	}

	private static Long parseId(String bookId) {
		try {
			return bookId == null ? null : Long.valueOf(bookId.strip());
		}
		catch (NumberFormatException e) {
			return null;
		}
	}

	/** ck_ri_score(0~100) 밖의 값은 잘라 넣는다. 저장은 분석용이라 경계에서 버릴 이유가 없다. */
	private static double clampScore(double score) {
		return Math.min(MAX_SCORE, Math.max(0, score));
	}
}
