package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * API_SPEC §1.5 BookSummary — 검색·인기·추천·서재가 같은 모양으로 책을 내보낸다.
 * 없는 값은 null 로 나간다(키는 항상 존재): pageCount(books 에 컬럼 없음). category 는 kdc_codes 로 만든 2단계 경로(KdcCategoryResolver).
 */
@Schema(description = "도서 요약 (API_SPEC §1.5). 목록형 응답의 공통 원소")
public record BookSummaryResponse(
	@Schema(description = "내부 도서 id. 불투명 문자열 — 숫자처럼 보여도 문자열로 다룬다", example = "88123") String bookId,
	@Schema(description = "ISBN13. 검색 도서는 항상 있다", example = "9788936434120", nullable = true) String isbn13,
	@Schema(description = "제목", example = "소년이 온다") String title,
	@Schema(description = "역할어(지음·옮김)를 뗀 저자명. 옮긴이는 제외. 없으면 []", example = "[\"한강\"]") List<String> authors,
	@Schema(description = "출판사", example = "창비", nullable = true) String publisher,
	@Schema(description = "출판 연도", example = "2014", nullable = true) Integer publicationYear,
	@Schema(description = "표지 URL(가장 큰 변형). 축소는 프론트 lib/coverUrl.ts", nullable = true) String coverUrl,
	@Schema(description = "쪽수. V1 에는 없어 항상 null", nullable = true) Integer pageCount,
	@Schema(description = "분류 경로 2단계 \"대분류 > 중분류\"(kdc_codes). 중분류가 없거나 같으면 대분류만. 서재 선반·DNA 장르 키가 이 값을 쓴다", example = "문학 > 한국문학", nullable = true) String category,
	@Schema(description = "KDC 코드(books.category_code)", example = "813.7", nullable = true) String classNo,
	@Schema(description = "시리즈 권차(books.vol). 시리즈는 권마다 제목이 같아 이게 없으면 화면에서 구별되지 않는다 — 비룡소 셜록 홈즈 7권이 모두 「셜록 홈즈」다. null 은 「단권」이 아니라 「미상」이다", example = "3", nullable = true) String volume
) {
}
