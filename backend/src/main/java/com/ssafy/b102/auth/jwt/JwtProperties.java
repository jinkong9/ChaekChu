package com.ssafy.b102.auth.jwt;

import java.nio.charset.StandardCharsets;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.jwt.* — API_SPEC §2.2: HS256, sub=userId, exp 24시간, 갱신 토큰 없음.
 * secret 은 HS256 요건상 32바이트 이상. 비어 있으면 기동 시 실패한다(JwtConfig).
 */
@ConfigurationProperties(prefix = "app.jwt")
public record JwtProperties(String secret, long ttlSeconds) {

	public static final int MIN_SECRET_BYTES = 32;

	public JwtProperties {
		if (ttlSeconds <= 0) {
			ttlSeconds = 86_400;
		}
	}

	public byte[] secretBytes() {
		return secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
	}
}
