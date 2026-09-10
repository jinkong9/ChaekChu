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

	/**
	 * 서재 API(POST /library)로 담는 행 — source=SERVICE.
	 * 「WISH 면 완독일 없음」(CHECK ck_ul_finished) 규칙은 여기 한 곳이 가진다: 서비스는 오늘(Asia/Seoul)을 그냥 넘기고, READ 일 때만 쓴다.
	 */
	public static LibraryItem serviceEntry(User user, Book book, ShelfStatus status, LocalDate today) {
		LibraryItem li = new LibraryItem();
		li.user = user;
		li.book = book;
		li.status = status;
		li.finishedAt = status == ShelfStatus.READ ? today : null;
		li.source = LibrarySource.SERVICE;
		return li;
	}

	public void updateRating(Integer rating) {
		this.rating = rating == null ? null : rating.shortValue();
	}

	/** 감상은 서비스가 이미 strip·빈 값→null 처리해서 넘긴다(CHECK ck_ul_review: 공백만은 금지). */
	public void updateReviewText(String reviewText) {
		this.reviewText = reviewText;
	}

	/** WISH 로 — 완독일은 무조건 비운다(CHECK ck_ul_finished). 평점·감상은 남긴다(계약 §4.2). */
	public void markWish() {
		this.status = ShelfStatus.WISH;
		this.finishedAt = null;
	}

	/** READ 로 — 완독일은 서비스가 정한다(지정일 / Asia/Seoul 오늘 / null). */
	public void markRead(LocalDate finishedAt) {
		this.status = ShelfStatus.READ;
		this.finishedAt = finishedAt;
	}

	/** 완독일만 바꾼다. READ 항목에 한해 반영(API_SPEC §6.3) — WISH 면 무시. */
	public void updateFinishedAt(LocalDate finishedAt) {
		if (this.status == ShelfStatus.READ) {
			this.finishedAt = finishedAt;
		}
	}
}
