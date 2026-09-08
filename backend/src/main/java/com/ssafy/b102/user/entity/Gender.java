package com.ssafy.b102.user.entity;

/** users.gender CHAR(1) — 'F' / 'M' / NULL(응답 안 함). API 는 "F" | "M" | null. */
public enum Gender {

	F, M;

	public String code() {
		return name();
	}

	public static Gender fromCode(String code) {
		return code == null ? null : Gender.valueOf(code);
	}
}
