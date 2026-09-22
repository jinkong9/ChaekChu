package com.ssafy.b102.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import java.time.Instant;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class JwtTokenProviderTest {

	@Autowired JwtTokenProvider provider;
	@Autowired JwtDecoder decoder;
	@Autowired JwtEncoder encoder;

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
	@DisplayName("같은 키로 서명했어도 iss 가 다르거나 만료된 토큰은 거부")
	void wrongIssuerOrExpired_rejected() {
		Instant now = Instant.now();
		String otherIssuer = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
			JwtClaimsSet.builder().issuer("someone-else").subject("1").issuedAt(now).expiresAt(now.plusSeconds(60)).build()))
			.getTokenValue();
		String expired = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
			JwtClaimsSet.builder().issuer(JwtTokenProvider.ISSUER).subject("1").issuedAt(now.minusSeconds(7200)).expiresAt(now.minusSeconds(3600)).build()))
			.getTokenValue();
		assertThatThrownBy(() -> decoder.decode(otherIssuer)).isInstanceOf(JwtException.class);
		assertThatThrownBy(() -> decoder.decode(expired)).isInstanceOf(JwtException.class);
	}

	@Test
	@DisplayName("32바이트 미만 비밀키는 기동 시 거부 (JwtConfig)")
	void shortSecret_rejected() {
		JwtConfig config = new JwtConfig();
		assertThatThrownBy(() -> config.jwtSecretKey(new JwtProperties("short", 60, 0, 0)))
			.isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("32바이트");
	}
}
