package com.ssafy.b102.auth.service;

import java.util.List;

import org.springframework.stereotype.Service;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.auth.oauth.OAuthClient;
import com.ssafy.b102.auth.oauth.OAuthException;
import com.ssafy.b102.auth.oauth.OAuthUserInfo;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.service.UserService;

/** authorize URL 생성과 콜백 처리(코드 교환 → 사용자 조회·생성 → 서비스 JWT). 트랜잭션은 UserService 안에서만. */
@Service
public class OAuthLoginService {

	public record LoginResult(String accessToken, boolean onboarded, Long userId, boolean created) {
	}

	private final List<OAuthClient> clients;
	private final UserService userService;
	private final JwtTokenProvider jwtTokenProvider;

	public OAuthLoginService(List<OAuthClient> clients, UserService userService, JwtTokenProvider jwtTokenProvider) {
		this.clients = clients;
		this.userService = userService;
		this.jwtTokenProvider = jwtTokenProvider;
	}

	public String authorizationUrl(OAuthProvider provider, String redirectUri, String state) {
		return client(provider).buildAuthorizationUrl(redirectUri, state);
	}

	public LoginResult login(OAuthProvider provider, String code, String redirectUri) {
		OAuthUserInfo info = client(provider).fetchUser(code, redirectUri);
		boolean existed = userService.exists(provider, info.subject());
		User user = userService.findOrCreate(provider, info.subject());
		String token = jwtTokenProvider.issue(user.getId());
		return new LoginResult(token, user.isOnboarded(), user.getId(), !existed);
	}

	/** 호출 시점에 찾는다 — 테스트에서 클라이언트 빈을 스파이/목으로 바꿔도 동작하도록. */
	private OAuthClient client(OAuthProvider provider) {
		return clients.stream()
			.filter(c -> c.provider() == provider)
			.findFirst()
			.orElseThrow(() -> new OAuthException(provider + " 클라이언트가 등록되지 않았습니다."));
	}
}
