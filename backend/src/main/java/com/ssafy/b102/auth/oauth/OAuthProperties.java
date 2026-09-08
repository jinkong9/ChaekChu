package com.ssafy.b102.auth.oauth;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

import com.ssafy.b102.user.entity.OAuthProvider;

/**
 * app.oauth.* — 제공자별 인가·토큰·사용자정보 주소와 클라이언트 키.
 * redirectBaseUrl 이 비어 있으면 요청의 scheme://host[:port] 로 콜백 주소를 만든다
 * (nginx 뒤에서는 forward-headers-strategy=framework + X-Forwarded-Proto 로 https 가 된다).
 */
@ConfigurationProperties(prefix = "app.oauth")
public record OAuthProperties(String redirectBaseUrl, Registration kakao, Registration google) {

	public record Registration(
		String clientId,
		String clientSecret,
		String authorizationUri,
		String tokenUri,
		String userInfoUri,
		List<String> scopes
	) {
		public Registration {
			scopes = scopes == null ? List.of() : List.copyOf(scopes);
		}

		public boolean configured() {
			return clientId != null && !clientId.isBlank();
		}
	}

	public Registration registration(OAuthProvider provider) {
		return switch (provider) {
			case KAKAO -> kakao;
			case GOOGLE -> google;
		};
	}

	public boolean hasRedirectBaseUrl() {
		return redirectBaseUrl != null && !redirectBaseUrl.isBlank();
	}
}
