package com.ssafy.b102.user.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;

public interface UserRepository extends JpaRepository<User, Long> {

	Optional<User> findByOauthProviderAndOauthSubject(OAuthProvider provider, String subject);
}
