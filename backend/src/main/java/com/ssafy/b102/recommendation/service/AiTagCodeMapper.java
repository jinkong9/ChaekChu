package com.ssafy.b102.recommendation.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** 백엔드 온보딩 태그와 AI 배치 taxonomy의 차이를 한 곳에서 명시적으로 변환한다. */
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
		Map.entry("자기계발", "GROWTH")
	);

	private static final Set<String> AI_CODES = Set.of(
		"FIC", "ESSAY", "SCIENCE", "HISTORY", "ECONOMY", "FANTASY", "MYSTERY", "ROMANCE",
		"GROWTH", "FAMILY", "TIME_TRAVEL", "TRENDING", "STEADY", "NEW_BOOK"
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
