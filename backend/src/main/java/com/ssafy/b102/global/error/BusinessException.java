package com.ssafy.b102.global.error;

import java.util.Map;

/** 도메인 규칙 위반. GlobalExceptionHandler 가 ErrorCode 의 HTTP 상태와 형식으로 바꾼다. */
public class BusinessException extends RuntimeException {

	private final ErrorCode code;
	private final transient Map<String, Object> details;

	public BusinessException(ErrorCode code) {
		this(code, code.defaultMessage(), null);
	}

	public BusinessException(ErrorCode code, Map<String, Object> details) {
		this(code, code.defaultMessage(), details);
	}

	public BusinessException(ErrorCode code, String message, Map<String, Object> details) {
		super(message);
		this.code = code;
		this.details = details;
	}

	public ErrorCode code() {
		return code;
	}

	public Map<String, Object> details() {
		return details;
	}
}
