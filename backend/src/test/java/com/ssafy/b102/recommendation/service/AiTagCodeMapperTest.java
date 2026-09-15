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
}
