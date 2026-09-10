package com.ssafy.b102.library.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.library.dto.LibraryListResponse;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.service.LibraryService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/** API_SPEC §6 — 내 서재. 전부 로그인 필요, 본인 행만. */
@Tag(name = "서재", description = """
	찜(WISH)·완독(READ) 2단(09-02 확정, 「읽는 중」없음). 찜 = WISH 이고 별도 좋아요는 없다.
	온보딩에서 고른 책은 READ + finishedDate=null(서비스 이전에 읽은 책)로 들어와 있다 — 연표·월별 통계에서는 프론트가 finishedDate 로 거른다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/library")
public class LibraryController {

	private final LibraryService libraryService;

	public LibraryController(LibraryService libraryService) {
		this.libraryService = libraryService;
	}

	@Operation(summary = "내 서재 조회", description = """
		JWT 사용자의 서재 전체를 updatedAt 내림차순으로 돌려준다. 페이지 없음(수백 권 규모). 비어 있으면 { "items": [] }.
		`status=WISH` 또는 `status=READ` 로 한 갈래만 볼 수 있다(대문자, 그 외 값은 400). 각 항목의 `libraryItemId` 를 PATCH/DELETE 에 쓴다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "서재 목록"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — status 가 WISH/READ 가 아님. details.fields[{field: status}]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/me")
	public LibraryListResponse mine(
		@CurrentUserId Long userId,
		@Parameter(description = "WISH | READ. 없으면 전체") @RequestParam(required = false) ShelfStatus status) {
		return libraryService.getMine(userId, status);
	}
}
