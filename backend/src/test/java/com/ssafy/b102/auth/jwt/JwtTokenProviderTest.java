package com.ssafy.b102.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class JwtTokenProviderTest {

	@Autowired JwtTokenProvider provider;
	@Autowired JwtDecoder decoder;

	@Test
	@DisplayName("발급한 토큰은 HS256 으로 검증되고 sub=userId, iss=b102, exp-iat=ttl")
	void issue_roundTrip() {
		String token = provider.issue(42L);

		Jwt jwt = decoder.decode(token);
		assertThat(jwt.getSubject()).isEqualTo("42");
		assertThat(jwt.getClaimAsString("iss")).isEqualTo(JwtTokenProvider.ISSUER);   // getIssuer() 는 URL 변환을 시도한다
		assertThat(jwt.getHeaders().get("alg")).isEqualTo("HS256");
		assertThat(Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt())).isEqualTo(Duration.ofSeconds(3600));
	}

	@Test
	@DisplayName("서명이 깨진 토큰은 거부")
	void tampered_rejected() {
		String token = provider.issue(42L);
		String tampered = token.substring(0, token.length() - 2) + "xx";
		assertThatThrownBy(() -> decoder.decode(tampered)).isInstanceOf(JwtException.class);
	}

	@Test
	@DisplayName("32바이트 미만 비밀키는 기동 시 거부 (JwtConfig)")
	void shortSecret_rejected() {
		JwtConfig config = new JwtConfig();
		assertThatThrownBy(() -> config.jwtSecretKey(new JwtProperties("short", 60)))
			.isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("32바이트");
	}
}
