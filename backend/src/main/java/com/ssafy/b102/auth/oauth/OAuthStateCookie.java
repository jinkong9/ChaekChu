package com.ssafy.b102.auth.oauth;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Optional;

import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import com.ssafy.b102.global.web.ApiPaths;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

/**
 * CSRF 방지용 state 를 서버가 발급해 HttpOnly 쿠키로 브라우저에 붙인다(API_SPEC §2.1 「세션/서명 쿠키」 — 서버는 무상태).
 * 콜백에서 쿠키 값과 ?state= 가 같아야 한다. SameSite=Lax 라 제공자 → 콜백 최상위 이동에도 쿠키가 온다.
 */
@Component
public class OAuthStateCookie {

	public static final String NAME = "oauth_state";
	static final String PATH = ApiPaths.V1 + "/auth/oauth";
	static final Duration MAX_AGE = Duration.ofMinutes(10);

	private final SecureRandom random = new SecureRandom();

	public String newState() {
		byte[] bytes = new byte[32];
		random.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	public ResponseCookie create(String state, boolean secure) {
		return ResponseCookie.from(NAME, state)
			.httpOnly(true)
			.secure(secure)
			.sameSite("Lax")
			.path(PATH)
			.maxAge(MAX_AGE)
			.build();
	}

	public ResponseCookie clear(boolean secure) {
		return ResponseCookie.from(NAME, "")
			.httpOnly(true)
			.secure(secure)
			.sameSite("Lax")
			.path(PATH)
			.maxAge(0)
			.build();
	}

	public Optional<String> read(HttpServletRequest request) {
		Cookie[] cookies = request.getCookies();
		if (cookies == null) {
			return Optional.empty();
		}
		for (Cookie c : cookies) {
			if (NAME.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
				return Optional.of(c.getValue());
			}
		}
		return Optional.empty();
	}
}
