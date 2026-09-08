package com.ssafy.b102.user.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.ssafy.b102.user.entity.UserInterest;

public interface UserInterestRepository extends JpaRepository<UserInterest, Long> {

	/** 사용자의 관심 태그 라벨 — 고른 순서(id) 대로. GET /users/me 의 interestTags 재료. */
	@Query("select ui.tag.label from UserInterest ui where ui.user.id = :userId order by ui.id")
	List<String> findTagLabelsByUserId(@Param("userId") Long userId);
}
