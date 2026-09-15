package com.ssafy.b102.book.entity;

import java.time.Instant;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * V1 books — ISBN13 당 1행. 채우는 주체는 월 배치(원장 → usage → 카카오)라 서비스 코드는 읽기만 한다.
 * V2 에서 authors TEXT[]·work_key·popularity_score 등이 늘어난다(DB_TABLE_DESIGN §3).
 */
@Entity
@Table(name = "books")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Book {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(nullable = false, length = 13)
	private String isbn13;

	@Column(nullable = false, length = 500)
	private String title;

	@Column(length = 300)
	private String author;

	@Column(length = 200)
	private String publisher;

	@Column(name = "pub_year")
	private Short pubYear;

	@Column(name = "category_code", length = 10)
	private String categoryCode;

	@Column(columnDefinition = "TEXT")
	private String description;

	/** V2 — 대표 소개문의 출처. DATA4LIBRARY / SIBLING(같은 세트 형제 권) / KAKAO / NULL(소개 없음). */
	@Column(name = "description_source", length = 20)
	private String descriptionSource;

	@Column(name = "cover_url", length = 500)
	private String coverUrl;

	@Column(name = "embedding_version", length = 30)
	private String embeddingVersion;

	/**
	 * 원장 권차(V6). 시리즈는 권마다 제목이 같아 이 값이 유일한 구분자다 — 비룡소 셜록 홈즈 7권이 제목·저자·연도까지 같다.
	 * <b>NULL 은 「단권」이 아니라 「미상」이다.</b> 도서관이 안 적었을 수 있으니 단권 판정에 쓰면 안 된다.
	 */
	@Column(name = "vol", length = 20)
	private String vol;

	/** 세트(시리즈) 대표 ISBN(V6). 같은 세트의 권들이 공유한다 — 작품 식별자가 아니라 「세트의 한 권」이라는 신호다. */
	@Column(name = "set_isbn", length = 13)
	private String setIsbn;

	@CreationTimestamp
	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@UpdateTimestamp
	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;
}
