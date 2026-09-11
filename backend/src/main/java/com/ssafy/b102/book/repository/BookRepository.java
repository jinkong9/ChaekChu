package com.ssafy.b102.book.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.ssafy.b102.book.entity.Book;

public interface BookRepository extends JpaRepository<Book, Long> {

	Optional<Book> findByIsbn13(String isbn13);

	List<Book> findByIsbn13In(Collection<String> isbns);

	/** 서지 없이 내부 id 만 필요할 때(이벤트 수집). 행 하나를 통째로 읽지 않는다. */
	@Query("select b.id from Book b where b.isbn13 = :isbn13")
	Optional<Long> findIdByIsbn13(String isbn13);

	// ── 검색 색인기(search.BookIndexService)용 keyset 페이징. OFFSET 없이 "마지막 id 다음부터 N건" 으로 전체를 훑는다. ──

	List<Book> findByIdGreaterThanOrderByIdAsc(Long id, Pageable pageable);

	List<Book> findByUpdatedAtAfterAndIdGreaterThanOrderByIdAsc(Instant updatedAfter, Long id, Pageable pageable);
}
