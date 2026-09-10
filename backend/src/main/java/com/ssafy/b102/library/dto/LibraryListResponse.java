package com.ssafy.b102.library.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §6.1 GET /library/me — 페이지 없음(사용자 서재는 수백 권 규모). */
@Schema(description = "내 서재 목록 (GET /library/me)")
public record LibraryListResponse(
	@Schema(description = "updatedAt 내림차순. 비어 있으면 []") List<LibraryItemResponse> items
) {
}
