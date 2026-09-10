package com.ssafy.b102.recommendation.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** FastAPI POST /internal/v1/recommendations 요청 DTO. 필드명은 AI 계약의 camelCase와 동일하다. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AiRecommendationRequest(
	String requestId,
	String userId,
	String mode,
	Integer size,
	List<String> seedIsbns,
	List<String> excludeIsbns,
	List<TagPreference> tags,
	RecommendationWeights weights
) {

	public AiRecommendationRequest {
		seedIsbns = seedIsbns == null ? List.of() : List.copyOf(seedIsbns);
		excludeIsbns = excludeIsbns == null ? List.of() : List.copyOf(excludeIsbns);
		tags = tags == null ? List.of() : List.copyOf(tags);
	}

	public record TagPreference(String code, double weight) {
	}

	public record RecommendationWeights(
		double semantic,
		double tagMatch,
		double coLoan,
		double trending,
		double steady
	) {
	}
}
