package com.ssafy.b102.library.dto;

import java.time.Instant;
import java.time.LocalDate;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.library.entity.LibraryItem;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * API_SPEC §6 LibraryItem — 서재 한 줄. 프론트 types.ts 의 LibraryItem 과 같은 모양.
 * reviewText 는 본인 전용이라 여기(본인 서재)에서만 나간다.
 */
@Schema(description = "서재 항목 (API_SPEC §6)")
public record LibraryItemResponse(
	@Schema(description = "서재 항목 id. 불투명 문자열 — PATCH/DELETE 경로에 그대로 쓴다", example = "41") String libraryItemId,
	@Schema(description = "책 요약 (§1.5)") BookSummaryResponse book,
	@Schema(description = "WISH(찜) | READ(완독). 2단 확정(09-02)", allowableValues = {"WISH", "READ"}, example = "READ") String status,
	@Schema(description = "별점 1~5 정수. 없으면 null", example = "4", nullable = true) Integer rating,
	@Schema(description = "한 줄 감상(≤300자). 없으면 null", example = "전개가 빠르다.", nullable = true) String reviewText,
	@Schema(description = "완독일(yyyy-MM-dd). READ 일 때만. 온보딩 seed 는 READ 여도 null(서비스 이전에 읽은 책)", example = "2026-09-01", nullable = true) LocalDate finishedDate,
	@Schema(description = "담은 시각(UTC ISO-8601)", example = "2026-09-01T03:12:44.120Z") Instant createdAt,
	@Schema(description = "마지막 변경 시각(UTC ISO-8601). 목록 정렬 기준", example = "2026-09-07T11:02:10.004Z") Instant updatedAt
) {

	public static LibraryItemResponse from(LibraryItem item, BookSummaryMapper bookMapper) {
		return new LibraryItemResponse(
			String.valueOf(item.getId()),
			bookMapper.from(item.getBook()),
			item.getStatus().name(),
			item.getRating() == null ? null : item.getRating().intValue(),
			item.getReviewText(),
			item.getFinishedAt(),
			item.getCreatedAt(),
			item.getUpdatedAt());
	}
}
