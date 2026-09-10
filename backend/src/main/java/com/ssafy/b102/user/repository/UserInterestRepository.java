package com.ssafy.b102.user.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.ssafy.b102.user.entity.UserInterest;

public interface UserInterestRepository extends JpaRepository<UserInterest, Long> {

	/** 사용자의 관심 태그 라벨 — 고른 순서(id) 대로. GET /users/me 의 interestTags 재료. */
	@Query("select ui.tag.label from UserInterest ui where ui.user.id = :userId order by ui.id")
	List<String> findTagLabelsByUserId(@Param("userId") Long userId);

	/** AI 요청용 taxonomy code — 사용자가 고른 순서(id) 대로. */
	@Query("select ui.tag.code from UserInterest ui where ui.user.id = :userId order by ui.id")
	List<String> findTagCodesByUserId(@Param("userId") Long userId);

	/** 취향 재제출 시 전체 교체용. 벌크 삭제라 즉시 실행된다(같은 트랜잭션의 뒤 insert 와 순서 보장). */
	@Modifying
	@Query("delete from UserInterest ui where ui.user.id = :userId")
	int deleteByUserId(@Param("userId") Long userId);
}
