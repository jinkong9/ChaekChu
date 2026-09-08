package com.ssafy.b102.global.error;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.validation.ConstraintViolationException;

/**
 * API_SPEC §1.3 — 모든 오류를 { code, message, details } 한 형식으로.
 * 인증 실패(401/403)는 필터 단계라 여기 오지 않는다 → global.security 의 EntryPoint/Handler 가 같은 형식으로 낸다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

	@ExceptionHandler(BusinessException.class)
	public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e) {
		return respond(e.code(), e.getMessage(), e.details());
	}

	// ── 400 VALIDATION_FAILED — details.fields[] = { field, reason } ──

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ErrorResponse> handleBodyValidation(MethodArgumentNotValidException e) {
		List<Map<String, String>> fields = new ArrayList<>();
		for (FieldError fe : e.getBindingResult().getFieldErrors()) {
			fields.add(field(fe.getField(), fe.getDefaultMessage()));
		}
		return validationFailed(fields);
	}

	@ExceptionHandler(HandlerMethodValidationException.class)
	public ResponseEntity<ErrorResponse> handleParamValidation(HandlerMethodValidationException e) {
		List<Map<String, String>> fields = new ArrayList<>();
		e.getParameterValidationResults().forEach(r -> r.getResolvableErrors()
			.forEach(err -> fields.add(field(r.getMethodParameter().getParameterName(), err.getDefaultMessage()))));
		return validationFailed(fields);
	}

	@ExceptionHandler(ConstraintViolationException.class)
	public ResponseEntity<ErrorResponse> handleConstraint(ConstraintViolationException e) {
		List<Map<String, String>> fields = new ArrayList<>();
		e.getConstraintViolations().forEach(v -> fields.add(field(String.valueOf(v.getPropertyPath()), v.getMessage())));
		return validationFailed(fields);
	}

	@ExceptionHandler(MissingServletRequestParameterException.class)
	public ResponseEntity<ErrorResponse> handleMissingParam(MissingServletRequestParameterException e) {
		return validationFailed(List.of(field(e.getParameterName(), "필수 파라미터입니다.")));
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
		return validationFailed(List.of(field(e.getName(), "형식이 올바르지 않습니다.")));
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException e) {
		return respond(ErrorCode.VALIDATION_FAILED, "요청 본문을 읽을 수 없습니다.", null);
	}

	// ── 명세 표 밖의 공통 HTTP 오류 ──

	@ExceptionHandler(NoResourceFoundException.class)
	public ResponseEntity<ErrorResponse> handleNoResource(NoResourceFoundException e) {
		return respond(ErrorCode.NOT_FOUND, null, null);
	}

	@ExceptionHandler(HttpRequestMethodNotSupportedException.class)
	public ResponseEntity<ErrorResponse> handleMethod(HttpRequestMethodNotSupportedException e) {
		return respond(ErrorCode.METHOD_NOT_ALLOWED, null, null);
	}

	@ExceptionHandler(ErrorResponseException.class)
	public ResponseEntity<ErrorResponse> handleSpringStatus(ErrorResponseException e) {
		HttpStatus status = HttpStatus.resolve(e.getStatusCode().value());
		ErrorCode code = switch (status != null ? status : HttpStatus.INTERNAL_SERVER_ERROR) {
			case BAD_REQUEST -> ErrorCode.VALIDATION_FAILED;
			case UNAUTHORIZED -> ErrorCode.UNAUTHORIZED;
			case FORBIDDEN -> ErrorCode.FORBIDDEN;
			case NOT_FOUND -> ErrorCode.NOT_FOUND;
			case METHOD_NOT_ALLOWED -> ErrorCode.METHOD_NOT_ALLOWED;
			case TOO_MANY_REQUESTS -> ErrorCode.RATE_LIMITED;
			default -> ErrorCode.INTERNAL_ERROR;
		};
		return respond(code, null, null);
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
		log.error("처리되지 않은 예외", e);
		return respond(ErrorCode.INTERNAL_ERROR, null, null);
	}

	private static ResponseEntity<ErrorResponse> validationFailed(List<Map<String, String>> fields) {
		Map<String, Object> details = new LinkedHashMap<>();
		details.put("fields", fields);
		return respond(ErrorCode.VALIDATION_FAILED, null, details);
	}

	private static Map<String, String> field(String field, String reason) {
		Map<String, String> m = new LinkedHashMap<>();
		m.put("field", field);
		m.put("reason", reason);
		return m;
	}

	private static ResponseEntity<ErrorResponse> respond(ErrorCode code, String message, Map<String, Object> details) {
		return ResponseEntity.status(code.status()).body(ErrorResponse.of(code, message, details));
	}
}
