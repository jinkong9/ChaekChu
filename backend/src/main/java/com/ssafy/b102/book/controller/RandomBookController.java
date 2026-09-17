package com.ssafy.b102.book.controller;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.service.RandomBookService;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * API_SPEC §4.8 — 가챠. 로그인 필요(●).
 * `/books/random` 은 BookDetailController 의 `/{bookId:\d+}` 와 겹치지 않는다(경로 변수가 숫자만 받는다).
 */
@Tag(name = "도서 가챠", description = """
	표지 있는 추천 후보(`books.is_candidate`) 중 무작위 한 권. 사용자가 가챠를 누를 때 한 건씩 부른다.
	응답은 BookSummary(§1.5) 단일 객체이고, 프론트는 `classNo` 를 이미 화면에 있는 DNA 레이더 축과 대조해 「취향 정중앙 / 가장자리 / 새 영역」 문구를 만든다 —
	서버는 AI 도 다른 API 도 부르지 않는다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class RandomBookController {

	/** 같은 URL 의 GET 이라 브라우저·프록시 어디서든 캐시되면 「매번 다른 책」이 깨진다. */
	private static final CacheControl NO_STORE = CacheControl.noStore();

	private final RandomBookService randomBookService;

	public RandomBookController(RandomBookService randomBookService) {
		this.randomBookService = randomBookService;
	}

	@Operation(summary = "무작위 도서 한 권(가챠)", description = """
		모집단은 **`is_candidate = true` 이고 표지가 있는 책**이다. 후보(약 44만)만으로는 부족하다 — 후보 제외 규칙 `NO_SIGNAL` 이
		소개·표지·키워드·관계 중 하나만 있어도 통과시켜 표지 없는 후보가 있고, 가챠는 표지를 300px 로 크게 띄우기 때문이다.

		요청마다 새로 뽑는다. `exclude` 에 직전 `bookId` 를 주면 그 책은 빠진다 — 연속 호출에서 같은 책이 나올 확률(모집단 역수, 0.001% 안팎)까지
		0 으로 막고 싶을 때만 붙인다. 서버는 이력을 저장하지 않는다.

		응답에 `Cache-Control: no-store` 가 붙는다. 뽑을 책이 없으면 404 — 운영에서는 나지 않고, 후보 배치를 안 돌린 로컬 DB 에서 난다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "BookSummary 한 건(봉투 없음)"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — exclude 가 숫자가 아님. details.fields[{field: \"exclude\"}]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND — 표지 있는 추천 후보가 한 권도 없음", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/random")
	public ResponseEntity<BookSummaryResponse> random(
		@Parameter(description = "직전에 뽑힌 bookId. 있으면 그 책은 제외한다. 생략 가능", example = "88123")
		@RequestParam(required = false) Long exclude) {
		return ResponseEntity.ok().cacheControl(NO_STORE).body(randomBookService.pick(exclude));
	}
}
