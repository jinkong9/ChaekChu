package com.ssafy.b102.recommendation.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.book.dto.SimilarBookResponse;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.recommendation.service.SimilarBookService;

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
 * API_SPEC §4.5 — 비슷한 책. 경로는 /books 아래지만 구현이 추천 엔진이라 recommendation 패키지에 둔다.
 * 경로 변수는 숫자만 받는다(`\d+`) — 같은 /books 아래의 /search·/popular 와 겹치지 않게(§4.4 와 같은 규칙).
 */
@Tag(name = "도서 상세", description = "비슷한 책(§4.5) — 소개 임베딩 이웃. 벡터는 Qdrant 에 있고 FastAPI 가 찾는다")
@RestController
@RequestMapping(ApiPaths.V1 + "/books")
public class SimilarBookController {

	private final SimilarBookService similarBookService;

	public SimilarBookController(SimilarBookService similarBookService) {
		this.similarBookService = similarBookService;
	}

	@Operation(summary = "비슷한 책", description = """
		기준 책의 소개 임베딩과 가까운 책을 유사도 내림차순으로 준다. 기준 책 자신은 빠진다.

		추천 엔진에 **이 책 한 권만 seed 로** 넣은 결과다. 의미 유사도만 쓰고 인기·신간 가중치는 0 이다 —
		「비슷한 책」 자리에 덜 닮았지만 많이 빌린 책이 올라오지 않게 하기 위해서다.

		**빈 배열이 정상 응답이다.** 아직 임베딩이 없는 책이 많아(09-15 기준 추천 후보 440,757권 중 10만 권 적재)
		상당수 책에서 `items: []` 가 나온다. 적재가 늘면 같은 요청이 저절로 채워진다.
		빈 배열로 나가는 경우: 기준 책의 벡터가 아직 없음 · 기준 책에 ISBN13 이 없음 · 이웃이 카탈로그에 없음.
		이때 `modelVersion`·`indexVersion` 도 null 이라 프론트는 「아직 준비되지 않았다」와 「정말 이웃이 없다」를 구분할 필요가 없다.

		`size` 기본 8, **최대 10**(AI 계약 상한). `reason` 은 AI 가 만든 한 문장, `score` 는 0~100 디버그용이다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "비슷한 책. 임베딩이 없으면 items 빈 배열"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — size 범위 밖(1~10)", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "404", description = "BOOK_NOT_FOUND — 없는 id·ISBN", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "503", description = "RECOMMENDATION_UNAVAILABLE — AI 서비스에 닿지 못함. 상세 화면의 다른 영역은 정상", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping("/{bookId:\\d+}/similar")
	public SimilarBookResponse similar(
		@Parameter(description = "내부 도서 id 또는 13자리 ISBN13", example = "88123") @PathVariable String bookId,
		@Parameter(description = "가져올 권수 1~10 (기본 8)", example = "4")
		@RequestParam(defaultValue = "8")
		@Min(value = 1, message = "1 이상이어야 합니다.")
		@Max(value = SimilarBookService.MAX_SIZE, message = "10 이하여야 합니다.") int size) {
		return similarBookService.similar(bookId, size);
	}
}
