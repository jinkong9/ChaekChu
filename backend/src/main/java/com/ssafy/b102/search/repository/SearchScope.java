package com.ssafy.b102.search.repository;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 검색 범위 — API_SPEC §4.1 의 scope 파라미터(09-17). 검색어(q)를 어느 필드에 대고 점수를 내는가.
 *
 * ALL 이 기본이고 09-17 이전의 동작 그대로다 — 제목·저자·출판사를 cross_fields 로 함께 봐서 "한강 소년" 처럼 저자+제목이 섞인 검색어도 받아 준다.
 * TITLE·AUTHOR·PUBLISHER 는 사용자가 명시적으로 좁힐 때만 쓴다 — 그 필드 하나만 보므로 섞인 검색어는 못 찾는다(의도된 동작).
 * 매핑은 그대로다: title·authors·publisher 가 이미 각각 필드고 .ngram·.keyword 서브필드가 있어 쿼리의 필드 목록만 바뀐다(재색인 없음).
 * kdc 필터·정렬(관련도 → loanCum → id)·표지 가중·ISBN 분기는 범위와 무관하게 같다.
 */
public enum SearchScope {
	/** 제목·저자·출판사 전부(기본). */
	ALL("all"),
	/** 제목만. */
	TITLE("title"),
	/** 저자만 — 역할어를 뗀 authors 배열. */
	AUTHOR("author"),
	/** 출판사만. */
	PUBLISHER("publisher");

	private final String param;

	SearchScope(String param) {
		this.param = param;
	}

	/** 쿼리 파라미터 표기 — "all" · "title" · "author" · "publisher". */
	public String param() {
		return param;
	}

	/** 파라미터 값을 범위로. 대소문자를 가리지 않고 앞뒤 공백은 뗀다. 맞는 값이 없으면 empty — 400 은 호출자(서비스)가 만든다. */
	public static Optional<SearchScope> fromParam(String raw) {
		if (raw == null) {
			return Optional.empty();
		}
		String normalized = raw.trim().toLowerCase(Locale.ROOT);
		return Arrays.stream(values()).filter(s -> s.param.equals(normalized)).findFirst();
	}

	/** 오류 메시지용 — "all · title · author · publisher". */
	public static String allowedValues() {
		return Arrays.stream(values()).map(SearchScope::param).collect(Collectors.joining(" · "));
	}
}
