package com.ssafy.b102.book.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.ssafy.b102.book.entity.Book;

public interface BookRepository extends JpaRepository<Book, Long> {

	Optional<Book> findByIsbn13(String isbn13);
}
