package com.ssafy.b102.recommendation.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** FastAPI Book DNA 응답 DTO. AI가 필드를 확장해도 기존 백엔드 결합은 깨지지 않는다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiBookDnaResponse(
	String requestId,
	String dnaVersion,
	String modelVersion,
	String indexVersion,
	String tagVersion,
	Profile profile,
	List<String> unresolvedIsbns
) {

	public AiBookDnaResponse {
		unresolvedIsbns = unresolvedIsbns == null ? List.of() : List.copyOf(unresolvedIsbns);
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Profile(
		String status,
		int basedOnCount,
		List<Score> axes,
		List<Score> metrics,
		List<Score> keywords,
		Type type,
		Evidence evidence
	) {
		public Profile {
			axes = axes == null ? List.of() : List.copyOf(axes);
			metrics = metrics == null ? List.of() : List.copyOf(metrics);
			keywords = keywords == null ? List.of() : List.copyOf(keywords);
		}
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Score(String code, String label, double score) {
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Type(String code, String name, String phrase, String summary) {
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Evidence(
		int readBookCount,
		int ratedBookCount,
		List<String> topGenres,
		List<String> topTags
	) {
		public Evidence {
			topGenres = topGenres == null ? List.of() : List.copyOf(topGenres);
			topTags = topTags == null ? List.of() : List.copyOf(topTags);
		}
	}
}
