package com.ssafy.b102.search.repository;

import java.time.Instant;

/**
 * 색인 전용 한 행 — books + book_demand_features.loan_cum(최신 스냅샷) 을 LEFT JOIN 한 결과.
 *
 * JPA {@code Book} 엔티티에 대출 지표를 끌어들이지 않으려고 따로 둔다. 색인기만 쓰는 읽기 모델이라
 * 필드는 ES 문서(BookDocument)가 필요한 것만 담는다. 조립은 BookDocumentMapper.
 */
public record BookIndexRow(
	Long id,
	String isbn13,
	String title,
	String author,
	String publisher,
	Integer pubYear,
	String categoryCode,
	String coverUrl,
	String vol,
	Long loanCum,
	Instant updatedAt
) {
}
