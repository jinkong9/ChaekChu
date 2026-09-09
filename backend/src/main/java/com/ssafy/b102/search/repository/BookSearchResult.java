package com.ssafy.b102.search.repository;

import java.util.List;

import com.ssafy.b102.search.document.BookDocument;

/**
 * 검색 한 페이지. total 은 조건에 맞는 전체 건수(track_total_hits 정확값), items 는 이 페이지의 문서(점수 순).
 * API 응답(BookSearchResponse)으로 바꾸는 것은 서비스 몫이다.
 */
public record BookSearchResult(long total, List<BookDocument> items) {

	public static BookSearchResult empty() {
		return new BookSearchResult(0, List.of());
	}
}
