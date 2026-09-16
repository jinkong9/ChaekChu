package com.ssafy.b102.recommendation.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class AiTagCodeMapperTest {

	@Test
	void convertsAiAliasesToBackendPublicCodes() {
		assertThat(AiTagCodeMapper.toPublicCodes(List.of("FIC", "ECONOMY", "GROWTH", "SCIENCE")))
			.containsExactly("FICTION", "BUSINESS", "SELF_HELP", "SCIENCE");
	}

	@Test
	void acceptsBackendCodesAndLabelsForPublicResponse() {
		assertThat(AiTagCodeMapper.toPublicCodes(List.of("FICTION", "#경제·경영", "자기계발")))
			.containsExactly("FICTION", "BUSINESS", "SELF_HELP");
	}

	@Test
	void removesUnknownCodes() {
		assertThat(AiTagCodeMapper.toPublicCodes(List.of("UNKNOWN", "FIC")))
			.containsExactly("FICTION");
	}

	/**
	 * 가드: tags 표(V1_1 seed)의 모든 코드가 AI 로 전달돼야 한다. 09-10~09-16 에 6개가 조용히 버려져 사용자가 태그를 골라도
	 * 추천이 바뀌지 않았다. 온보딩 태그를 추가하면 이 목록과 AI taxonomy(ai/src/recommendation/tag_batch.py)를 함께 늘려야 한다.
	 */
	@Test
	void everyOnboardingTagReachesAi() {
		List<String> onboarding = List.of("FICTION", "ESSAY", "HUMANITIES", "HISTORY", "SCIENCE", "ART",
			"SELF_HELP", "BUSINESS", "SOCIETY", "POETRY", "TRAVEL", "TECH");

		assertThat(AiTagCodeMapper.map(onboarding)).hasSize(onboarding.size());
		assertThat(AiTagCodeMapper.map(onboarding).keySet())
			.containsExactly("FIC", "ESSAY", "HUMANITIES", "HISTORY", "SCIENCE", "ART",
				"GROWTH", "ECONOMY", "SOCIETY", "POETRY", "TRAVEL", "TECH");
		// 응답 경계에서는 다시 공개 코드로 — 왕복이 항등이어야 appliedTags 가 거짓이 되지 않는다
		assertThat(AiTagCodeMapper.toPublicCodes(AiTagCodeMapper.map(onboarding).keySet())).isEqualTo(onboarding);
	}

	@Test
	void acceptsKoreanLabelsOfTheSixGenresAddedOnSep16() {
		assertThat(AiTagCodeMapper.toPublicCodes(List.of("#인문", "예술", "사회", "시", "여행", "기술·IT")))
			.containsExactly("HUMANITIES", "ART", "SOCIETY", "POETRY", "TRAVEL", "TECH");
	}
}
