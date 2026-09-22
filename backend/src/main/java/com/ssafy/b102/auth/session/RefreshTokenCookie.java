package com.ssafy.b102.auth.session;

import java.time.Duration;
import java.util.Optional;

import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import com.ssafy.b102.auth.jwt.JwtProperties;
import com.ssafy.b102.global.web.ApiPaths;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 리프레시 토큰 쿠키 (API_SPEC §2.3). JS 가 읽을 수 없고(HttpOnly), 갱신·로그아웃 경로에만 실리며(Path=/api/v1/auth),
 * 다른 사이트가 띄운 요청에는 붙지 않는다(SameSite=Lax). Secure 는 요청이 https 일 때 — nginx 뒤에서는 X-Forwarded-Proto 로 판정된다.
 * 수명은 쿠키가 아니라 서버 행(expires_at)이 진실이고, Max-Age 는 브라우저가 그 전에 버리지 않게 맞춰 두는 값이다.
 */
@Component
public class RefreshTokenCookie {

	public static final String NAME = "refresh_token";
	static final String PATH = ApiPaths.V1 + "/auth";

	private final JwtProperties props;

	public RefreshTokenCookie(JwtProperties props) {
		this.props = props;
	}

	public ResponseCookie create(String token, boolean secure) {
		return base(token, secure)
			.maxAge(Duration.ofSeconds(props.refreshTtlSeconds()))
			.build();
	}

	public ResponseCookie clear(boolean secure) {
		return base("", secure)
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

	private static ResponseCookie.ResponseCookieBuilder base(String value, boolean secure) {
		return ResponseCookie.from(NAME, value)
			.httpOnly(true)
			.secure(secure)
			.sameSite("Lax")
			.path(PATH);
	}
}
