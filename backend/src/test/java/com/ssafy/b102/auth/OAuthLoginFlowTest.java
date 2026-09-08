package com.ssafy.b102.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

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
import org.springframework.web.util.UriComponents;
import org.springframework.web.util.UriComponentsBuilder;

import com.ssafy.b102.auth.oauth.KakaoOAuthClient;
import com.ssafy.b102.auth.oauth.OAuthException;
import com.ssafy.b102.auth.oauth.OAuthStateCookie;
import com.ssafy.b102.auth.oauth.OAuthUserInfo;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.repository.UserRepository;

import jakarta.servlet.http.Cookie;

/**
 * API_SPEC §2 인증 흐름 전체 — authorize 302 → 콜백(state 검증·코드 교환·가입/로그인·JWT) → GET /users/me.
 * 제공자 통신만 KakaoOAuthClient.fetchUser 를 스파이로 바꾼다. DB 는 실제 PostgreSQL(V1) — 각 테스트는 롤백.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class OAuthLoginFlowTest {

	private static final String AUTHORIZE = "/api/v1/auth/oauth/kakao/authorize";
	private static final String CALLBACK = "/api/v1/auth/oauth/kakao/callback";
	private static final String FE = "http://localhost:5173";

	@Autowired MockMvc mvc;
	@Autowired UserRepository userRepository;
	@MockitoSpyBean KakaoOAuthClient kakao;

	@Test
	@DisplayName("authorize: 제공자 로그인 화면으로 302, state 쿠키(HttpOnly) 발급, redirect_uri 는 요청 origin 기준")
	void authorize_redirectsToProviderWithStateCookie() throws Exception {
		MockHttpServletResponse res = mvc.perform(get(AUTHORIZE))
			.andExpect(status().isFound())
			.andReturn().getResponse();

		UriComponents loc = UriComponentsBuilder.fromUriString(res.getHeader(HttpHeaders.LOCATION)).build();
		assertThat(loc.getHost()).isEqualTo("kauth.kakao.com");
		assertThat(loc.getPath()).isEqualTo("/oauth/authorize");
		assertThat(loc.getQueryParams().getFirst("response_type")).isEqualTo("code");
		assertThat(loc.getQueryParams().getFirst("client_id")).isEqualTo("test-kakao-client-id");
		assertThat(decode(loc.getQueryParams().getFirst("redirect_uri")))
			.isEqualTo("http://localhost/api/v1/auth/oauth/kakao/callback");
		assertThat(loc.getQueryParams().getFirst("scope")).isNull();

		String state = loc.getQueryParams().getFirst("state");
		assertThat(state).isNotBlank();
		String setCookie = res.getHeader(HttpHeaders.SET_COOKIE);
		assertThat(setCookie).startsWith(OAuthStateCookie.NAME + "=" + state)
			.contains("HttpOnly").contains("SameSite=Lax").contains("Path=/api/v1/auth/oauth");
	}

	@Test
	@DisplayName("authorize: 모르는 provider → 400 UNSUPPORTED_PROVIDER (JSON 오류 형식)")
	void authorize_unknownProvider_400() throws Exception {
		mvc.perform(get("/api/v1/auth/oauth/naver/authorize"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("UNSUPPORTED_PROVIDER"))
			.andExpect(jsonPath("$.message").isString())
			.andExpect(jsonPath("$.details.provider").value("naver"));
	}

	@Test
	@DisplayName("callback: 신규 사용자 → PENDING 으로 가입, 토큰은 fragment, onboarded=false → 그 토큰으로 GET /users/me")
	void callback_newUser_signsUpAndIssuesJwt() throws Exception {
		doReturn(new OAuthUserInfo(OAuthProvider.KAKAO, "kakao-sub-1"))
			.when(kakao).fetchUser(eq("code-1"), anyString());
		String state = issueState();

		MockHttpServletResponse res = mvc.perform(get(CALLBACK)
				.param("code", "code-1").param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))
			.andExpect(status().isFound())
			.andReturn().getResponse();

		String location = res.getHeader(HttpHeaders.LOCATION);
		assertThat(location).startsWith(FE + "/oauth/callback#accessToken=").endsWith("&onboarded=false");
		assertThat(res.getHeader(HttpHeaders.SET_COOKIE)).contains("Max-Age=0");   // state 쿠키 제거
		String token = tokenFromFragment(location);

		mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.userId").isString())
			.andExpect(jsonPath("$.nickname").value((Object) null))
			.andExpect(jsonPath("$.onboardingStatus").value("PENDING"))
			.andExpect(jsonPath("$.interestTags").isArray())
			.andExpect(jsonPath("$.interestTags").isEmpty())
			.andExpect(jsonPath("$.birthYear").value((Object) null))
			.andExpect(jsonPath("$.gender").value((Object) null));

		assertThat(userRepository.findByOauthProviderAndOauthSubject(OAuthProvider.KAKAO, "kakao-sub-1")).isPresent();
	}

	@Test
	@DisplayName("callback: 같은 (provider, subject) 두 번째 로그인은 새 사용자를 만들지 않고 같은 userId")
	void callback_existingUser_logsInWithoutDuplicate() throws Exception {
		doReturn(new OAuthUserInfo(OAuthProvider.KAKAO, "kakao-sub-2"))
			.when(kakao).fetchUser(anyString(), anyString());

		String first = me(callbackAndGetToken("c1"));
		String second = me(callbackAndGetToken("c2"));

		assertThat(first).isEqualTo(second);
		assertThat(userRepository.findAll().stream()
			.filter(u -> "kakao-sub-2".equals(u.getOauthSubject())).count()).isEqualTo(1);
	}

	@Test
	@DisplayName("callback: state 불일치(쿠키 ≠ 파라미터) → 302 {FE}/?error=oauth_failed, 사용자 생성 안 함")
	void callback_stateMismatch_redirectsError() throws Exception {
		doReturn(new OAuthUserInfo(OAuthProvider.KAKAO, "kakao-sub-3"))
			.when(kakao).fetchUser(anyString(), anyString());

		mvc.perform(get(CALLBACK).param("code", "c").param("state", "attacker")
				.cookie(new Cookie(OAuthStateCookie.NAME, issueState())))
			.andExpect(status().isFound())
			.andExpect(header().string(HttpHeaders.LOCATION, FE + "/?error=oauth_failed"));

		assertThat(userRepository.findByOauthProviderAndOauthSubject(OAuthProvider.KAKAO, "kakao-sub-3")).isEmpty();
	}

	@Test
	@DisplayName("callback: 쿠키 없음 · code 없음 · 제공자 error 파라미터 → 모두 오류 리다이렉트")
	void callback_missingInputs_redirectError() throws Exception {
		String state = issueState();

		mvc.perform(get(CALLBACK).param("code", "c").param("state", state))                       // 쿠키 없음
			.andExpect(status().isFound())
			.andExpect(header().string(HttpHeaders.LOCATION, FE + "/?error=oauth_failed"));
		mvc.perform(get(CALLBACK).param("state", state).cookie(new Cookie(OAuthStateCookie.NAME, state)))   // code 없음
			.andExpect(status().isFound())
			.andExpect(header().string(HttpHeaders.LOCATION, FE + "/?error=oauth_failed"));
		mvc.perform(get(CALLBACK).param("error", "access_denied").param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))                                     // 사용자가 동의 취소
			.andExpect(status().isFound())
			.andExpect(header().string(HttpHeaders.LOCATION, FE + "/?error=oauth_failed"));
	}

	@Test
	@DisplayName("callback: 제공자 토큰 교환 실패(OAuthException) → 오류 리다이렉트, 500 이 아니다")
	void callback_providerFailure_redirectError() throws Exception {
		doThrow(new OAuthException("KAKAO 토큰 교환 실패")).when(kakao).fetchUser(anyString(), anyString());
		String state = issueState();

		mvc.perform(get(CALLBACK).param("code", "bad").param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))
			.andExpect(status().isFound())
			.andExpect(header().string(HttpHeaders.LOCATION, FE + "/?error=oauth_failed"));
	}

	// ── helpers ──

	private String issueState() throws Exception {
		String loc = mvc.perform(get(AUTHORIZE)).andReturn().getResponse().getHeader(HttpHeaders.LOCATION);
		return UriComponentsBuilder.fromUriString(loc).build().getQueryParams().getFirst("state");
	}

	private String callbackAndGetToken(String code) throws Exception {
		String state = issueState();
		String loc = mvc.perform(get(CALLBACK).param("code", code).param("state", state)
				.cookie(new Cookie(OAuthStateCookie.NAME, state)))
			.andExpect(status().isFound())
			.andReturn().getResponse().getHeader(HttpHeaders.LOCATION);
		return tokenFromFragment(loc);
	}

	private String me(String token) throws Exception {
		String body = mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
			.andExpect(status().isOk())
			.andReturn().getResponse().getContentAsString();
		return body.replaceAll(".*\"userId\":\"(\\d+)\".*", "$1");
	}

	private static String tokenFromFragment(String location) {
		String fragment = location.substring(location.indexOf('#') + 1);
		return fragment.replaceAll("^accessToken=([^&]+).*$", "$1");
	}

	private static String decode(String s) {
		return URLDecoder.decode(s, StandardCharsets.UTF_8);
	}
}
