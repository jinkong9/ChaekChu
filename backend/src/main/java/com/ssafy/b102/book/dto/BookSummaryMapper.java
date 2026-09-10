package com.ssafy.b102.book.dto;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.entity.KdcMainClass;
import com.ssafy.b102.search.service.AuthorNameParser;

/**
 * V1 books 컬럼 → BookSummary(API_SPEC §1.5). 검색은 ES 문서에서 같은 모양을 만들고(BookSearchService.toSummary),
 * 인기·서재·추천처럼 PG 에서 직접 읽는 곳은 여기를 쓴다. 저자 분해·KDC 라벨 규칙은 검색과 동일하게 유지한다.
 */
public final class BookSummaryMapper {

	private BookSummaryMapper() {
	}

	public static BookSummaryResponse from(Book book) {
		return of(book.getId(), book.getIsbn13(), book.getTitle(), book.getAuthor(), book.getPublisher(),
			book.getPubYear() == null ? null : book.getPubYear().intValue(), book.getCategoryCode(), book.getCoverUrl());
	}

	public static BookSummaryResponse of(Long id, String isbn13, String title, String authorRaw, String publisher,
		Integer pubYear, String categoryCode, String coverUrl) {
		return new BookSummaryResponse(
			String.valueOf(id),
			isbn13 == null ? null : isbn13.trim(),
			title,
			AuthorNameParser.parse(authorRaw),
			publisher,
			pubYear,
			coverUrl,
			null,                                   // pageCount — V1 books 에 없음
			KdcMainClass.labelOf(categoryCode),     // 대분류 1단계. kdc_codes 2단계 경로는 검색과 함께 바꾼다
			categoryCode);
	}
}
