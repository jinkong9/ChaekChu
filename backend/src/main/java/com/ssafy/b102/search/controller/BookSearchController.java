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
import jakarta.validation.constraints.Size;

/** API_SPEC §4.1 — 도서 검색. 로그인 필요(●). 파라미터 제약 위반은 HandlerMethodValidationException → 400 VALIDATION_FAILED. */
@Tag(name = "도서 검색", description = """
	제목·저자·출판사 검색 + KDC 분류 필터 + 검색 범위(scope). Elasticsearch(nori 형태소 + bigram 부분일치) 위에서 동작한다.
	`q` 가 ISBN 형태(하이픈·공백 무시, 978/979 로 시작하는 13자리)면 ISBN 정확 조회로 처리해 0 또는 1건을 돌려준다.
	`scope` 로 검색어를 댈 필드를 고른다 — `all`(기본, 제목·저자·출판사) · `title` · `author` · `publisher`. 매핑은 같고 점수를 내는 필드만 다르다.
	정렬은 `q` 가 있으면 검색 점수(완전일치 > 형태소 일치 > 부분일치, 표지 없으면 ×0.7) → 동점은 누적 대출 많은 순(같은 작품의 판본 사이) → id 순,
	`q` 없이 `kdc` 만이면 누적 대출 많은 순 → id 순이다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class BookSearchController {

	private final BookSearchService searchService;

	public BookSearchController(BookSearchService searchService) {
		this.searchService = searchService;
	}

	@Operation(summary = "도서 검색", description = """
		`q` 와 `kdc` 중 **하나는 필수**(둘 다 없으면 400). `q` 는 1~100자(앞뒤 공백 제외), `page` 0부터(기본 0), `size` 1~50(기본 20) — §1.4.

		`scope` 는 검색 범위(09-17): `all`(기본·생략 가능, 제목·저자·출판사) · `title` · `author` · `publisher`. 대소문자 무시.
		`all` 은 지금까지의 동작 그대로라 기존 호출은 바꿀 것이 없다. 나머지는 그 필드 하나만 보므로 `한강 소년` 같은 저자+제목 섞인 검색어는 못 찾는다(의도된 동작).
		정렬·`kdc` 필터·페이징·탐색 한도는 범위와 무관하게 같다. 넷 중 하나가 아니면 400.

		`kdc` 는 KDC 코드 prefix 1~3자리다: `8`(문학) · `81`(한국문학) · `813`(소설). `books.category_code`("813.62")의 앞자리와 맞춘다.
		점수에 끼지 않는 필터라 `q` 와 함께 쓰면 관련도 순서가 그대로 유지되고, `q` 없이 `kdc` 만 보내면 그 분류의 책을 누적 대출 많은 순으로 준다.

		**탐색 한도 10,000건.** `page × size + size` 가 이를 넘으면 400 이다(`size=20` 이면 `page` 0~499 = 화면 1~500쪽).
		`total` 은 필터 적용 후 전체 건수라 한도보다 클 수 있다 — 화면은 「총 N건 · 상위 10,000건 표시」처럼 구분해 보여 주고,
		그 이상은 중분류나 검색어로 좁히도록 유도한다. 커서 방식(search_after)은 두지 않는다.

		응답 `items[]` 는 BookSummary(§1.5): `bookId` 는 문자열, `authors` 는 역할어를 뗀 배열(옮긴이 제외), `category` 는 KDC 경로("문학 > 한국문학"),
		`pageCount` 는 V1 에 없어 항상 null(키는 있다). 결과 없음은 200 에 `total: 0, items: []`.
		ISBN 검색은 한 권이라 `kdc`·`scope` 를 함께 보내도 무시한다. 카탈로그에 없는 ISBN 은 아직 외부 조회로 등록하지 않는다(빈 결과).""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "검색 결과. 없으면 total 0"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — q·kdc 둘 다 없음, q 100자 초과, kdc 가 1~3자리 숫자 아님, scope 가 all·title·author·publisher 아님, page 가 탐색 한도 초과, size 범위 밖. details.fields[{field, reason}]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "503", description = "SEARCH_UNAVAILABLE — 검색 엔진에 닿지 못함. 잠시 후 다시 시도 안내. 다른 기능은 정상", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/search")
	public BookSearchResponse search(
		@Parameter(description = "검색어 1~100자. 제목·저자·출판사 대상(scope 로 좁힐 수 있다). ISBN(하이픈 가능)이면 정확 조회. kdc 가 있으면 생략 가능", example = "어린왕자")
		@RequestParam(required = false) @Size(max = 100, message = "검색어는 100자 이하여야 합니다.") String q,
		@Parameter(description = "KDC 코드 prefix 1~3자리(8 · 81 · 813). q 가 있으면 필터로만 쓰인다", example = "8")
		@RequestParam(required = false) String kdc,
		@Parameter(description = "검색 범위. all(기본, 제목·저자·출판사) · title · author · publisher. 대소문자 무시. q 가 ISBN 이면 무시", example = "author")
		@RequestParam(required = false) String scope,
		@Parameter(description = "페이지(0부터). page × size + size ≤ 10000", example = "0")
		@RequestParam(defaultValue = "0") @Min(value = 0, message = "0 이상이어야 합니다.") int page,
		@Parameter(description = "페이지 크기 1~50", example = "20")
		@RequestParam(defaultValue = "20") @Min(value = 1, message = "1 이상이어야 합니다.") @Max(value = 50, message = "50 이하여야 합니다.") int size) {
		return searchService.search(q, kdc, scope, page, size);
	}
}
