package com.ssafy.b102.auth.oauth;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.ssafy.b102.user.entity.OAuthProvider;

/** Google. scope=openid 만 요청하고 OIDC userinfo 의 sub 를 subject 로 쓴다. */
@Component
public class GoogleOAuthClient extends AbstractOAuthClient {

	public GoogleOAuthClient(OAuthProperties props, RestClient.Builder restClientBuilder) {
		super(OAuthProvider.GOOGLE, props.google(), restClientBuilder);
	}

	@Override
	protected String extractSubject(JsonNode userInfo) {
		JsonNode sub = userInfo.get("sub");
		return sub == null || sub.isNull() ? null : sub.asText();
	}
}
