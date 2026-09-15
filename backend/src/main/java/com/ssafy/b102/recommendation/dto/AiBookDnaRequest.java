package com.ssafy.b102.recommendation.dto;

import java.time.LocalDate;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** FastAPI POST /internal/v1/dna/profile 요청 DTO. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AiBookDnaRequest(
	String requestId,
	String userId,
	List<String> declaredTags,
	List<Book> books
) {

	public AiBookDnaRequest {
		declaredTags = declaredTags == null ? List.of() : List.copyOf(declaredTags);
		books = books == null ? List.of() : List.copyOf(books);
	}

	public record Book(
		String isbn13,
		String status,
		Integer rating,
		LocalDate finishedDate
	) {
	}
}
