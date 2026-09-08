package com.ssafy.b102.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withBadRequest;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import com.ssafy.b102.user.entity.OAuthProvider;

/** 제공자 HTTP 통신을 MockRestServiceServer 로 검증 — 토큰 교환 form 파라미터, Bearer 헤더, subject 추출, 실패 변환. */
class OAuthClientTest {

	private static final String REDIRECT = "http://localhost:8080/api/v1/auth/oauth/kakao/callback";

	private static OAuthProperties.Registration kakaoReg() {
		return new OAuthProperties.Registration("kakao-id", "kakao-secret",
			"https://kauth.kakao.com/oauth/authorize", "https://kauth.kakao.com/oauth/token",
			"https://kapi.kakao.com/v2/user/me", List.of());
	}

	private static OAuthProperties.Registration googleReg() {
		return new OAuthProperties.Registration("google-id", "google-secret",
			"https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token",
			"https://openidconnect.googleapis.com/v1/userinfo", List.of("openid"));
	}

	@Test
	@DisplayName("카카오: authorize URL 은 response_type·client_id·redirect_uri·state, scope 없음")
	void kakao_authorizationUrl() {
		KakaoOAuthClient client = new KakaoOAuthClient(new OAuthProperties("", kakaoReg(), null), RestClient.builder());
		String url = client.buildAuthorizationUrl(REDIRECT, "st4te");

		var q = UriComponentsBuilder.fromUriString(url).build().getQueryParams();
		assertThat(url).startsWith("https://kauth.kakao.com/oauth/authorize?");
		assertThat(q.getFirst("response_type")).isEqualTo("code");
		assertThat(q.getFirst("client_id")).isEqualTo("kakao-id");
		assertThat(q.getFirst("state")).isEqualTo("st4te");
		assertThat(q.containsKey("scope")).isFalse();
		assertThat(client.provider()).isEqualTo(OAuthProvider.KAKAO);
	}

	@Test
	@DisplayName("Google: authorize URL 에 scope=openid 가 들어간다")
	void google_authorizationUrl_hasOpenidScope() {
		GoogleOAuthClient client = new GoogleOAuthClient(new OAuthProperties("", null, googleReg()), RestClient.builder());
		var q = UriComponentsBuilder.fromUriString(client.buildAuthorizationUrl(REDIRECT, "s")).build().getQueryParams();
		assertThat(q.getFirst("scope")).isEqualTo("openid");
		assertThat(client.provider()).isEqualTo(OAuthProvider.GOOGLE);
	}

	@Test
	@DisplayName("카카오: 코드 교환(form, client_secret 포함) → Bearer 로 /v2/user/me → id 를 subject 로")
	void kakao_fetchUser() {
		RestClient.Builder builder = RestClient.builder();
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		server.expect(requestTo("https://kauth.kakao.com/oauth/token"))
			.andExpect(method(HttpMethod.POST))
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED))
			.andExpect(content().formDataContains(Map.of(
				"grant_type", "authorization_code", "client_id", "kakao-id", "client_secret", "kakao-secret",
				"code", "c0de", "redirect_uri", REDIRECT)))
			.andRespond(withSuccess("{\"access_token\":\"AT\",\"token_type\":\"bearer\",\"expires_in\":21599}",
				MediaType.APPLICATION_JSON));
		server.expect(requestTo("https://kapi.kakao.com/v2/user/me"))
			.andExpect(method(HttpMethod.GET))
			.andExpect(header("Authorization", "Bearer AT"))
			.andRespond(withSuccess("{\"id\":4242424242,\"connected_at\":\"2026-09-08T00:00:00Z\"}",
				MediaType.APPLICATION_JSON));

		KakaoOAuthClient client = new KakaoOAuthClient(new OAuthProperties("", kakaoReg(), null), builder);
		OAuthUserInfo info = client.fetchUser("c0de", REDIRECT);

		assertThat(info.provider()).isEqualTo(OAuthProvider.KAKAO);
		assertThat(info.subject()).isEqualTo("4242424242");
		server.verify();
	}

	@Test
	@DisplayName("Google: userinfo 의 sub 를 subject 로")
	void google_fetchUser() {
		RestClient.Builder builder = RestClient.builder();
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		server.expect(requestTo("https://oauth2.googleapis.com/token"))
			.andExpect(method(HttpMethod.POST))
			.andRespond(withSuccess("{\"access_token\":\"G-AT\",\"id_token\":\"x\"}", MediaType.APPLICATION_JSON));
		server.expect(requestTo("https://openidconnect.googleapis.com/v1/userinfo"))
			.andExpect(header("Authorization", "Bearer G-AT"))
			.andRespond(withSuccess("{\"sub\":\"1029384756\"}", MediaType.APPLICATION_JSON));

		GoogleOAuthClient client = new GoogleOAuthClient(new OAuthProperties("", null, googleReg()), builder);
		assertThat(client.fetchUser("c", REDIRECT).subject()).isEqualTo("1029384756");
		server.verify();
	}

	@Test
	@DisplayName("토큰 교환 4xx → OAuthException (콜백이 oauth_failed 로 바꾼다)")
	void tokenExchangeFailure_becomesOAuthException() {
		RestClient.Builder builder = RestClient.builder();
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		server.expect(requestTo("https://kauth.kakao.com/oauth/token"))
			.andRespond(withBadRequest().body("{\"error\":\"invalid_grant\",\"error_code\":\"KOE320\"}")
				.contentType(MediaType.APPLICATION_JSON));

		KakaoOAuthClient client = new KakaoOAuthClient(new OAuthProperties("", kakaoReg(), null), builder);
		assertThatThrownBy(() -> client.fetchUser("used-code", REDIRECT))
			.isInstanceOf(OAuthException.class)
			.hasMessageContaining("토큰 교환 실패");
	}

	@Test
	@DisplayName("사용자 정보에 식별자가 없으면 OAuthException")
	void missingSubject_becomesOAuthException() {
		RestClient.Builder builder = RestClient.builder();
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		server.expect(requestTo("https://kauth.kakao.com/oauth/token"))
			.andRespond(withSuccess("{\"access_token\":\"AT\"}", MediaType.APPLICATION_JSON));
		server.expect(requestTo("https://kapi.kakao.com/v2/user/me"))
			.andRespond(withSuccess("{\"connected_at\":\"2026-09-08T00:00:00Z\"}", MediaType.APPLICATION_JSON));

		KakaoOAuthClient client = new KakaoOAuthClient(new OAuthProperties("", kakaoReg(), null), builder);
		assertThatThrownBy(() -> client.fetchUser("c", REDIRECT)).isInstanceOf(OAuthException.class);
	}
}
