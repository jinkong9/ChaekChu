package com.ssafy.b102.library.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
import com.ssafy.b102.library.dto.LibraryPatchRequest;
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
	담기(POST)는 bookId·status 두 필드만 받고, 별점·감상은 응답의 libraryItemId 로 PATCH 한다. 타인 항목은 403.""")
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

	@Operation(summary = "서재 항목 부분 갱신 — 상태·별점·감상·완독일", description = """
		보낸 필드만 바꾼다. 키를 빼면 유지, `rating`·`reviewText`·`finishedDate` 에 null 을 보내면 지운다.
		`status=READ` 로 바꾸며 `finishedDate` 가 없으면 오늘(Asia/Seoul). 이미 READ 인데 READ 를 다시 보내면 완독일 유지(멱등).
		`status=WISH` 로 바꾸면 `finishedDate=null`(평점·감상은 남는다).
		`status` 없이 `finishedDate` 만 보내면 READ 항목에 한해 반영 — WISH 항목은 무시. 온보딩 seed(READ·완독일 null)에 별점만 고쳐도 null 은 그대로다.
		`reviewText` 는 앞뒤 공백 제거, 빈 문자열은 null, 300자 초과 400. `rating` 은 1~5 정수 또는 null. 검증 위반은 모아서 한 번에 400.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "갱신된 LibraryItem"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — details.fields[{field, reason}] (status·rating·reviewText·finishedDate)", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "403", description = "FORBIDDEN — 타인의 서재 항목", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "LIBRARY_ITEM_NOT_FOUND — 없는(또는 숫자가 아닌) libraryItemId. details.libraryItemId", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@PatchMapping("/{libraryItemId}")
	public LibraryItemResponse patch(
		@CurrentUserId Long userId,
		@Parameter(description = "서재 항목 id (GET /library/me 또는 POST 응답의 libraryItemId)") @PathVariable String libraryItemId,
		@RequestBody LibraryPatchRequest request) {
		return libraryService.patch(userId, libraryItemId, request);
	}

	@Operation(summary = "서재에서 빼기 — 찜 해제·완독 기록 삭제", description = """
		행을 지운다(찜 해제도 이걸로). 계약 §4.2 「READ 는 WISH 취소만으로 삭제하지 않는다」는 상태 변경(PATCH)의 규칙이고, 명시적 삭제는 허용한다.
		같은 책을 다시 담으면 새 행(새 libraryItemId)이 된다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "204", description = "삭제됨. 본문 없음", content = @Content),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "403", description = "FORBIDDEN — 타인의 서재 항목", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "LIBRARY_ITEM_NOT_FOUND — 없는(이미 지운) libraryItemId", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@DeleteMapping("/{libraryItemId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@CurrentUserId Long userId, @PathVariable String libraryItemId) {
		libraryService.delete(userId, libraryItemId);
	}
}
