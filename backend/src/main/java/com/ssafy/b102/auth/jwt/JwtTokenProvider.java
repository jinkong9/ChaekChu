package com.ssafy.b102.auth.jwt;

import java.time.Clock;
import java.time.Instant;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

/** 서비스 JWT 발급. 클레임은 iss · sub(users.id) · iat · exp 만 — 닉네임 등은 GET /users/me 로 받는다. */
@Component
public class JwtTokenProvider {

	public static final String ISSUER = "b102";

	private final JwtEncoder encoder;
	private final JwtProperties props;
	private final Clock clock;

	public JwtTokenProvider(JwtEncoder encoder, JwtProperties props, Clock clock) {
		this.encoder = encoder;
		this.props = props;
		this.clock = clock;
	}

	public String issue(Long userId) {
		Instant now = clock.instant();
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.issuer(ISSUER)
			.subject(String.valueOf(userId))
			.issuedAt(now)
			.expiresAt(now.plusSeconds(props.ttlSeconds()))
			.build();
		JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
		return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
	}

	public long ttlSeconds() {
		return props.ttlSeconds();
	}
}
