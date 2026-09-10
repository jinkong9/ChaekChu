package com.ssafy.b102.library.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.library.dto.LibraryAddRequest;
import com.ssafy.b102.library.dto.LibraryItemResponse;
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
import jakarta.validation.Valid;

/** API_SPEC §6 — 내 서재. 전부 로그인 필요, 본인 행만. */
@Tag(name = "서재", description = """
	찜(WISH)·완독(READ) 2단(09-02 확정, 「읽는 중」없음). 찜 = WISH 이고 별도 좋아요는 없다.
	온보딩에서 고른 책은 READ + finishedDate=null(서비스 이전에 읽은 책)로 들어와 있다 — 연표·월별 통계에서는 프론트가 finishedDate 로 거른다.
	담기(POST)는 bookId·status 두 필드만 받고, 별점·감상은 응답의 libraryItemId 로 PATCH 한다.""")
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

	@Operation(summary = "서재에 담기 — 찜(WISH) 또는 읽음(READ)", description = """
		`bookId`·`status` 두 필드만 받는다. `READ` 면 `finishedDate` 를 오늘(Asia/Seoul)로 채우고, `WISH` 면 null. `source=SERVICE`.
		별점·감상은 여기서 받지 않는다 — 응답의 `libraryItemId` 로 `PATCH /library/{id}`.
		이미 서재에 있는 책이면 409 와 함께 `details.libraryItemId` 를 돌려주니 그걸로 PATCH 하면 된다(WISH → READ 승격 포함).""")
	@ApiResponses({
		@ApiResponse(responseCode = "201", description = "담김. LibraryItem 본문"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — bookId 빈 값, status 누락 또는 WISH/READ 밖. details.fields[]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND — 없는(또는 숫자가 아닌) bookId. details.bookId", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "409", description = "LIBRARY_ITEM_EXISTS — 이미 서재에 있음. details.libraryItemId (동시 요청 경합이면 details 없음)", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public LibraryItemResponse add(@CurrentUserId Long userId, @Valid @RequestBody LibraryAddRequest request) {
		return libraryService.add(userId, request);
	}
}
