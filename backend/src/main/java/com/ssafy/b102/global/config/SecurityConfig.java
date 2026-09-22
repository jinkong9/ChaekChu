package com.ssafy.b102.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import com.ssafy.b102.global.security.JsonAccessDeniedHandler;
import com.ssafy.b102.global.security.JsonAuthenticationEntryPoint;
import com.ssafy.b102.global.web.ApiPaths;

/**
 * 무상태 JWT 보안 설정 (API_SPEC §1.1·§2).
 * - 공개: 헬스체크 · Swagger · OAuth authorize/callback · 세션 갱신/종료(/auth/refresh·/auth/logout — HttpOnly 쿠키로 인증)
 * - 그 외 전부 Authorization: Bearer <서비스 JWT>. 검증은 oauth2ResourceServer 가 JwtConfig 의 HS256 JwtDecoder 로.
 * - 401/403 은 JSON { code, message } 로 낸다 (프론트는 401 이면 /auth/refresh 를 한 번 시도하고, 그것도 401 이면 로그아웃).
 * - 카카오·Google 로그인은 스타터의 oauth2Login 이 아니라 AuthController 가 명세 경로로 직접 처리한다.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, JwtDecoder jwtDecoder,
		JsonAuthenticationEntryPoint entryPoint, JsonAccessDeniedHandler accessDeniedHandler) throws Exception {
		http
			.csrf(csrf -> csrf.disable())
			.cors(Customizer.withDefaults())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.httpBasic(basic -> basic.disable())
			.formLogin(form -> form.disable())
			.logout(logout -> logout.disable())
			.authorizeHttpRequests(auth -> auth
				.requestMatchers("/actuator/health/**").permitAll()
				.requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
				.requestMatchers(ApiPaths.V1 + "/auth/oauth/*/authorize", ApiPaths.V1 + "/auth/oauth/*/callback").permitAll()
				.requestMatchers(ApiPaths.V1 + "/auth/refresh", ApiPaths.V1 + "/auth/logout").permitAll()   // 쿠키 인증 (SessionController)
				.anyRequest().authenticated()
			)
			.oauth2ResourceServer(rs -> rs
				.jwt(jwt -> jwt.decoder(jwtDecoder))
				.authenticationEntryPoint(entryPoint)
				.accessDeniedHandler(accessDeniedHandler)
			)
			.exceptionHandling(ex -> ex
				.authenticationEntryPoint(entryPoint)
				.accessDeniedHandler(accessDeniedHandler)
			);
		return http.build();
	}
}
