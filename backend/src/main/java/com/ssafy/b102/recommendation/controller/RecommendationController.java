package com.ssafy.b102.recommendation.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.recommendation.config.RecommendationProperties;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.recommendation.service.RecommendationService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/** API_SPEC §5.1 — 인증 사용자 추천을 FastAPI와 연결한다. */
@Tag(name = "추천", description = "사용자 서재·관심 태그를 FastAPI 추천 모델에 전달해 도서 추천을 생성한다.")
@RestController
@RequestMapping(ApiPaths.V1 + "/recommendations")
public class RecommendationController {

	private final RecommendationService recommendationService;
	private final RecommendationProperties properties;

	public RecommendationController(RecommendationService recommendationService, RecommendationProperties properties) {
		this.recommendationService = recommendationService;
		this.properties = properties;
	}

	@Operation(summary = "개인화 도서 추천", description = "tags가 없으면 온보딩 관심 태그를 사용한다. 응답 items[].book은 백엔드 canonical 도서 정보다.")
	@GetMapping
	public RecommendationResponse recommend(
		@CurrentUserId Long userId,
		@RequestParam(required = false) @Min(1) @Max(10) Integer size,
		@RequestParam(required = false) @Size(max = 5) List<String> tags) {
		int effectiveSize = size == null ? properties.defaultSize() : size;
		return recommendationService.recommend(userId, effectiveSize, tags);
	}
}
