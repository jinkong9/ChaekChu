package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.3 GET /books/popular-segments — 홈 인기 링. 정적 popular-ring.json 과 같은 모양을 API 로. */
@Schema(description = "세그먼트별 인기 상위 목록 (GET /books/popular-segments)")
public record PopularSegmentsResponse(
	@Schema(description = "이 스냅샷이 만들어진 시각(기준월 다음 달 1일 00:00Z). 데이터가 없으면 null", example = "2026-09-01T00:00:00Z", nullable = true)
	String generatedAt,
	@Schema(description = "집계 창(직전 3개월). 데이터가 없으면 null", nullable = true)
	Period period,
	@Schema(description = "세그먼트 목록. 연령 10·20·30·40·50·60 × F/M 순. 해당 기준월에 행이 있는 세그먼트만")
	List<Segment> segments
) {

	@Schema(description = "집계 기간")
	public record Period(
		@Schema(description = "시작일 YYYY-MM-DD", example = "2026-06-01") String startDate,
		@Schema(description = "종료일 YYYY-MM-DD", example = "2026-08-31") String endDate
	) {
	}

	@Schema(description = "세그먼트 하나")
	public record Segment(
		@Schema(description = "'{age}_{gender}'", example = "20_F") String id,
		@Schema(description = "표시용 라벨", example = "20대 여성") String label,
		@Schema(description = "연령대 10~60", example = "20") String age,
		@Schema(description = "F | M", example = "F") String gender,
		@Schema(description = "ranking 오름차순") List<Item> items
	) {
	}

	@Schema(description = "세그먼트 안의 한 권")
	public record Item(
		@Schema(description = "세그먼트 내 순위 1부터", example = "1") int ranking,
		@Schema(description = "기간 내 대출 건수. 원천에 없으면 null", example = "518", nullable = true) Integer loanCount,
		@Schema(description = "도서 요약") BookSummaryResponse book,
		@Schema(description = "큰 표지 URL. 지금은 book.coverUrl 과 같은 값(알라딘 cover500)", nullable = true) String coverLargeUrl
	) {
	}
}
