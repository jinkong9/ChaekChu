package com.ssafy.b102.library.entity;

import java.time.Instant;
import java.time.LocalDate;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.user.entity.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * V1 user_library — 서재 한 줄 (user_id, book_id) UNIQUE. 찜/완독 + 평점·감상.
 * CHECK: status ∈ WISH/READ · rating 1~5 · WISH 면 finished_at NULL · READ 는 완독일이 있어도(서재 API) 없어도(온보딩 seed) 된다.
 */
@Entity
@Table(name = "user_library")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LibraryItem {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_id", nullable = false)
	private User user;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "book_id", nullable = false)
	private Book book;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 15)
	private ShelfStatus status;

	private Short rating;

	@Column(name = "review_text", length = 300)
	private String reviewText;

	@Column(name = "finished_at")
	private LocalDate finishedAt;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 15)
	private LibrarySource source;

	@CreationTimestamp
	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@UpdateTimestamp
	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	/** 온보딩 seed — 서비스를 만나기 전에 읽은 책. READ 인데 완독일은 비운다(API_SPEC §3.3). */
	public static LibraryItem onboardingSeed(User user, Book book, int rating) {
		LibraryItem li = new LibraryItem();
		li.user = user;
		li.book = book;
		li.status = ShelfStatus.READ;
		li.rating = (short) rating;
		li.finishedAt = null;
		li.source = LibrarySource.ONBOARDING;
		return li;
	}

	public void updateRating(Integer rating) {
		this.rating = rating == null ? null : rating.shortValue();
	}
}
