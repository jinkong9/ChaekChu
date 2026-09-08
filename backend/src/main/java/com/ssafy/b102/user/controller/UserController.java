package com.ssafy.b102.user.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.user.dto.UserMeResponse;
import com.ssafy.b102.user.service.UserService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

@Tag(name = "사용자", description = "내 계정 정보와 온보딩(프로필·초기 취향). 모두 로그인 필요. birthYear·gender 는 본인에게만 돌려준다.")
@RestController
@RequestMapping(ApiPaths.V1 + "/users")
public class UserController {

	private final UserService userService;

	public UserController(UserService userService) {
		this.userService = userService;
	}

	@Operation(summary = "내 정보 조회", description = """
		JWT 의 사용자를 돌려준다. 쓰는 곳: ① OAuth 콜백 직후 닉네임 확보(토큰 fragment 에는 닉네임이 없다) ② 앱 시작·새로고침 때 상태 복원.
		`onboardingStatus` 가 진실의 원천이며 프론트의 `onboarded` = status != PENDING. SKIPPED 는 예약 상태로 서버가 만들지 않는다.
		`nickname`·`birthYear`·`gender` 는 온보딩 전이면 null(키는 항상 존재). `interestTags` 는 고른 관심 태그 라벨, 없으면 빈 배열.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "내 정보"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED — 토큰 없음·만료·위조. 프론트는 즉시 로그아웃", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "USER_NOT_FOUND — 토큰은 유효하지만 사용자 행이 없음(탈퇴 등)", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/me")
	public UserMeResponse me(@CurrentUserId Long userId) {
		return userService.getMe(userId);
	}
}
