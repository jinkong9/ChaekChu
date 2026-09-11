package com.ssafy.b102.book.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.7 — KDC 분류 한 줄. 원천은 V2 kdc_codes(code·label·parent_code·depth). */
@Schema(description = "KDC 분류 (GET /kdc)")
public record KdcCodeResponse(
	@Schema(description = "KDC 코드. 자릿수 = depth — \"8\"(대) · \"81\"(중) · \"813\"(소). 검색의 kdc 파라미터에 그대로 넣는다", example = "81") String code,
	@Schema(description = "분류 이름", example = "한국문학") String label,
	@Schema(description = "1 대분류 · 2 중분류 · 3 소분류", example = "2") int depth,
	@Schema(description = "부모 코드. 대분류는 null", example = "8", nullable = true) String parentCode
) {
}
