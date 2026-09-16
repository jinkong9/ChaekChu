package com.ssafy.b102.recommendation.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 프론트 GET /api/v1/users/me/dna 응답. 책 상세는 백엔드 canonical 데이터를 사용한다.
 * generatedAt 은 AI 가 프로필을 계산한 시각 — 저장된 프로필로 답할 때(서재 변화 없음·AI 장애)는 그때 시각이 그대로 나간다.
 */
@Schema(description = "내 Book DNA 프로필")
public record BookDnaResponse(
	@Schema(description = "프로필 계산 시각(UTC). 저장된 프로필이면 그 계산 시각") Instant generatedAt,
	String dnaVersion,
	String modelVersion,
	String indexVersion,
	String tagVersion,
	List<String> declaredTags,
	int readCount,
	List<Book> books,
	Profile profile
) {

	public record Book(
		String bookId,
		String isbn13,
		String title,
		List<String> authors,
		String publisher,
		Integer publicationYear,
		String coverUrl,
		Integer pageCount,
		String category,
		String classNo,
		String status,
		Integer rating,
		LocalDate finishedDate,
		@Schema(description = "AI 인덱스에서 찾아 프로필 계산에 반영된 책인지. false 면 인덱스(추천 후보 약 45만 권)에 없어 빠진 책") boolean analyzed
	) {
	}

	public record Profile(
		String status,
		int basedOnCount,
		List<Score> axes,
		List<Score> metrics,
		List<Score> keywords,
		Type type,
		Evidence evidence
	) {
	}

	public record Score(String code, String label, double score) {
	}

	public record Type(String code, String name, String phrase, String summary) {
	}

	public record Evidence(int readBookCount, int ratedBookCount, List<String> topGenres, List<String> topTags) {
	}
}
