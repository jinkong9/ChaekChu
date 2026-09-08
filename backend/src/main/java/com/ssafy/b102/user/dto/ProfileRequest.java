package com.ssafy.b102.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

/**
 * API_SPEC §3.2 POST /users/me/profile. 공백 제거 뒤 길이·연도 범위는 OnboardingService 가 검사한다
 * (올해 상한이 동적이고, 프론트가 빈 생년월일을 0 으로 보내는 경우를 명확한 메시지로 돌려주기 위해).
 */
@Schema(description = "온보딩 0단계 — 프로필. 여러 번 보내면 덮어쓴다(멱등, 의미는 PUT)")
public record ProfileRequest(
	@Schema(description = "닉네임. 앞뒤 공백 제거 후 2~20자", example = "책벌레", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "닉네임은 필수입니다.")
	String nickname,

	@Schema(description = "출생연도. 선택 — 없으면 null(세그먼트 ALL). 1900 ≤ 값 ≤ 올해. 0 이나 빈 값은 400", example = "1996", nullable = true)
	Integer birthYear,

	@Schema(description = "성별 F | M. 선택 — 응답 안 함이면 null", allowableValues = {"F", "M"}, example = "F", nullable = true)
	String gender
) {
}
