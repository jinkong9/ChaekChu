package com.ssafy.b102.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.auth.oauth.KakaoOAuthClient;
import com.ssafy.b102.auth.oauth.OAuthStateCookie;
import com.ssafy.b102.auth.oauth.OAuthUserInfo;
import com.ssafy.b102.auth.session.RefreshTokenCookie;
import com.ssafy.b102.user.entity.OAuthProvider;

import jakarta.servlet.http.Cookie;

/**
 * API_SPEC §2.3·§2.4 — 콜백이 심은 refresh_token 쿠키로 갱신·로그아웃하는 HTTP 흐름.
 * 테스트 프로필은 유예 0초라 「회전된 토큰 재사용 → 계열 폐기」를 기다리지 않고 재현한다(유예 자체는 RefreshTokenServiceTest).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SessionFlowTest {

	private static final String AUTHORIZE = "/api/v1/auth/oauth/kakao/authorize";
	private static final String CALLBACK = "/api/v1/auth/oauth/kakao/callback";
	private static final String REFRESH = "/api/v1/auth/refresh";
	private static final String LOGOUT = "/api/v1/auth/logout";
	private static final String FE = "http://localhost:5173";

	@Autowired MockMvc mvc;
	@Autowired ObjectMapper json;
	@MockitoSpyBean KakaoOAuthClient kakao;

	@Test
	@DisplayName("콜백: state 삭제 쿠키와 함께 refresh_token 쿠키(HttpOnly · SameSite=Lax · Path=/api/v1/auth · 14일)를 심는다")
	void callback_setsRefreshCookie() throws Exception {
		MockHttpServletResponse res = login("sub-cookie");

		List<String> cookies = res.getHeaders(HttpHeaders.SET_COOKIE);
		assertThat(cookies).hasSize(2);
		assertThat(cookies.get(0)).startsWith(OAuthStateCookie.NAME + "=").contains("Max-Age=0");
		assertThat(cookies.get(1)).startsWith(RefreshTokenCookie.NAME + "=")
			.contains("HttpOnly").contains("SameSite=Lax").contains("Path=/api/v1/auth").contains("Max-Age=1209600");
		assertThat(res.getHeader(HttpHeaders.LOCATION)).startsWith(FE + "/oauth/callback#accessToken=");
	}

	@Test
	@DisplayName("refresh: 쿠키로 새 액세스 토큰(GET /users/me 통과) + 회전된 쿠키. 옛 쿠키 재사용은 401 이고 계열이 폐기돼 새 쿠키도 죽는다")
	void refresh_rotatesAndDetectsReuse() throws Exception {
		String first = refreshCookieOf(login("sub-rotate"));

		MockHttpServletResponse ok = mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, first)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.accessToken").isString())
			.andExpect(jsonPath("$.expiresInSeconds").value(3600))
			.andReturn().getResponse();
		String second = cookieValue(ok.getHeader(HttpHeaders.SET_COOKIE));
		assertThat(second).isNotBlank().isNotEqualTo(first);

		String accessToken = json.readTree(ok.getContentAsString()).get("accessToken").asText();
		mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.onboardingStatus").value("PENDING"));

		// 옛 쿠키 재사용(유예 0초) → 401 + 쿠키 삭제, 계열 폐기
		mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, first)))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
			.andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
		mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, second)))
			.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("refresh: 쿠키 없음 · 모르는 값 → 401 UNAUTHORIZED JSON + 쿠키 삭제")
	void refresh_withoutValidCookie_401() throws Exception {
		mvc.perform(post(REFRESH))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
			.andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString(RefreshTokenCookie.NAME + "=;")));
		mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, "not-a-token")))
			.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("refresh/logout: Origin 이 프론트도 자기 자신도 아니면 403 FORBIDDEN (CSRF). 프론트 origin · 자기 origin 은 통과")
	void sessionEndpoints_rejectForeignOrigin() throws Exception {
		String token = refreshCookieOf(login("sub-origin"));

		mvc.perform(post(REFRESH).header(HttpHeaders.ORIGIN, "https://evil.example")
				.cookie(new Cookie(RefreshTokenCookie.NAME, token)))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("FORBIDDEN"));
		mvc.perform(post(LOGOUT).header(HttpHeaders.ORIGIN, "https://evil.example"))
			.andExpect(status().isForbidden());

		// 프론트 origin(설정값) — 통과하며 회전
		String rotated = cookieValue(mvc.perform(post(REFRESH).header(HttpHeaders.ORIGIN, FE)
				.cookie(new Cookie(RefreshTokenCookie.NAME, token)))
			.andExpect(status().isOk())
			.andReturn().getResponse().getHeader(HttpHeaders.SET_COOKIE));
		// 요청 자신의 origin(MockMvc 는 http://localhost) — Swagger 같은 같은-출처 호출
		mvc.perform(post(REFRESH).header(HttpHeaders.ORIGIN, "http://localhost")
				.cookie(new Cookie(RefreshTokenCookie.NAME, rotated)))
			.andExpect(status().isOk());
	}

	@Test
	@DisplayName("logout: 204 + 쿠키 삭제, 그 뒤 같은 쿠키로 refresh 는 401. 쿠키 없이 불러도 204")
	void logout_revokesFamily() throws Exception {
		String token = refreshCookieOf(login("sub-logout"));

		mvc.perform(post(LOGOUT).cookie(new Cookie(RefreshTokenCookie.NAME, token)))
			.andExpect(status().isNoContent())
			.andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
		mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, token)))
			.andExpect(status().isUnauthorized());
		mvc.perform(post(LOGOUT))
			.andExpect(status().isNoContent());
	}

	// ── helpers ──

	private MockHttpServletResponse login(String subject) throws Exception {
		doReturn(new OAuthUserInfo(OAuthProvider.KAKAO, subject)).when(kakao).fetchUser(anyString(), anyString());
		String loc = mvc.perform(get(AUTHORIZE)).andReturn().getResponse().getHeader(HttpHeaders.LOCATION);
		String state = UriComponentsBuilder.fromUriString(loc).build().getQueryParams().getFirst("state");
		return mvc.perform(get(CALLBACK).param("code", "c-" + subject).param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))
			.andExpect(status().isFound())
			.andReturn().getResponse();
	}

	private static String refreshCookieOf(MockHttpServletResponse res) {
		return res.getHeaders(HttpHeaders.SET_COOKIE).stream()
			.filter(h -> h.startsWith(RefreshTokenCookie.NAME + "="))
			.map(SessionFlowTest::cookieValue)
			.findFirst().orElseThrow();
	}

	private static String cookieValue(String setCookie) {
		assertThat(setCookie).isNotNull();
		String pair = setCookie.split(";", 2)[0];
		return pair.substring(pair.indexOf('=') + 1);
	}

	@SuppressWarnings("unused")
	private JsonNode body(MockHttpServletResponse res) throws Exception {
		return json.readTree(res.getContentAsString());
	}
}
