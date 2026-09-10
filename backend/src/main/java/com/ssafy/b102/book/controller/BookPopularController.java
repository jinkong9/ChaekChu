package com.ssafy.b102.book.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.book.dto.PopularBooksResponse;
import com.ssafy.b102.book.dto.PopularSegmentsResponse;
import com.ssafy.b102.book.service.PopularBookService;
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

/** API_SPEC §4.2·§4.3 — 세그먼트(연령×성별) 인기. 원천은 정보나루 세그먼트 대출 순위(월 1회 적재, 직전 3개월 창). */
@Tag(name = "도서 인기", description = """
	정보나루 연령×성별 대출 순위(`book_loaned_top20`, 세그먼트당 상위 100위, 월 1회 적재) 위의 읽기 API.
	온보딩 2단계 그리드(`/books/popular`)와 홈 인기 링(`/books/popular-segments`)이 쓴다. 두 응답의 책은 모두 BookSummary(§1.5)이고
	표지·분류가 없는 책은 목록에서 제외해 화면이 글자로만 뜨지 않게 한다(§9-9).""")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class BookPopularController {

	private final PopularBookService popularBookService;

	public BookPopularController(PopularBookService popularBookService) {
		this.popularBookService = popularBookService;
	}

	@Operation(summary = "내 세그먼트 인기 도서 — 온보딩 2단계 「알 만한 책」 그리드", description = """
		로그인 사용자의 프로필(출생연도·성별)로 세그먼트를 정해 인기 상위 `size` 권을 돌려준다. **온보딩 중(PENDING)에도 호출 가능**하다.

		세그먼트 규칙(프론트 mock 과 동일):
		① 출생연도·성별 모두 있음 → 그 세그먼트 순위 그대로, `segment: { age, gender, label: "20대 여성" }`
		② 출생연도만(성별 응답 안 함) → 같은 연령대 남·녀를 책 단위로 대출 건수 합산해 재정렬, `segment: { age, gender: null, label: "20대" }`
		③ 둘 다 없음 → 전 세그먼트 합산, `segment: null`
		연령대는 (올해 − 출생연도)를 10 단위로 내림, 10~60(60 = 60대 이상).

		`items` 는 인기 순이고 `coverUrl`·`category` 가 채워진 책만 온다. 기준월 데이터가 없으면 `items: []`(200).
		`size` 기본 12, 최대 40.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "세그먼트와 인기 목록"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — size 범위 밖(1~40)", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "USER_NOT_FOUND — 토큰은 유효하지만 사용자 행이 없음", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/popular")
	public PopularBooksResponse popular(
		@CurrentUserId Long userId,
		@Parameter(description = "가져올 권수 1~40 (기본 12)", example = "12")
		@RequestParam(defaultValue = "12")
		@Min(value = 1, message = "1 이상이어야 합니다.") @Max(value = PopularBookService.MAX_SIZE, message = "40 이하여야 합니다.") int size) {
		return popularBookService.popularFor(userId, size);
	}

	@Operation(summary = "세그먼트별 인기 상위 20 — 홈 인기 링", description = """
		기준월(가장 최근 적재분)의 세그먼트마다 상위 20권. 정적 `popular-ring.json` 과 같은 모양이며 차이는 §9-8 대로
		`gender` 가 `M`/`F`, `publicationYear` 가 숫자, 책 필드가 BookSummary 로 정리된 것.
		세그먼트는 연령 10·20·30·40·50·60(60대 이상) × F/M 최대 12개 — 기준월에 행이 있는 것만 온다. `period` 는 집계 창(직전 3개월),
		`generatedAt` 은 기준월 다음 달 1일 00:00Z(적재 시각 대신 쓰는 결정적 값). 데이터가 없으면 `segments: []` 에 `period`·`generatedAt` 은 null.
		월 1회 바뀌는 값이라 프론트는 세션 동안 캐시해도 된다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "세그먼트 목록"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/popular-segments")
	public PopularSegmentsResponse popularSegments() {
		return popularBookService.segments();
	}
}
