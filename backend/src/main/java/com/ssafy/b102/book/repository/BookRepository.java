package com.ssafy.b102.book.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.ssafy.b102.book.entity.Book;

public interface BookRepository extends JpaRepository<Book, Long> {

	Optional<Book> findByIsbn13(String isbn13);

	List<Book> findByIsbn13In(Collection<String> isbns);

	/** 서지 없이 내부 id 만 필요할 때(이벤트 수집). 행 하나를 통째로 읽지 않는다. */
	@Query("select b.id from Book b where b.isbn13 = :isbn13")
	Optional<Long> findIdByIsbn13(String isbn13);

	// 검색 색인기는 여기를 쓰지 않는다 — books 와 book_demand_features.loan_cum 을 함께 읽어야 해서
	// 색인 전용 JdbcTemplate 리포지토리(search.repository.BookIndexRowRepository)로 옮겼다(매핑 v4).
}
