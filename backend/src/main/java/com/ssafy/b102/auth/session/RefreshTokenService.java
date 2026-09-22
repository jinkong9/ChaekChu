package com.ssafy.b102.auth.session;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.auth.jwt.JwtProperties;
import com.ssafy.b102.auth.session.RefreshTokenRepository.Row;

/**
 * 리프레시 토큰의 발급·회전·폐기 (API_SPEC §2.3·§2.4). 정석 그대로:
 * <ul>
 *   <li>토큰은 32바이트 난수(base64url). DB 에는 sha256 hex 만 — 평문은 브라우저 쿠키에만 존재한다.</li>
 *   <li>쓸 때마다 회전한다. 옛 행은 rotated_at 을 찍고 같은 계열(family)에 새 행을 만든다. 절대 만료는 계열 생성 시각 기준으로 고정.</li>
 *   <li>회전된 옛 토큰이 다시 오면 — 유예(refreshGraceSeconds) 안이면 탭 경합으로 보고 액세스 토큰만 다시 내주고 쿠키는 건드리지 않는다.
 *       유예 밖이면 도용으로 보고 계열 전체를 폐기한다(재사용 감지).</li>
 * </ul>
 * 시각은 주입된 Clock 으로만 읽는다 — 테스트가 유예·만료를 시계로 재현할 수 있게.
 */
@Service
public class RefreshTokenService {

	private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);
	private static final int TOKEN_BYTES = 32;

	/** 발급·회전 결과. {@code token} 은 브라우저에 줄 평문, {@code expiresAt} 은 계열의 절대 만료. */
	public record Issued(String token, long userId, Instant expiresAt) {
	}

	/**
	 * 회전 결과.
	 * <ul>
	 *   <li>{@link #issued()} 가 있으면 새 토큰으로 쿠키를 갈아 끼운다.</li>
	 *   <li>없으면 유예 안의 재사용 — 액세스 토큰만 내고 쿠키는 그대로 둔다(다른 탭이 이미 새 쿠키를 받았다).</li>
	 * </ul>
	 */
	public record Rotation(long userId, Optional<Issued> issued) {
	}

	private final RefreshTokenRepository repository;
	private final JwtProperties props;
	private final Clock clock;
	private final SecureRandom random = new SecureRandom();

	public RefreshTokenService(RefreshTokenRepository repository, JwtProperties props, Clock clock) {
		this.repository = repository;
		this.props = props;
		this.clock = clock;
	}

	/** 로그인 성공 — 새 계열을 만든다. */
	@Transactional
	public Issued issue(long userId) {
		Instant now = clock.instant();
		Instant expiresAt = now.plusSeconds(props.refreshTtlSeconds());
		return insert(userId, UUID.randomUUID(), now, expiresAt);
	}

	/**
	 * 쿠키로 받은 토큰을 검증하고 회전한다. 유효하지 않으면(모름·폐기·만료·재사용) empty — 호출자는 401 과 쿠키 삭제로 응답한다.
	 */
	@Transactional
	public Optional<Rotation> rotate(String rawToken) {
		Instant now = clock.instant();
		Optional<Row> found = lookup(rawToken);
		if (found.isEmpty()) {
			return Optional.empty();
		}
		Row row = found.get();
		if (row.isRevoked()) {
			log.info("리프레시 거부 — 폐기된 계열 userId={} family={}", row.userId(), row.familyId());
			return Optional.empty();
		}
		if (row.isExpired(now)) {
			log.info("리프레시 거부 — 절대 만료 userId={} family={}", row.userId(), row.familyId());
			return Optional.empty();
		}
		if (row.isRotated()) {
			return handleReplay(row, now);
		}
		int marked = repository.markRotated(row.id(), now);
		if (marked == 0) {
			// 같은 토큰으로 동시에 들어온 다른 요청이 먼저 회전시켰다 — 이쪽은 유예 경로와 같은 처리
			log.debug("리프레시 경합 — 이미 회전됨 userId={} family={}", row.userId(), row.familyId());
			return Optional.of(new Rotation(row.userId(), Optional.empty()));
		}
		Issued next = insert(row.userId(), row.familyId(), now, row.expiresAt());
		return Optional.of(new Rotation(row.userId(), Optional.of(next)));
	}

	/** 로그아웃 — 그 토큰의 계열 전체를 폐기한다. 모르는 토큰이면 조용히 지나간다(이미 지워졌거나 위조). */
	@Transactional
	public void revoke(String rawToken) {
		lookup(rawToken).ifPresent(row -> {
			int n = repository.revokeFamily(row.familyId(), clock.instant());
			log.info("리프레시 계열 폐기(로그아웃) userId={} family={} rows={}", row.userId(), row.familyId(), n);
		});
	}

	/** 만료·폐기·교체된 지 하루 넘은 행 정리. RefreshTokenPurgeJob 이 부른다. */
	@Transactional
	public int purge() {
		Instant now = clock.instant();
		return repository.deleteStale(now, now.minus(Duration.ofDays(1)));
	}

	private Optional<Rotation> handleReplay(Row row, Instant now) {
		Duration sinceRotation = Duration.between(row.rotatedAt(), now);
		// 유예는 밀리초로 엄격 비교 — grace=0 이면 같은 초에 와도 유예가 아니다(테스트 프로필이 이 값으로 재사용 감지를 재현한다)
		if (!sinceRotation.isNegative() && sinceRotation.toMillis() < props.refreshGraceSeconds() * 1000L) {
			log.debug("리프레시 유예 안 재사용 — 탭 경합으로 처리 userId={} family={} {}ms",
				row.userId(), row.familyId(), sinceRotation.toMillis());
			return Optional.of(new Rotation(row.userId(), Optional.empty()));
		}
		int n = repository.revokeFamily(row.familyId(), now);
		log.warn("리프레시 재사용 감지 — 계열 폐기 userId={} family={} rotatedBefore={}s rows={}",
			row.userId(), row.familyId(), sinceRotation.getSeconds(), n);
		return Optional.empty();
	}

	private Issued insert(long userId, UUID familyId, Instant now, Instant expiresAt) {
		String token = newToken();
		repository.insert(userId, familyId, hash(token), now, expiresAt);
		return new Issued(token, userId, expiresAt);
	}

	private Optional<Row> lookup(String rawToken) {
		if (rawToken == null || rawToken.isBlank() || rawToken.length() > 128) {
			return Optional.empty();
		}
		return repository.findByHash(hash(rawToken));
	}

	private String newToken() {
		byte[] bytes = new byte[TOKEN_BYTES];
		random.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	static String hash(String token) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-256 을 쓸 수 없습니다.", e);
		}
	}
}
