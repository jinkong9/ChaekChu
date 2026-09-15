package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.5 GET /books/{bookId}/similar — 소개 임베딩 이웃. 모양은 §4.6 co-loans 와 같게 맞춘다(프론트가 같은 타일로 그린다). */
@Schema(description = "비슷한 책 (GET /books/{bookId}/similar)")
public record SimilarBookResponse(
	@Schema(description = "유사도 내림차순. 기준 책 자신은 빠진다. 벡터가 없거나 이웃이 없으면 []")
	List<Item> items,
	@Schema(description = "임베딩 모델 버전. 빈 결과면 null", example = "gms-text-embedding-3-small-20260909-1000", nullable = true)
	String modelVersion,
	@Schema(description = "벡터 색인 버전. 빈 결과면 null", example = "d4l-small-cost-validate-100000-20260914-034256", nullable = true)
	String indexVersion
) {

	/** 빈 결과 — 기준 책의 벡터가 아직 없거나(적재 진행 중) 이웃을 못 찾았을 때. 200 으로 내보낸다. */
	public static SimilarBookResponse empty() {
		return new SimilarBookResponse(List.of(), null, null);
	}

	@Schema(description = "비슷한 책 한 권")
	public record Item(
		@Schema(description = "도서 요약 (§1.5)") BookSummaryResponse book,
		@Schema(description = "왜 비슷한지 한 문장. AI 가 만든 문구를 그대로 전달한다",
			example = "관심 도서와 서지·분류 특성이 비슷한 책이에요.") String reason,
		@Schema(description = "유사도 점수 0~100. 표시용이 아니라 디버그·분석용", example = "57.8") double score
	) {
	}
}
