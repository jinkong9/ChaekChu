package com.ssafy.b102.auth.oauth;

import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import com.fasterxml.jackson.databind.JsonNode;
import com.ssafy.b102.user.entity.OAuthProvider;

/**
 * 표준 인가 코드 흐름 — 카카오·Google 이 공유하는 부분.
 *   1) POST tokenUri (form) grant_type=authorization_code → access_token
 *   2) GET userInfoUri (Bearer access_token) → 제공자별 subject 필드 (하위 클래스)
 * 제공자 access token 은 저장하지 않는다(API_SPEC §2).
 */
public abstract class AbstractOAuthClient implements OAuthClient {

	private final OAuthProvider provider;
	private final OAuthProperties.Registration registration;
	private final RestClient restClient;

	protected AbstractOAuthClient(OAuthProvider provider, OAuthProperties.Registration registration,
		RestClient.Builder restClientBuilder) {
		this.provider = provider;
		this.registration = registration;
		this.restClient = restClientBuilder.build();
	}

	/** 사용자 정보 JSON 에서 제공자 고유 식별자를 꺼낸다 (카카오 id · Google sub). */
	protected abstract String extractSubject(JsonNode userInfo);

	@Override
	public OAuthProvider provider() {
		return provider;
	}

	protected OAuthProperties.Registration registration() {
		return registration;
	}

	@Override
	public String buildAuthorizationUrl(String redirectUri, String state) {
		UriComponentsBuilder b = UriComponentsBuilder.fromUriString(registration.authorizationUri())
			.queryParam("response_type", "code")
			.queryParam("client_id", registration.clientId())
			.queryParam("redirect_uri", redirectUri)
			.queryParam("state", state);
		if (!registration.scopes().isEmpty()) {
			b.queryParam("scope", String.join(" ", registration.scopes()));
		}
		return b.encode().build().toUriString();
	}

	@Override
	public OAuthUserInfo fetchUser(String code, String redirectUri) {
		String accessToken = exchangeCode(code, redirectUri);
		JsonNode userInfo = fetchUserInfo(accessToken);
		return new OAuthUserInfo(provider, extractSubject(userInfo));
	}

	private String exchangeCode(String code, String redirectUri) {
		MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
		form.add("grant_type", "authorization_code");
		form.add("client_id", registration.clientId());
		form.add("redirect_uri", redirectUri);
		form.add("code", code);
		if (registration.clientSecret() != null && !registration.clientSecret().isBlank()) {
			form.add("client_secret", registration.clientSecret());
		}
		JsonNode body;
		try {
			body = restClient.post()
				.uri(registration.tokenUri())
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.accept(MediaType.APPLICATION_JSON)
				.body(form)
				.retrieve()
				.body(JsonNode.class);
		}
		catch (RestClientException e) {
			throw new OAuthException(provider + " 토큰 교환 실패: " + e.getMessage(), e);
		}
		JsonNode token = body == null ? null : body.get("access_token");
		if (token == null || token.asText().isBlank()) {
			throw new OAuthException(provider + " 토큰 응답에 access_token 이 없습니다.");
		}
		return token.asText();
	}

	private JsonNode fetchUserInfo(String accessToken) {
		try {
			JsonNode body = restClient.get()
				.uri(registration.userInfoUri())
				.headers(h -> h.setBearerAuth(accessToken))
				.accept(MediaType.APPLICATION_JSON)
				.retrieve()
				.body(JsonNode.class);
			if (body == null) {
				throw new OAuthException(provider + " 사용자 정보 응답이 비어 있습니다.");
			}
			return body;
		}
		catch (RestClientException e) {
			throw new OAuthException(provider + " 사용자 정보 조회 실패: " + e.getMessage(), e);
		}
	}
}
