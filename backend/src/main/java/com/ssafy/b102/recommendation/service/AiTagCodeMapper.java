package com.ssafy.b102.recommendation.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 백엔드 온보딩 태그와 AI 배치 taxonomy의 차이를 한 곳에서 명시적으로 변환한다.
 *
 * AI 가 모르는 코드는 {@link #map} 에서 조용히 빠진다. 09-10~09-16 에는 사용자가 고르는 12개 중 6개
 * (HUMANITIES ART SOCIETY POETRY TRAVEL TECH)가 그렇게 버려져 태그를 골라도 추천이 바뀌지 않았다.
 * 09-16 에 AI taxonomy 에 같은 철자로 6개를 넣었고(ai/src/recommendation/tag_batch.py TAXONOMY),
 * {@code AiTagCodeMapperTest} 가 tags 표의 모든 코드가 여기를 통과하는지 고정한다 — 어느 쪽 사전이 먼저 바뀌든 테스트가 깨진다.
 */
final class AiTagCodeMapper {

	private static final Map<String, String> ALIASES = Map.ofEntries(
		Map.entry("FICTION", "FIC"),
		Map.entry("소설", "FIC"),
		Map.entry("ESSAY", "ESSAY"),
		Map.entry("에세이", "ESSAY"),
		Map.entry("SCIENCE", "SCIENCE"),
		Map.entry("과학", "SCIENCE"),
		Map.entry("HISTORY", "HISTORY"),
		Map.entry("역사", "HISTORY"),
		Map.entry("BUSINESS", "ECONOMY"),
		Map.entry("경제·경영", "ECONOMY"),
		Map.entry("SELF_HELP", "GROWTH"),
		Map.entry("자기계발", "GROWTH"),
		Map.entry("인문", "HUMANITIES"),
		Map.entry("예술", "ART"),
		Map.entry("사회", "SOCIETY"),
		Map.entry("시", "POETRY"),
		Map.entry("여행", "TRAVEL"),
		Map.entry("기술·IT", "TECH")
	);

	/** AI taxonomy 코드 전부(tag_batch.py TAXONOMY 와 같아야 한다). 여기 없는 코드는 AI 로 보내지 않는다. */
	private static final Set<String> AI_CODES = Set.of(
		"FIC", "ESSAY", "SCIENCE", "HISTORY", "ECONOMY", "FANTASY", "MYSTERY", "ROMANCE",
		"GROWTH", "FAMILY", "TIME_TRAVEL", "TRENDING", "STEADY", "NEW_BOOK",
		"HUMANITIES", "ART", "SOCIETY", "POETRY", "TRAVEL", "TECH"
	);

	/** AI/Qdrant 내부 taxonomy code를 백엔드 공개 tags 사전의 canonical code로 변환한다. */
	private static final Map<String, String> PUBLIC_CODES = Map.of(
		"FIC", "FICTION",
		"ECONOMY", "BUSINESS",
		"GROWTH", "SELF_HELP"
	);

	private AiTagCodeMapper() {
	}

	static Map<String, String> map(Iterable<String> rawCodes) {
		Map<String, String> result = new LinkedHashMap<>();
		for (String raw : rawCodes) {
			if (raw == null || raw.isBlank()) {
				continue;
			}
			String key = raw.strip();
			if (key.startsWith("#")) {
				key = key.substring(1).strip();
			}
			String normalized = key.toUpperCase(Locale.ROOT);
			String mapped = ALIASES.getOrDefault(normalized, ALIASES.getOrDefault(key, normalized));
			if (AI_CODES.contains(mapped)) {
				result.putIfAbsent(mapped, mapped);
			}
		}
		return result;
	}

	static List<String> toPublicCodes(Iterable<String> rawCodes) {
		return map(rawCodes).keySet().stream()
			.map(code -> PUBLIC_CODES.getOrDefault(code, code))
			.toList();
	}
}
