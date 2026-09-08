package com.ssafy.b102.auth.oauth;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.ssafy.b102.user.entity.OAuthProvider;

/**
 * 카카오 로그인. 동의 항목 없이 /v2/user/me 의 회원번호(id, 정수)만 쓴다.
 * 콘솔: 앱 → 플랫폼 키 → REST API 키(= client_id) · 클라이언트 시크릿 · 카카오 로그인 리다이렉트 URI.
 */
@Component
public class KakaoOAuthClient extends AbstractOAuthClient {

	public KakaoOAuthClient(OAuthProperties props, RestClient.Builder restClientBuilder) {
		super(OAuthProvider.KAKAO, props.kakao(), restClientBuilder);
	}

	@Override
	protected String extractSubject(JsonNode userInfo) {
		JsonNode id = userInfo.get("id");
		return id == null || id.isNull() ? null : id.asText();
	}
}
