package com.ssafy.b102.library.repository;

import java.util.Optional;
import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

	/**
	 * Book DNA 스냅샷(API_SPEC §3.4) — READ 를 완독일 내림차순(온보딩 seed 의 null 은 마지막)으로 먼저, 그 뒤 WISH.
	 * 최대 권수는 Pageable 로 자른다. 상태를 1차 키로 두는 이유: WISH 가 많은 서재에서 200권 상한에 READ 가 잘리면 안 된다.
	 * book 을 fetch join 해 두어 트랜잭션 밖(AI 호출 뒤)에서도 읽힌다.
	 */
	@Query("select li from LibraryItem li join fetch li.book"
		+ " where li.user.id = :userId"
		+ " order by case when li.status = :read then 0 else 1 end, li.finishedAt desc nulls last, li.updatedAt desc, li.id asc")
	List<LibraryItem> findDnaSnapshot(@Param("userId") Long userId, @Param("read") ShelfStatus read, Pageable pageable);
}
