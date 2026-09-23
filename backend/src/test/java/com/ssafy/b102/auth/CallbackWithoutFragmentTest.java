package com.ssafy.b102.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

import com.ssafy.b102.auth.oauth.KakaoOAuthClient;
import com.ssafy.b102.auth.oauth.OAuthStateCookie;
import com.ssafy.b102.auth.oauth.OAuthUserInfo;
import com.ssafy.b102.auth.session.RefreshTokenCookie;
import com.ssafy.b102.user.entity.OAuthProvider;

import jakarta.servlet.http.Cookie;

/**
 * API_SPEC §2.2 — 운영 설정(AUTH_CALLBACK_TOKEN_IN_FRAGMENT=false, compose 기본값 09-23)에서의 콜백.
 * 토큰이 URL 어디에도 없고, 브라우저는 심어진 refresh_token 쿠키만으로 POST /auth/refresh 를 통해 첫 액세스 토큰을 받는다.
 * (기본 프로필 true 의 fragment 경로는 OAuthLoginFlowTest·SessionFlowTest 가 본다.)
 */
@SpringBootTest(properties = "app.auth.callback-token-in-fragment=false")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class CallbackWithoutFragmentTest {

	private static final String AUTHORIZE = "/api/v1/auth/oauth/kakao/authorize";
	private static final String CALLBACK = "/api/v1/auth/oauth/kakao/callback";
	private static final String REFRESH = "/api/v1/auth/refresh";
	private static final String FE = "http://localhost:5173";

	@Autowired MockMvc mvc;
	@MockitoSpyBean KakaoOAuthClient kakao;

	@Test
	@DisplayName("콜백 302 의 Location 은 {FE}/oauth/callback 그대로 — fragment·쿼리에 토큰 없음. 리프레시 쿠키만으로 첫 액세스 토큰을 받는다")
	void callback_locationHasNoToken_andRefreshBootstrapsSession() throws Exception {
		doReturn(new OAuthUserInfo(OAuthProvider.KAKAO, "sub-no-fragment")).when(kakao).fetchUser(anyString(), anyString());
		String loc = mvc.perform(get(AUTHORIZE)).andReturn().getResponse().getHeader(HttpHeaders.LOCATION);
		String state = UriComponentsBuilder.fromUriString(loc).build().getQueryParams().getFirst("state");

		MockHttpServletResponse res = mvc.perform(get(CALLBACK).param("code", "c").param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))
			.andExpect(status().isFound())
			.andReturn().getResponse();

		String location = res.getHeader(HttpHeaders.LOCATION);
		assertThat(location).isEqualTo(FE + "/oauth/callback");
		assertThat(location).doesNotContain("#").doesNotContain("accessToken").doesNotContain("?");

		List<String> cookies = res.getHeaders(HttpHeaders.SET_COOKIE);
		String refresh = cookies.stream().filter(c -> c.startsWith(RefreshTokenCookie.NAME + "=")).findFirst().orElseThrow();
		assertThat(refresh).contains("HttpOnly").contains("Path=/api/v1/auth");
		String token = refresh.split(";", 2)[0].substring(RefreshTokenCookie.NAME.length() + 1);

		// 프론트 부트스트랩(App.tsx AuthRestore)이 하는 일 — 쿠키만으로 액세스 토큰을 받고 GET /users/me 가 통과한다
		String accessToken = mvc.perform(post(REFRESH).cookie(new Cookie(RefreshTokenCookie.NAME, token)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.accessToken").isString())
			.andReturn().getResponse().getContentAsString().replaceAll(".*\"accessToken\":\"([^\"]+)\".*", "$1");
		mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.onboardingStatus").value("PENDING"));
	}
}
