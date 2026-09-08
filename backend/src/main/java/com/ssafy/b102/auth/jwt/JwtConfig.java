package com.ssafy.b102.auth.jwt;

import java.time.Clock;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import com.nimbusds.jose.jwk.source.ImmutableSecret;

/**
 * 서비스 JWT 발급·검증 빈. 별도 JWT 라이브러리 없이 spring-security-oauth2-jose(Nimbus)만 쓴다.
 * 검증은 SecurityConfig 의 oauth2ResourceServer 가 이 JwtDecoder 로 한다.
 */
@Configuration
public class JwtConfig {

	@Bean
	SecretKey jwtSecretKey(JwtProperties props) {
		byte[] bytes = props.secretBytes();
		if (bytes.length < JwtProperties.MIN_SECRET_BYTES) {
			throw new IllegalStateException(
				"app.jwt.secret(JWT_SECRET) 은 32바이트 이상이어야 합니다. 현재 " + bytes.length + "바이트. "
					+ "예: openssl rand -base64 48");
		}
		return new SecretKeySpec(bytes, "HmacSHA256");
	}

	@Bean
	JwtEncoder jwtEncoder(SecretKey jwtSecretKey) {
		return new NimbusJwtEncoder(new ImmutableSecret<>(jwtSecretKey));
	}

	@Bean
	JwtDecoder jwtDecoder(SecretKey jwtSecretKey) {
		return NimbusJwtDecoder.withSecretKey(jwtSecretKey).macAlgorithm(MacAlgorithm.HS256).build();
	}

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}
}
