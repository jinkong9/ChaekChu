package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.2 GET /books/popular — 온보딩 2단계 「알 만한 책」 그리드. */
@Schema(description = "세그먼트 인기 도서 (GET /books/popular)")
public record PopularBooksResponse(
	@Schema(description = "적용된 세그먼트. 연령·성별을 모두 알면 그 세그먼트, 연령만 알면 gender=null, 둘 다 모르면 null(전체 인기)", nullable = true)
	SegmentInfo segment,
	@Schema(description = "인기 순. coverUrl·category 는 항상 채워진 책만 — 온보딩 그리드가 글자로 뜨지 않게(§9-9)")
	List<BookSummaryResponse> items
) {

	@Schema(description = "연령×성별 세그먼트")
	public record SegmentInfo(
		@Schema(description = "연령대 10·20·30·40·50·60(60 은 60대 이상)", example = "20") String age,
		@Schema(description = "F | M. 성별을 모르면 null", example = "F", nullable = true) String gender,
		@Schema(description = "표시용 라벨", example = "20대 여성") String label
	) {
	}
}
