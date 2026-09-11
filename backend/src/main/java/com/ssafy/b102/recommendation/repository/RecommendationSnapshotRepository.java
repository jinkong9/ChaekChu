package com.ssafy.b102.recommendation.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/**
 * 추천 스냅샷 쓰기 — V1 의 recommendations · recommendation_items.
 *
 * JPA 엔티티를 만들지 않은 이유: 두 표 모두 JSONB 컬럼(weights · input_tags · tags · feature_scores)을 쓰는데
 * 읽는 쪽이 아직 없다(화면은 응답 객체를 그대로 받는다). 쓰기 전용이라 SQL 이 더 짧고, JSONB 컨버터도 필요 없다.
 * 이벤트가 되찾을 때 쓰는 것은 {@link #findIdByPublicId} 하나뿐이다.
 */
@Repository
public class RecommendationSnapshotRepository {

	/** 한 권의 추천 근거. score 는 0~100(ck_ri_score), reason_type 은 V3 로 넓힌 목록. */
	public record ItemRow(long bookId, int rank, double score, String tagsJson, String featureScoresJson,
		String reasonType, String reasonText) {
	}

	private final JdbcClient jdbc;

	public RecommendationSnapshotRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** 덱 한 건을 넣고 내부 id 를 돌려준다. public_id 는 화면에 나간 recommendationId 그대로다. */
	public long insertDeck(long userId, String publicId, String mode, boolean fallback, int basedOnCount,
		String weightsJson, String inputTagsJson, String featureVersion, String indexVersion,
		java.time.Instant createdAt) {
		KeyHolder keys = new GeneratedKeyHolder();
		jdbc.sql("""
				insert into recommendations
				    (user_id, public_id, mode, fallback, based_on_count, weights, input_tags,
				     feature_version, index_version, created_at)
				values
				    (:userId, :publicId, :mode, :fallback, :basedOnCount, cast(:weights as jsonb), cast(:inputTags as jsonb),
				     :featureVersion, :indexVersion, :createdAt)""")
			.param("userId", userId)
			.param("publicId", publicId)
			.param("mode", mode)
			.param("fallback", fallback)
			.param("basedOnCount", basedOnCount)
			.param("weights", weightsJson)
			.param("inputTags", inputTagsJson)
			.param("featureVersion", featureVersion)
			.param("indexVersion", indexVersion)
			.param("createdAt", java.sql.Timestamp.from(createdAt))
			.update(keys, "id");
		Number id = keys.getKey();
		if (id == null) {
			throw new IllegalStateException("recommendations 생성 키를 받지 못했다");
		}
		return id.longValue();
	}

	/** 덱의 도서 목록. 한 건씩 넣는다 — 덱은 최대 30권이라 배치로 얻을 게 없고, 어느 행이 걸렸는지 로그에 남는 편이 낫다. */
	public void insertItems(long recommendationId, List<ItemRow> items) {
		for (ItemRow item : items) {
			jdbc.sql("""
					insert into recommendation_items
					    (recommendation_id, book_id, rank, score, tags, feature_scores, reason_type, reason_text)
					values
					    (:rec, :book, :rank, :score, cast(:tags as jsonb), cast(:features as jsonb), :reasonType, :reasonText)""")
				.param("rec", recommendationId)
				.param("book", item.bookId())
				.param("rank", item.rank())
				.param("score", item.score())
				.param("tags", item.tagsJson())
				.param("features", item.featureScoresJson())
				.param("reasonType", item.reasonType())
				.param("reasonText", item.reasonText())
				.update();
		}
	}

	/**
	 * 화면에 나간 recommendationId → 내부 id. 이벤트가 덱과 연결될 때 쓴다(uq_rec_public 인덱스 한 번).
	 * <b>본인 덱만</b> 찾는다 — 남의 recommendationId 를 실어 보내 그 덱의 지표를 흔드는 일을 막는다.
	 */
	public Optional<Long> findOwnedIdByPublicId(String publicId, long userId) {
		return jdbc.sql("select id from recommendations where public_id = :publicId and user_id = :userId")
			.param("publicId", publicId).param("userId", userId)
			.query(Long.class)
			.optional();
	}
}
