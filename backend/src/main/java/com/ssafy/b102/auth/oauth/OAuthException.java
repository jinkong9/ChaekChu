package com.ssafy.b102.auth.oauth;

/** 제공자 통신·응답 해석 실패. 콜백은 이걸 잡아 {FRONTEND_ORIGIN}/?error=oauth_failed 로 302 한다. */
public class OAuthException extends RuntimeException {

	public OAuthException(String message) {
		super(message);
	}

	public OAuthException(String message, Throwable cause) {
		super(message, cause);
	}
}
