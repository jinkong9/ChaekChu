package com.ssafy.b102.auth.session;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * V12 refresh_tokens — 리프레시 토큰 계열 저장소. 평문은 오지 않고 sha256 hex 만 다룬다(해시는 RefreshTokenService 가 만든다).
 *
 * JPA 엔티티를 두지 않은 이유: 조회는 해시 하나, 갱신은 두 가지(교체·계열 폐기)뿐이고 화면에 노출되는 객체가 아니다.
 * user_dna_profiles·recommendations 와 같은 JdbcClient 방식.
 */
@Repository
public class RefreshTokenRepository {

	/** 저장 행. rotatedAt·revokedAt 은 없으면 null. */
	public record Row(long id, long userId, UUID familyId, Instant issuedAt, Instant expiresAt, Instant rotatedAt,
		Instant revokedAt) {

		public boolean isRevoked() {
			return revokedAt != null;
		}

		public boolean isRotated() {
			return rotatedAt != null;
		}

		public boolean isExpired(Instant now) {
			return !expiresAt.isAfter(now);
		}
	}

	private final JdbcClient jdbc;

	public RefreshTokenRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<Row> findByHash(String tokenHash) {
		return jdbc.sql("""
				select id, user_id, family_id, issued_at, expires_at, rotated_at, revoked_at
				  from refresh_tokens
				 where token_hash = :hash""")
			.param("hash", tokenHash)
			.query((rs, rowNum) -> new Row(
				rs.getLong("id"), rs.getLong("user_id"), rs.getObject("family_id", UUID.class),
				toInstant(rs.getTimestamp("issued_at")), toInstant(rs.getTimestamp("expires_at")),
				toInstant(rs.getTimestamp("rotated_at")), toInstant(rs.getTimestamp("revoked_at"))))
			.optional();
	}

	public void insert(long userId, UUID familyId, String tokenHash, Instant issuedAt, Instant expiresAt) {
		jdbc.sql("""
				insert into refresh_tokens (user_id, family_id, token_hash, issued_at, expires_at)
				values (:userId, :familyId, :hash, :issuedAt, :expiresAt)""")
			.param("userId", userId)
			.param("familyId", familyId)
			.param("hash", tokenHash)
			.param("issuedAt", Timestamp.from(issuedAt))
			.param("expiresAt", Timestamp.from(expiresAt))
			.update();
	}

	/**
	 * 현재 유효한 행을 「교체됨」으로 표시한다. 조건에 rotated_at IS NULL 을 넣어 두 요청이 동시에 와도 한쪽만 1을 받는다 —
	 * 0을 받은 쪽은 경합에서 진 것이니 유예 경로로 처리한다(RefreshTokenService).
	 */
	public int markRotated(long id, Instant rotatedAt) {
		return jdbc.sql("""
				update refresh_tokens
				   set rotated_at = :rotatedAt
				 where id = :id
				   and rotated_at is null
				   and revoked_at is null""")
			.param("id", id)
			.param("rotatedAt", Timestamp.from(rotatedAt))
			.update();
	}

	/** 계열 전체 폐기 — 로그아웃·재사용 감지. 이미 폐기된 행은 시각을 덮지 않는다. */
	public int revokeFamily(UUID familyId, Instant revokedAt) {
		return jdbc.sql("""
				update refresh_tokens
				   set revoked_at = :revokedAt
				 where family_id = :familyId
				   and revoked_at is null""")
			.param("familyId", familyId)
			.param("revokedAt", Timestamp.from(revokedAt))
			.update();
	}

	/** 만료됐거나, 폐기·교체된 뒤 {@code keep} 이 지난 행을 지운다. 교체 행은 재사용 감지를 위해 그동안 남긴다. */
	public int deleteStale(Instant now, Instant keepUntil) {
		return jdbc.sql("""
				delete from refresh_tokens
				 where expires_at < :now
				    or revoked_at < :keepUntil
				    or rotated_at < :keepUntil""")
			.param("now", Timestamp.from(now))
			.param("keepUntil", Timestamp.from(keepUntil))
			.update();
	}

	private static Instant toInstant(Timestamp timestamp) {
		return timestamp == null ? null : timestamp.toInstant();
	}
}
