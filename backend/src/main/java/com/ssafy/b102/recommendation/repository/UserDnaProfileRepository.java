package com.ssafy.b102.recommendation.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * V8 user_dna_profiles — 사용자당 한 행인 Book DNA 프로필 저장소. 읽기·쓰기 모두 여기.
 *
 * JPA 엔티티를 만들지 않은 이유: profile 이 JSONB 한 덩어리(AI 응답 그대로)라 컬럼으로 풀 이유가 없고, 조회는 PK 하나다.
 * 추천 스냅샷(RecommendationSnapshotRepository)과 같은 JdbcClient 방식. JSON 문자열 ↔ 객체 변환은 BookDnaProfileStore 가 한다.
 */
@Repository
public class UserDnaProfileRepository {

	/** 서재 지문의 재료 — 행수와 마지막 변경 시각. 서재가 비어 있으면 lastUpdatedAt 은 null. */
	public record LibraryStamp(long count, Instant lastUpdatedAt) {
	}

	/** 저장 행. profileJson·unresolvedJson 은 JSON 문자열 그대로. */
	public record Row(String fingerprint, String requestId, String dnaVersion, String modelVersion,
		String indexVersion, String tagVersion, String profileJson, String unresolvedJson, Instant generatedAt) {
	}

	private final JdbcClient jdbc;

	public UserDnaProfileRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** 서재 행수와 max(updated_at). 서재 항목의 상태·평점·감상이 바뀌면 updated_at 이 바뀌어 지문도 바뀐다. */
	public LibraryStamp libraryStamp(long userId) {
		return jdbc.sql("select count(*) as cnt, max(updated_at) as last_updated from user_library where user_id = :userId")
			.param("userId", userId)
			.query((rs, rowNum) -> new LibraryStamp(rs.getLong("cnt"), toInstant(rs.getTimestamp("last_updated"))))
			.single();
	}

	public Optional<Row> find(long userId) {
		return jdbc.sql("""
				select library_fingerprint, request_id, dna_version, model_version, index_version, tag_version,
				       cast(profile as text) as profile_json, cast(unresolved_isbns as text) as unresolved_json, generated_at
				  from user_dna_profiles
				 where user_id = :userId""")
			.param("userId", userId)
			.query((rs, rowNum) -> new Row(
				rs.getString("library_fingerprint"), rs.getString("request_id"), rs.getString("dna_version"),
				rs.getString("model_version"), rs.getString("index_version"), rs.getString("tag_version"),
				rs.getString("profile_json"), rs.getString("unresolved_json"), toInstant(rs.getTimestamp("generated_at"))))
			.optional();
	}

	/** 사용자당 1행 — 있으면 덮어쓴다. */
	public void upsert(long userId, Row row) {
		jdbc.sql("""
				insert into user_dna_profiles
				    (user_id, library_fingerprint, request_id, dna_version, model_version, index_version, tag_version,
				     profile, unresolved_isbns, generated_at, updated_at)
				values
				    (:userId, :fingerprint, :requestId, :dnaVersion, :modelVersion, :indexVersion, :tagVersion,
				     cast(:profile as jsonb), cast(:unresolved as jsonb), :generatedAt, now())
				on conflict (user_id) do update set
				    library_fingerprint = excluded.library_fingerprint,
				    request_id          = excluded.request_id,
				    dna_version         = excluded.dna_version,
				    model_version       = excluded.model_version,
				    index_version       = excluded.index_version,
				    tag_version         = excluded.tag_version,
				    profile             = excluded.profile,
				    unresolved_isbns    = excluded.unresolved_isbns,
				    generated_at        = excluded.generated_at,
				    updated_at          = now()""")
			.param("userId", userId)
			.param("fingerprint", row.fingerprint())
			.param("requestId", row.requestId())
			.param("dnaVersion", row.dnaVersion())
			.param("modelVersion", row.modelVersion())
			.param("indexVersion", row.indexVersion())
			.param("tagVersion", row.tagVersion())
			.param("profile", row.profileJson())
			.param("unresolved", row.unresolvedJson())
			.param("generatedAt", Timestamp.from(row.generatedAt()))
			.update();
	}

	private static Instant toInstant(Timestamp timestamp) {
		return timestamp == null ? null : timestamp.toInstant();
	}
}
