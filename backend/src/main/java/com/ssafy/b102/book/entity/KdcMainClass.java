package com.ssafy.b102.book.entity;

/**
 * KDC(한국십진분류) 대분류 10개 — books.category_code 첫 자리 → 표시 라벨.
 * kdc_codes(V2) 를 못 읽을 때 KdcCategoryResolver 가 쓰는 폴백. 평소 category 는 resolver 가 2단계 경로로 만든다.
 */
public enum KdcMainClass {
	GENERAL('0', "총류"),
	PHILOSOPHY('1', "철학"),
	RELIGION('2', "종교"),
	SOCIAL_SCIENCE('3', "사회과학"),
	NATURAL_SCIENCE('4', "자연과학"),
	TECHNOLOGY('5', "기술과학"),
	ARTS('6', "예술"),
	LANGUAGE('7', "언어"),
	LITERATURE('8', "문학"),
	HISTORY('9', "역사");

	private final char digit;
	private final String label;

	KdcMainClass(char digit, String label) {
		this.digit = digit;
		this.label = label;
	}

	public String label() {
		return label;
	}

	/** "813.7" → "문학". null·빈 값·숫자로 시작하지 않는 코드는 null(분류 모름). */
	public static String labelOf(String categoryCode) {
		if (categoryCode == null || categoryCode.isBlank()) {
			return null;
		}
		char first = categoryCode.trim().charAt(0);
		for (KdcMainClass k : values()) {
			if (k.digit == first) {
				return k.label;
			}
		}
		return null;
	}
}
