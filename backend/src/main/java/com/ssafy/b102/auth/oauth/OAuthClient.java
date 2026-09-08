package com.ssafy.b102.auth.oauth;

import com.ssafy.b102.user.entity.OAuthProvider;

/** 제공자 하나(카카오·Google)와의 인가 코드 흐름. 구현은 AbstractOAuthClient. */
public interface OAuthClient {

	OAuthProvider provider();

	/** 제공자 로그인 화면 주소 (response_type=code). authorize 엔드포인트가 302 Location 으로 쓴다. */
	String buildAuthorizationUrl(String redirectUri, String state);

	/** 인가 코드 → 토큰 교환 → 사용자 정보. 실패는 OAuthException. */
	OAuthUserInfo fetchUser(String code, String redirectUri);
}
