package com.ssafy.b102.global.error;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §1.3 — 오류 응답 형식. 성공 응답은 봉투 없이 자원 그 자체다. */
@Schema(description = "오류 응답 — 모든 4xx/5xx 가 이 한 형식이다 (API_SPEC §1.3)")
public record ErrorResponse(
	@Schema(description = "오류 코드. 프론트 분기 기준", example = "BOOK_NOT_FOUND") String code,
	@Schema(description = "사람이 읽는 설명(한국어)", example = "도서를 찾을 수 없습니다.") String message,
	@Schema(description = "부가 정보. 예: VALIDATION_FAILED 는 fields[{field, reason}], LIBRARY_ITEM_EXISTS 는 libraryItemId. 없으면 키 생략", nullable = true)
	@JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> details
) {

	public static ErrorResponse of(ErrorCode code) {
		return new ErrorResponse(code.name(), code.defaultMessage(), null);
	}

	public static ErrorResponse of(ErrorCode code, String message, Map<String, Object> details) {
		return new ErrorResponse(code.name(), message != null ? message : code.defaultMessage(), details);
	}
}
