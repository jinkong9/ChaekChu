package com.ssafy.b102.recommendation.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 명시적인 다음 추천 요청. recommendationId는 같은 취향 조건을 복원할 기준 덱이다. */
public record NextRecommendationRequest(
	@NotBlank @Size(max = 64) String recommendationId,
	@Min(1) @Max(10) Integer size
) {
}
