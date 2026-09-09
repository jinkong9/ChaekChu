package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * API_SPEC §1.5 BookSummary — 검색·인기·추천·서재가 같은 모양으로 책을 내보낸다.
 * V1 에 없는 값은 null 로 나간다(키는 항상 존재): pageCount(V2 books 확장), category 는 KDC 대분류 1단계까지(kdc_codes 는 V2).
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
	@Schema(description = "분류 경로. 지금은 KDC 대분류 1단계(\"문학\"), V2 에서 \"문학 > 한국소설\"", example = "문학", nullable = true) String category,
	@Schema(description = "KDC 코드(books.category_code)", example = "813.7", nullable = true) String classNo
) {
}
