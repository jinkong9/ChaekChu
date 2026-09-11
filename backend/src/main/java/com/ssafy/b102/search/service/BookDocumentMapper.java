package com.ssafy.b102.search.service;

import org.springframework.stereotype.Component;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.search.document.BookDocument;

/** V1 books 한 행 → ES 문서. 컬럼 대응은 BookDocument 주석, 저자 분해 규칙은 AuthorNameParser. */
@Component
public class BookDocumentMapper {

	public BookDocument toDocument(Book book) {
		return BookDocument.builder()
			.id(book.getId())
			.isbn13(book.getIsbn13())
			.title(book.getTitle())
			.authors(AuthorNameParser.parse(book.getAuthor()))
			.authorRaw(book.getAuthor())
			.publisher(book.getPublisher())
			.pubYear(book.getPubYear() == null ? null : book.getPubYear().intValue())
			.categoryCode(book.getCategoryCode())
			.coverUrl(book.getCoverUrl())
			.hasCover(book.getCoverUrl() != null && !book.getCoverUrl().isBlank())
			.updatedAt(book.getUpdatedAt())
			.build();
	}
}
