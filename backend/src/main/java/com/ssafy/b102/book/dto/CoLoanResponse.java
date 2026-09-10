package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.6 GET /books/{bookId}/co-loans — 정보나루 「함께 대출된 책」을 그대로 서빙한다. */
@Schema(description = "함께 대출된 책 (GET /books/{bookId}/co-loans)")
public record CoLoanResponse(
	@Schema(description = "rank 오름차순. 카탈로그에 없는 대상은 빠지므로 rank 가 건너뛸 수 있다. 관계가 없으면 []")
	List<Item> items,
	@Schema(description = "출처 고정값", example = "DATA4LIBRARY") String source,
	@Schema(description = "수집 시점 YYYY-MM. 관계가 없으면 null", example = "2026-08", nullable = true) String asOf
) {

	@Schema(description = "함께 대출된 책 한 권")
	public record Item(
		@Schema(description = "도서 요약 (§1.5)") BookSummaryResponse book,
		@Schema(description = "정보나루가 매긴 순위 1부터", example = "1") int rank
	) {
	}
}
