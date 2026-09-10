package com.ssafy.b102.recommendation.dto;

import java.util.List;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** FastAPI 응답 DTO. AI가 이후 필드를 추가해도 백엔드 응답 결합은 깨지지 않는다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiRecommendationResponse(
	String recommendationId,
	String requestId,
	String userId,
	String modelVersion,
	String indexVersion,
	boolean fallback,
	List<Item> items
) {

	public AiRecommendationResponse {
		items = items == null ? List.of() : List.copyOf(items);
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Item(
		String isbn13,
		Integer rank,
		Double score,
		Map<String, Double> featureScores,
		List<String> matchedTags,
		Reason primaryReason,
		List<Reason> reasons
	) {

		public Item {
			featureScores = featureScores == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(featureScores));
			matchedTags = matchedTags == null ? List.of() : List.copyOf(matchedTags);
			reasons = reasons == null ? List.of() : List.copyOf(reasons);
		}
	}

	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Reason(String type, String text) {
	}
}
