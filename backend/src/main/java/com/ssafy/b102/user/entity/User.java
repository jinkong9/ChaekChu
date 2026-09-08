package com.ssafy.b102.user.entity;

import java.time.Instant;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** V1 users — OAuth 계정 1행. 닉네임·출생연도·성별은 온보딩 0단계(POST /users/me/profile)에서 채운다. */
@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Enumerated(EnumType.STRING)
	@Column(name = "oauth_provider", nullable = false, length = 20)
	private OAuthProvider oauthProvider;

	@Column(name = "oauth_subject", nullable = false, length = 255)
	private String oauthSubject;

	@Column(length = 50)
	private String nickname;

	@Column(name = "birth_year")
	private Short birthYear;

	@Convert(converter = GenderConverter.class)
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(length = 1)
	private Gender gender;

	@Enumerated(EnumType.STRING)
	@Column(name = "onboarding_status", nullable = false, length = 10)
	private OnboardingStatus onboardingStatus;

	@CreationTimestamp
	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@UpdateTimestamp
	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	public static User fromOAuth(OAuthProvider provider, String subject) {
		User u = new User();
		u.oauthProvider = provider;
		u.oauthSubject = subject;
		u.onboardingStatus = OnboardingStatus.PENDING;
		return u;
	}

	/** API_SPEC §3.2 — 멱등 덮어쓰기. 검증(2~20자·연도 범위)은 DTO 에서. */
	public void updateProfile(String nickname, Integer birthYear, Gender gender) {
		this.nickname = nickname;
		this.birthYear = birthYear == null ? null : birthYear.shortValue();
		this.gender = gender;
	}

	public void completeOnboarding() {
		this.onboardingStatus = OnboardingStatus.COMPLETED;
	}

	public boolean isOnboarded() {
		return onboardingStatus.onboarded();
	}
}
