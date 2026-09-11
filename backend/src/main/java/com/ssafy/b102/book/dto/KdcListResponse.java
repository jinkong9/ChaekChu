package com.ssafy.b102.book.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §4.7 GET /kdc — 목록은 봉투 하나(§1.3). code 오름차순. */
@Schema(description = "KDC 분류 사전 (GET /kdc)")
public record KdcListResponse(
	@Schema(description = "code 오름차순. 조건에 맞는 분류가 없으면 []") List<KdcCodeResponse> items
) {
}
