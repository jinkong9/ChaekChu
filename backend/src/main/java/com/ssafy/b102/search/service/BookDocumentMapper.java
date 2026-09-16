package com.ssafy.b102.search.service;

import org.springframework.stereotype.Component;

import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.repository.BookIndexRow;

/**
 * 색인 행(books + loan_cum) → ES 문서. 컬럼 대응은 BookDocument 주석, 저자 분해 규칙은 AuthorNameParser.
 * hasCover 는 cover_url 이 비어 있지 않은가(매핑 v3), loanCum 은 최신 수요 스냅샷의 누적 대출(v4), vol 은 원장 권차(v6).
 */
@Component
public class BookDocumentMapper {

	public BookDocument toDocument(BookIndexRow row) {
		String coverUrl = row.coverUrl();
		return BookDocument.builder()
			.id(row.id())
			.isbn13(row.isbn13())
			.title(row.title())
			.authors(AuthorNameParser.parse(row.author()))
			.authorRaw(row.author())
			.publisher(row.publisher())
			.pubYear(row.pubYear())
			.categoryCode(row.categoryCode())
			.coverUrl(coverUrl)
			.hasCover(coverUrl != null && !coverUrl.isBlank())
			.loanCum(row.loanCum())
			.vol(row.vol())
			.updatedAt(row.updatedAt())
			.build();
	}
}
