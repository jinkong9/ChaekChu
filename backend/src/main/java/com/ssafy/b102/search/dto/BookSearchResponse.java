package com.ssafy.b102.search.dto;

import java.util.List;

import com.ssafy.b102.book.dto.BookSummaryResponse;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.1 GET /books/search 응답. 봉투 없음(§1.3), 페이지 정보는 §1.4. */
@Schema(description = "도서 검색 결과 (GET /books/search)")
public record BookSearchResponse(
	@Schema(description = "조건에 맞는 전체 건수(정확값)", example = "37") long total,
	@Schema(description = "요청한 페이지(0부터)", example = "0") int page,
	@Schema(description = "요청한 페이지 크기", example = "20") int size,
	@Schema(description = "이 페이지의 도서. 점수 순 → 동점은 누적 대출 많은 순 → id 순") List<BookSummaryResponse> items
) {
}
