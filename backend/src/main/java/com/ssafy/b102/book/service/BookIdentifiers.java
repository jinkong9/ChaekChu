package com.ssafy.b102.book.service;

import java.util.regex.Pattern;

/**
 * 경로·본문으로 들어오는 도서 식별자 판별(API_SPEC §1.2·§4.4).
 *
 * 13자리 978/979 숫자면 ISBN13, 아니면 내부 id 로 본다. 홈 인기 링은 ISBN 으로 이동하고 나머지 화면은 내부 id 로 이동하는데,
 * 도서 상세와 이벤트 수집이 같은 값을 받으므로 규칙을 한 곳에 둔다.
 */
public final class BookIdentifiers {

	private static final Pattern ISBN13 = Pattern.compile("^97[89]\\d{10}$");
	private static final Pattern INTERNAL_ID = Pattern.compile("^\\d{1,18}$");

	private BookIdentifiers() {
	}

	/** 앞뒤 공백을 턴 값. null 은 빈 문자열로 — 어느 패턴에도 걸리지 않는다. */
	public static String normalize(String raw) {
		return raw == null ? "" : raw.strip();
	}

	public static boolean isIsbn13(String normalized) {
		return ISBN13.matcher(normalized).matches();
	}

	/** 내부 id 로 읽을 수 있으면 그 값, 아니면 null. ISBN13 도 13자리 숫자라 {@link #isIsbn13} 을 먼저 본다. */
	public static Long asInternalId(String normalized) {
		return INTERNAL_ID.matcher(normalized).matches() ? Long.valueOf(normalized) : null;
	}
}
