package com.ssafy.b102.book.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.book.dto.BookDetailResponse;
import com.ssafy.b102.book.dto.CoLoanResponse;
import com.ssafy.b102.book.service.BookDetailService;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * API_SPEC §4.4·§4.6 — 도서 상세와 함께 대출된 책.
 * 경로 변수는 숫자만 받는다(`\d+`) — 같은 `/books` 아래의 `/search`·`/popular`·`/popular-segments` 와 겹치지 않게.
 */
@Tag(name = "도서 상세", description = """
	한 권의 상세와 이웃 책. 서지·소개문은 `books`, 지표는 `book_demand_features`(월 스냅샷), 함께 대출된 책은 `book_relations`(정보나루) 에서 온다.
	경로의 `{bookId}` 는 **내부 id 또는 13자리 ISBN13** 둘 다 받는다 — 홈 인기 링이 ISBN 으로 이동하기 때문이며 응답의 `bookId` 는 항상 내부 id 다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class BookDetailController {

	private final BookDetailService bookDetailService;

	public BookDetailController(BookDetailService bookDetailService) {
		this.bookDetailService = bookDetailService;
	}

	@Operation(summary = "도서 상세", description = """
		BookSummary(§1.5) 필드를 평면으로 펼치고 상세 전용 필드를 더한다.

		`metrics` 는 **표시용 문자열**을 서버가 완성해 보낸다(`"27,551회"`, `"상위 3%"`). 값이 없는 지표는 배열에서 빠지므로 프론트는 온 것만 그린다.
		지금 나갈 수 있는 항목: 전국 대출 순위(상위 25% 이내일 때만) · 누적 대출 · 최근 3개월 대출(원천 10.8%) · 소장 도서관.

		`my` 는 로그인 사용자 **본인**의 서재 기록이고 담지 않았으면 null 이다. `libraryItemId` 가 있어 상세 화면에서 바로 `PATCH /library/{id}` 를 부를 수 있다(§9-5).

		항상 null 인 필드: `subtitle`(원천 없음) · `toc`(국중 목차 미적재) · `pageCount`(books 에 컬럼 없음) · `loanByAge`(정보나루 연령 분포 수집률 0.7%로 미적재).
		키는 계약대로 항상 존재하니 프론트는 값이 null 이면 해당 섹션을 숨기면 된다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "도서 상세"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND — 없는 id·ISBN. details.bookId 에 받은 값", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/{bookId:\\d+}")
	public BookDetailResponse detail(
		@CurrentUserId Long userId,
		@Parameter(description = "내부 도서 id 또는 13자리 ISBN13", example = "88123") @PathVariable String bookId) {
		return bookDetailService.detail(userId, bookId);
	}

	@Operation(summary = "함께 대출된 책", description = """
		정보나루가 집계한 「이 책과 함께 빌린 책」을 순위 그대로 돌려준다(책당 최대 10권). 추천이 아니라 원천 집계라 계산이 없다.

		카탈로그에 없는 대상은 목록에서 빠지므로 `rank` 가 중간에 건너뛸 수 있다 — 연결률은 99.9%다.
		관계 자체가 없는 책(전체의 83%, 주로 대출이 적은 꼬리)은 `items: []` 에 `asOf: null` 로 200 을 준다. 프론트는 비었으면 섹션을 숨긴다.
		`size` 기본 8, 최대 20.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "함께 대출된 책. 없으면 items 빈 배열"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — size 범위 밖(1~20)", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/{bookId:\\d+}/co-loans")
	public CoLoanResponse coLoans(
		@Parameter(description = "내부 도서 id 또는 13자리 ISBN13", example = "88123") @PathVariable String bookId,
		@Parameter(description = "가져올 권수 1~20 (기본 8)", example = "8")
		@RequestParam(defaultValue = "8")
		@Min(value = 1, message = "1 이상이어야 합니다.")
		@Max(value = BookDetailService.CO_LOAN_MAX_SIZE, message = "20 이하여야 합니다.") int size) {
		return bookDetailService.coLoans(bookId, size);
	}
}
