package com.ssafy.b102.recommendation.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.ssafy.b102.book.dto.BookSummaryResponse;

import io.swagger.v3.oas.annotations.media.Schema;

/** 프론트 GET /api/v1/recommendations 응답. AI ISBN을 canonical BookSummary에 결합한 결과다. */
@Schema(description = "도서 추천 결과")
public record RecommendationResponse(
	String recommendationId,
	Instant generatedAt,
	String mode,
	boolean fallback,
	int basedOnCount,
	Map<String, Double> weights,
	List<String> appliedTags,
	String modelVersion,
	String indexVersion,
	List<Item> items
) {

	public record Item(
		BookSummaryResponse book,
		int rank,
		double score,
		List<FeatureScore> featureScores,
		List<String> tags,
		String reasonType,
		String reasonText
	) {
	}

	public record FeatureScore(String key, Double rawScore) {
	}
}
