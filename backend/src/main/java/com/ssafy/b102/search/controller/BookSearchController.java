package com.ssafy.b102.search.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.search.dto.BookSearchResponse;
import com.ssafy.b102.search.service.BookSearchService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** API_SPEC §4.1 — 도서 검색. 로그인 필요(●). 파라미터 제약 위반은 HandlerMethodValidationException → 400 VALIDATION_FAILED. */
@Tag(name = "도서 검색", description = """
	제목·저자·출판사 검색. Elasticsearch(nori 형태소 + bigram 부분일치) 위에서 동작한다.
	`q` 가 ISBN 형태(하이픈·공백 무시, 978/979 로 시작하는 13자리)면 ISBN 정확 조회로 처리해 0 또는 1건을 돌려준다.
	정렬은 검색 점수(제목 완전일치 > 형태소 일치 > 부분일치) → 동점은 id 순. 대출 인기 정렬은 V2 컬럼이 생기면 붙인다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class BookSearchController {

	private final BookSearchService searchService;

	public BookSearchController(BookSearchService searchService) {
		this.searchService = searchService;
	}

	@Operation(summary = "도서 검색", description = """
		`q` 필수 1~100자(앞뒤 공백 제외). `page` 0부터(기본 0), `size` 1~50(기본 20) — §1.4.
		응답 `items[]` 는 BookSummary(§1.5): `bookId` 는 문자열, `authors` 는 역할어를 뗀 배열(옮긴이 제외), `category` 는 KDC 대분류("문학"),
		`pageCount` 는 V1 에 없어 항상 null(키는 있다). 결과 없음은 200 에 `total: 0, items: []`.
		ISBN 검색에서 카탈로그에 없는 책은 아직 외부 조회로 등록하지 않는다(빈 결과).""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "검색 결과. 없으면 total 0"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — q 비어 있음·100자 초과, page < 0, size 범위 밖. details.fields[{field, reason}]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "503", description = "SEARCH_UNAVAILABLE — 검색 엔진에 닿지 못함. 잠시 후 다시 시도 안내. 다른 기능은 정상", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/search")
	public BookSearchResponse search(
		@Parameter(description = "검색어 1~100자. 제목·저자·출판사 대상. ISBN(하이픈 가능)이면 정확 조회", example = "어린왕자")
		@RequestParam @NotBlank(message = "검색어는 비어 있을 수 없습니다.") @Size(max = 100, message = "검색어는 100자 이하여야 합니다.") String q,
		@Parameter(description = "페이지(0부터)", example = "0")
		@RequestParam(defaultValue = "0") @Min(value = 0, message = "0 이상이어야 합니다.") int page,
		@Parameter(description = "페이지 크기 1~50", example = "20")
		@RequestParam(defaultValue = "20") @Min(value = 1, message = "1 이상이어야 합니다.") @Max(value = 50, message = "50 이하여야 합니다.") int size) {
		return searchService.search(q, page, size);
	}
}
