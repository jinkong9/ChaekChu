package com.ssafy.b102.library.repository;

import java.util.Optional;
import java.util.List;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;

public interface LibraryItemRepository extends JpaRepository<LibraryItem, Long> {

	Optional<LibraryItem> findByUserIdAndBookId(Long userId, Long bookId);

	/** PATCH/DELETE 한 건 — 응답이 book 을 펼치므로 함께 읽어 두 번째 SELECT 를 막는다. */
	@EntityGraph(attributePaths = "book")
	Optional<LibraryItem> findWithBookById(Long id);

	/** 서재 전체(GET /library/me)·추천 seed. 응답이 book 을 항상 펼치므로 함께 읽어 N+1 을 막는다. */
	@EntityGraph(attributePaths = "book")
	List<LibraryItem> findByUser_IdOrderByUpdatedAtDesc(Long userId);

	/** GET /library/me?status= — 찜(WISH) 또는 완독(READ)만. */
	@EntityGraph(attributePaths = "book")
	List<LibraryItem> findByUser_IdAndStatusOrderByUpdatedAtDesc(Long userId, ShelfStatus status);
}
