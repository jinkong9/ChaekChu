package com.ssafy.b102.user.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.user.dto.PreferencesRequest;
import com.ssafy.b102.user.dto.ProfileRequest;
import com.ssafy.b102.user.dto.UserMeResponse;
import com.ssafy.b102.user.service.OnboardingService;
import com.ssafy.b102.user.service.UserService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** API_SPEC §3 — 내 정보 · 온보딩(프로필 → 관심 장르·읽은 책). 전부 로그인 필요. */
@Tag(name = "사용자", description = """
	내 계정 정보와 온보딩. 모두 로그인 필요. birthYear·gender 는 본인에게만 돌려준다.
	온보딩 흐름: OAuth 로그인(PENDING) → POST /users/me/profile(닉네임·출생연도·성별) → POST /users/me/preferences(관심 장르·읽은 책+별점) → COMPLETED.
	「건너뛰기」도 preferences 를 빈 배열로 보내서 끝낸다. 프로필만 저장하고 preferences 를 안 보내면 계속 PENDING 이다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/users")
public class UserController {

	private final UserService userService;
	private final OnboardingService onboardingService;

	public UserController(UserService userService, OnboardingService onboardingService) {
		this.userService = userService;
		this.onboardingService = onboardingService;
	}

	@Operation(summary = "내 정보 조회", description = """
		JWT 의 사용자를 돌려준다. 쓰는 곳: ① OAuth 콜백 직후 닉네임 확보(토큰 fragment 에는 닉네임이 없다) ② 앱 시작·새로고침 때 상태 복원.
		`onboardingStatus` 가 진실의 원천이며 프론트의 `onboarded` = status != PENDING. SKIPPED 는 예약 상태로 서버가 만들지 않는다.
		`nickname`·`birthYear`·`gender` 는 온보딩 전이면 null(키는 항상 존재). `interestTags` 는 고른 관심 태그의 표시명('#소설'), 없으면 빈 배열.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "내 정보"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED — 토큰 없음·만료·위조. 프론트는 즉시 로그아웃", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "USER_NOT_FOUND — 토큰은 유효하지만 사용자 행이 없음(탈퇴 등)", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/me")
	public UserMeResponse me(@CurrentUserId Long userId) {
		return userService.getMe(userId);
	}

	@Operation(summary = "온보딩 0단계 — 프로필 저장(닉네임·출생연도·성별)", description = """
		OAuth 로는 닉네임·성별·출생연도를 받을 수 없어(카카오 비즈 앱 선택 동의, Google People API 민감 범위) 여기서 입력받는다.
		규칙: `nickname` 필수, 앞뒤 공백 제거 후 2~20자. `birthYear` 선택(null 허용) 1900~올해 — 프론트가 빈 생년월일을 0 으로 보내면 400 이니 null 로 보낼 것.
		`gender` 선택 F | M | null. 여러 번 보내면 덮어쓴다(멱등, 의미는 PUT 이지만 프론트가 POST 를 쓴다).
		온보딩 상태는 바꾸지 않는다 — COMPLETED 는 preferences 에서.""")
	@ApiResponses({
		@ApiResponse(responseCode = "204", description = "저장됨. 본문 없음", content = @Content),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — details.fields[{field, reason}] 에 위반 항목(nickname·birthYear·gender)", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@PostMapping("/me/profile")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void saveProfile(@CurrentUserId Long userId, @Valid @RequestBody ProfileRequest request) {
		onboardingService.saveProfile(userId, request);
	}

	@Operation(summary = "온보딩 2단계 — 초기 취향 저장(관심 장르 · 읽은 책+별점) → 온보딩 완료", description = """
		처리: ① `books[].bookId` 존재 확인(하나라도 없으면 404, 아무것도 저장 안 함) ② `genres` 를 태그 코드로 바꿔 관심 태그를 **전체 교체**
		③ 고른 책을 서재에 `READ` + `finishedDate=null`(서비스를 만나기 전에 읽은 책 — 연표·통계에서 프론트가 제외) + `source=ONBOARDING` 으로 저장,
		이미 서재에 있으면 평점만 갱신 ④ `onboardingStatus=COMPLETED`.

		`genres` 는 0~5개. 온보딩 라벨('소설'), 태그 표시명('#소설'), 코드('FICTION') 모두 받고 사전에 없는 값은 무시한다(라벨↔코드 표: API_SPEC §3.3).
		`books[].rating` 은 고른 책마다 필수 1~5. 「건너뛰기」는 `{ "genres": [], "books": [] }` — 그래도 COMPLETED. 여러 번 보내면 덮어쓴다(멱등).""")
	@ApiResponses({
		@ApiResponse(responseCode = "204", description = "저장됨, 온보딩 완료. 본문 없음", content = @Content),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — genres 6개 이상, rating 누락·범위 밖, bookId 빈 값. details.fields[]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND — 없는 bookId. details.bookId", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@PostMapping("/me/preferences")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void savePreferences(@CurrentUserId Long userId, @Valid @RequestBody PreferencesRequest request) {
		onboardingService.savePreferences(userId, request);
	}
}
