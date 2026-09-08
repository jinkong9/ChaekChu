package com.ssafy.b102.user.entity;

import java.util.Map;
import java.util.Optional;

/** users.oauth_provider — V1 CHECK ('KAKAO','GOOGLE'). URL 경로에서는 소문자(kakao/google)로 온다. */
public enum OAuthProvider {

	KAKAO, GOOGLE;

	public String pathName() {
		return name().toLowerCase();
	}

	/** 경로 변수 → enum. 모르는 값이면 empty (호출 측이 400 UNSUPPORTED_PROVIDER 로 바꾼다). */
	public static Optional<OAuthProvider> fromPath(String path) {
		if (path == null) {
			return Optional.empty();
		}
		for (OAuthProvider p : values()) {
			if (p.name().equalsIgnoreCase(path)) {
				return Optional.of(p);
			}
		}
		return Optional.empty();
	}

	public Map<String, Object> asDetails(String raw) {
		return Map.of("provider", raw);
	}
}
