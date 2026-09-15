package com.ssafy.b102.recommendation.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** 프론트 GET /api/v1/users/me/dna 응답. 책 상세는 백엔드 canonical 데이터를 사용한다. */
@Schema(description = "내 Book DNA 프로필")
public record BookDnaResponse(
	Instant generatedAt,
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
		LocalDate finishedDate
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
