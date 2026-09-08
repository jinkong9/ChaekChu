package com.ssafy.b102.user.entity;

/**
 * users.onboarding_status — PENDING / COMPLETED / SKIPPED.
 * 프론트의 onboarded = (status != PENDING). SKIPPED 는 예약 상태로 서버가 만들지 않는다(API_SPEC §10-0).
 */
public enum OnboardingStatus {

	PENDING, COMPLETED, SKIPPED;

	public boolean onboarded() {
		return this != PENDING;
	}
}
