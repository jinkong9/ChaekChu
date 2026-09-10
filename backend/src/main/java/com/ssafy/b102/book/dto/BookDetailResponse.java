package com.ssafy.b102.book.dto;

import java.time.LocalDate;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * API_SPEC §4.4 GET /books/{bookId} — BookSummary 를 펼치고 상세 전용 필드를 더한다.
 * 목록 응답과 같은 이름·같은 의미를 유지하려고 BookSummary 를 중첩하지 않고 평면으로 편다(프론트 BookDetail extends BookSummary).
 */
@Schema(description = "도서 상세 (GET /books/{bookId})")
public record BookDetailResponse(
	@Schema(description = "내부 도서 id. ISBN13 으로 조회했어도 항상 내부 id", example = "88123") String bookId,
	@Schema(description = "ISBN13", example = "9788936434120", nullable = true) String isbn13,
	@Schema(description = "제목", example = "소년이 온다") String title,
	@Schema(description = "역할어를 뗀 저자명. 없으면 []", example = "[\"한강\"]") List<String> authors,
	@Schema(description = "출판사", example = "창비", nullable = true) String publisher,
	@Schema(description = "출판 연도", example = "2014", nullable = true) Integer publicationYear,
	@Schema(description = "표지 URL(가장 큰 변형)", nullable = true) String coverUrl,
	@Schema(description = "쪽수. books 에 없어 항상 null", nullable = true) Integer pageCount,
	@Schema(description = "분류 경로", example = "문학 > 한국문학", nullable = true) String category,
	@Schema(description = "KDC 코드", example = "813.62", nullable = true) String classNo,

	@Schema(description = "부제. 원천에 없어 항상 null", nullable = true) String subtitle,
	@Schema(description = "대표 소개문. 정보나루 → 형제 권 → 카카오 순으로 고른다", nullable = true) String description,
	@Schema(description = "대표 소개문의 출처", allowableValues = {"DATA4LIBRARY", "SIBLING", "KAKAO"}, example = "DATA4LIBRARY", nullable = true)
	String descriptionSource,
	@Schema(description = "목차. 원천(국중 회수분)이 적재되지 않아 항상 null", nullable = true) String toc,
	@Schema(description = "출처별 표시용 지표. 값이 없는 항목은 배열에서 빠진다 — 화면이 섹션을 숨긴다")
	List<Metric> metrics,
	@Schema(description = "연령대별 대출 분포. 원천(정보나루 loan_grps, 수집률 0.7%)을 적재하지 않아 항상 null", nullable = true)
	List<LoanByAge> loanByAge,
	@Schema(description = "내 서재 기록. 담지 않았으면 null. 본인 것만 — 타인 기록은 절대 나가지 않는다", nullable = true)
	MyRecord my
) {

	@Schema(description = "표시용 지표 한 줄")
	public record Metric(
		@Schema(description = "출처 표기", example = "정보나루") String source,
		@Schema(description = "지표 이름", example = "누적 대출") String name,
		@Schema(description = "표시용 문자열. 서버가 완성해 보내고 프론트는 그대로 그린다", example = "27,551회") String value,
		@Schema(description = "기준 시점 YYYY-MM", example = "2026-08") String asOf
	) {
	}

	@Schema(description = "연령대별 대출 비율")
	public record LoanByAge(
		@Schema(description = "연령대", example = "10대") String ageGroup,
		@Schema(description = "비율(%)", example = "8") double ratio
	) {
	}

	@Schema(description = "내 서재 기록 (API_SPEC §9-5)")
	public record MyRecord(
		@Schema(description = "서재 항목 id. PATCH /library/{id} 에 그대로 쓴다", example = "41") String libraryItemId,
		@Schema(description = "WISH | READ", example = "READ") String status,
		@Schema(description = "별점 1~5", example = "4", nullable = true) Integer rating,
		@Schema(description = "한 줄 감상", nullable = true) String reviewText,
		@Schema(description = "완독일. 온보딩 seed 는 READ 여도 null", example = "2026-09-01", nullable = true) LocalDate finishedDate
	) {
	}
}
