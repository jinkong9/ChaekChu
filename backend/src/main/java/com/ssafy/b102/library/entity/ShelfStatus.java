package com.ssafy.b102.library.entity;

import java.util.Locale;

/** user_library.status — WISH(찜) / READ(완독). 09-02 회의에서 2단 확정, READING 폐기. V1 CHECK 와 동일. */
public enum ShelfStatus {
	WISH, READ;

	/**
	 * 요청에서 온 문자열 → 상태. 대소문자·앞뒤 공백은 관대하게(온보딩 gender 와 같은 태도), 모르는 값(READING 등)·null 은 null.
	 * 쿼리 파라미터(WebMvcConfig 의 Converter)와 본문(LibraryService) 이 같은 규칙을 쓰도록 여기 한 곳에 둔다.
	 */
	public static ShelfStatus from(String raw) {
		if (raw == null) {
			return null;
		}
		try {
			return valueOf(raw.strip().toUpperCase(Locale.ROOT));   // Locale.ROOT: 터키어 로케일에서 "wish" 의 i 가 İ 로 바뀌는 사고 방지
		}
		catch (IllegalArgumentException e) {
			return null;
		}
	}
}
