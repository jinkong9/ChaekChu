package com.ssafy.b102.auth.jwt;

import java.nio.charset.StandardCharsets;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.jwt.* — API_SPEC §2.2~§2.4.
 * <ul>
 *   <li>{@code secret} — HS256 요건상 32바이트 이상. 비어 있으면 기동 시 실패한다(JwtConfig).</li>
 *   <li>{@code ttlSeconds} — 액세스 JWT 수명. 운영은 15분(900). 만료되면 프론트가 §2.3 으로 조용히 갱신한다.</li>
 *   <li>{@code refreshTtlSeconds} — 리프레시 토큰의 절대 수명(기본 14일). 회전해도 이 시점을 넘기지 않는다.</li>
 *   <li>{@code refreshGraceSeconds} — 회전된 옛 토큰을 도용이 아니라 탭 경합으로 봐 주는 유예(기본 10초, 0 이면 유예 없음).</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.jwt")
public record JwtProperties(String secret, long ttlSeconds, long refreshTtlSeconds, long refreshGraceSeconds) {

	public static final int MIN_SECRET_BYTES = 32;
	public static final long DEFAULT_REFRESH_TTL_SECONDS = 14L * 24 * 3600;
	public static final long DEFAULT_REFRESH_GRACE_SECONDS = 10;

	public JwtProperties {
		if (ttlSeconds <= 0) {
			ttlSeconds = 86_400;
		}
		if (refreshTtlSeconds <= 0) {
			refreshTtlSeconds = DEFAULT_REFRESH_TTL_SECONDS;
		}
		if (refreshGraceSeconds < 0) {
			refreshGraceSeconds = DEFAULT_REFRESH_GRACE_SECONDS;
		}
	}

	public byte[] secretBytes() {
		return secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
	}
}
