package com.ssafy.b102.user.service;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.user.dto.UserMeResponse;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.repository.UserRepository;

@Service
public class UserService {

	private final UserRepository userRepository;
	private final UserInterestRepository userInterestRepository;

	public UserService(UserRepository userRepository, UserInterestRepository userInterestRepository) {
		this.userRepository = userRepository;
		this.userInterestRepository = userInterestRepository;
	}

	/**
	 * (provider, subject) 로 조회, 없으면 PENDING 으로 생성 — OAuth 최초 로그인이 곧 가입이다.
	 * 같은 사람이 동시에 두 번 콜백하면 uq_users_oauth 로 한쪽이 실패하고 콜백은 oauth_failed 로 돌아간다(재시도로 해결).
	 */
	@Transactional
	public User findOrCreate(OAuthProvider provider, String subject) {
		return userRepository.findByOauthProviderAndOauthSubject(provider, subject)
			.orElseGet(() -> userRepository.save(User.fromOAuth(provider, subject)));
	}

	@Transactional(readOnly = true)
	public boolean exists(OAuthProvider provider, String subject) {
		return userRepository.findByOauthProviderAndOauthSubject(provider, subject).isPresent();
	}

	@Transactional(readOnly = true)
	public User getUser(Long userId) {
		return userRepository.findById(userId)
			.orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND, Map.of("userId", String.valueOf(userId))));
	}

	@Transactional(readOnly = true)
	public UserMeResponse getMe(Long userId) {
		User user = getUser(userId);
		List<String> tags = userInterestRepository.findTagLabelsByUserId(userId);
		return UserMeResponse.of(user, tags);
	}
}
