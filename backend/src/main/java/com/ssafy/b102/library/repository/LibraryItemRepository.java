package com.ssafy.b102.library.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.ssafy.b102.library.entity.LibraryItem;

public interface LibraryItemRepository extends JpaRepository<LibraryItem, Long> {

	Optional<LibraryItem> findByUserIdAndBookId(Long userId, Long bookId);
}
