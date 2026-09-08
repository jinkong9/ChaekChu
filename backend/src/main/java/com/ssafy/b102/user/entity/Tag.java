package com.ssafy.b102.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** V1 tags — 관심·추천 태그 사전 (1회 적재). 온보딩 라벨 ↔ 코드 표는 API_SPEC §3.3. */
@Entity
@Table(name = "tags")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Tag {

	@Id
	@Column(name = "tag_code", length = 30)
	private String code;

	@Column(nullable = false, length = 50)
	private String label;

	@Column(nullable = false, length = 10)
	private String kind;
}
