package com.ssafy.b102.book.dto;

import org.springframework.stereotype.Component;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.service.KdcCategoryResolver;
import com.ssafy.b102.search.service.AuthorNameParser;

/**
 * V1 books 컬럼 → BookSummary(API_SPEC §1.5). 검색은 ES 문서에서 같은 모양을 만들고(BookSearchService.toSummary),
 * 인기·서재·상세처럼 PG 에서 직접 읽는 곳은 여기를 쓴다.
 *
 * 저자 분해(AuthorNameParser)와 분류 경로(KdcCategoryResolver, "문학 &gt; 한국문학")를 검색과 같은 규칙으로 맞춘다.
 * 같은 책이 검색에서는 2단계 경로, 서재에서는 대분류로 보이면 프론트가 같은 필드를 화면마다 다르게 그린다 —
 * 09-10 에 정적 유틸에서 빈으로 바꾼 이유가 이것이다(분류 사전 주입).
 */
@Component
public class BookSummaryMapper {

	private final KdcCategoryResolver kdc;

	public BookSummaryMapper(KdcCategoryResolver kdc) {
		this.kdc = kdc;
	}

	public BookSummaryResponse from(Book book) {
		return of(book.getId(), book.getIsbn13(), book.getTitle(), book.getAuthor(), book.getPublisher(),
			book.getPubYear() == null ? null : book.getPubYear().intValue(), book.getCategoryCode(), book.getCoverUrl(),
			book.getVol());
	}

	/** 권차를 모르는 호출부용(조인 결과 등). 시리즈면 화면에서 권이 구별되지 않는다. */
	public BookSummaryResponse of(Long id, String isbn13, String title, String authorRaw, String publisher,
		Integer pubYear, String categoryCode, String coverUrl) {
		return of(id, isbn13, title, authorRaw, publisher, pubYear, categoryCode, coverUrl, null);
	}

	public BookSummaryResponse of(Long id, String isbn13, String title, String authorRaw, String publisher,
		Integer pubYear, String categoryCode, String coverUrl, String vol) {
		return new BookSummaryResponse(
			String.valueOf(id),
			isbn13 == null ? null : isbn13.trim(),
			title,
			AuthorNameParser.parse(authorRaw),
			publisher,
			pubYear,
			coverUrl,
			null,                          // pageCount — books 에 없음
			kdc.pathOf(categoryCode),      // "문학 > 한국문학" (kdc_codes 2단계, 없으면 대분류 폴백)
			categoryCode,
			vol);
	}
}
