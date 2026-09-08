package com.ssafy.b102.user.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.ssafy.b102.user.entity.Tag;

public interface TagRepository extends JpaRepository<Tag, String> {

	List<Tag> findByKind(String kind);
}
