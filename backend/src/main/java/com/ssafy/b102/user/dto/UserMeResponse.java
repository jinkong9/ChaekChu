package com.ssafy.b102.user.dto;

import java.util.List;

import com.ssafy.b102.user.entity.User;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §3.1 GET /users/me. userId 는 불투명 문자열. birthYear·gender 는 본인에게만 돌려주므로 여기서만 노출. */
@Schema(description = "내 정보 (GET /users/me)")
public record UserMeResponse(
	@Schema(description = "사용자 식별자. 불투명 문자열 — 숫자처럼 보여도 문자열로 다룬다", example = "18") String userId,
	@Schema(description = "닉네임 2~20자. 온보딩 0단계 전이면 null", example = "책벌레", nullable = true) String nickname,
	@Schema(description = "온보딩 상태. 프론트 onboarded = status != PENDING", allowableValues = {"PENDING", "COMPLETED", "SKIPPED"}, example = "COMPLETED") String onboardingStatus,
	@Schema(description = "관심 태그 라벨 목록(고른 순서). 없으면 []", example = "[\"소설\", \"과학\"]") List<String> interestTags,
	@Schema(description = "출생연도. 미입력이면 null → 세그먼트 ALL", example = "1996", nullable = true) Integer birthYear,
	@Schema(description = "성별 F | M. 미입력이면 null", allowableValues = {"F", "M"}, example = "F", nullable = true) String gender
) {

	public static UserMeResponse of(User user, List<String> interestTags) {
		return new UserMeResponse(
			String.valueOf(user.getId()),
			user.getNickname(),
			user.getOnboardingStatus().name(),
			interestTags,
			user.getBirthYear() == null ? null : user.getBirthYear().intValue(),
			user.getGender() == null ? null : user.getGender().code());
	}
}
