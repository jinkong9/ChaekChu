package com.ssafy.b102.auth.oauth;

import com.ssafy.b102.user.entity.OAuthProvider;

/**
 * 제공자에서 받은 사용자 식별자. subject 만 쓴다 — 닉네임·성별·출생연도는 OAuth 로 받지 않고 온보딩 입력이 유일한 경로다
 * (API_SPEC §3.2: 카카오는 비즈 앱 선택 동의, Google 은 People API 민감 범위).
 */
public record OAuthUserInfo(OAuthProvider provider, String subject) {

	public OAuthUserInfo {
		if (subject == null || subject.isBlank()) {
			throw new OAuthException(provider + " 사용자 식별자(subject)가 비어 있습니다.");
		}
	}
}
