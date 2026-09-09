package com.ssafy.b102.global.error;

import org.springframework.http.HttpStatus;

/**
 * API_SPEC §1.3 오류 코드 표. 응답은 항상 { code, message, details } 한 형식이다.
 * NOT_FOUND · METHOD_NOT_ALLOWED 는 명세 표 밖의 공통 HTTP 오류(없는 경로·메서드)용.
 */
public enum ErrorCode {

	VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "요청 값이 올바르지 않습니다."),
	UNSUPPORTED_PROVIDER(HttpStatus.BAD_REQUEST, "지원하지 않는 OAuth 제공자입니다."),
	UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다."),
	FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다."),
	NOT_FOUND(HttpStatus.NOT_FOUND, "요청한 자원을 찾을 수 없습니다."),
	USER_NOT_FOUND(HttpStatus.NOT_FOUND, "사용자를 찾을 수 없습니다."),
	BOOK_NOT_FOUND(HttpStatus.NOT_FOUND, "도서를 찾을 수 없습니다."),
	LIBRARY_ITEM_NOT_FOUND(HttpStatus.NOT_FOUND, "서재 항목을 찾을 수 없습니다."),
	METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 메서드입니다."),
	LIBRARY_ITEM_EXISTS(HttpStatus.CONFLICT, "이미 서재에 있는 책입니다."),
	ONBOARDING_REQUIRED(HttpStatus.CONFLICT, "온보딩을 먼저 완료해야 합니다."),
	RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "요청이 너무 많습니다."),
	SEARCH_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "검색 서비스를 잠시 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
	INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다.");

	private final HttpStatus status;
	private final String defaultMessage;

	ErrorCode(HttpStatus status, String defaultMessage) {
		this.status = status;
		this.defaultMessage = defaultMessage;
	}

	public HttpStatus status() {
		return status;
	}

	public String defaultMessage() {
		return defaultMessage;
	}
}
