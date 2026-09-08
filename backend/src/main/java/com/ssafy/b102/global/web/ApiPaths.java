package com.ssafy.b102.global.web;

/**
 * API 기본 경로. context-path 나 spring.mvc.servlet.path 를 쓰지 않는 이유:
 * 둘 다 actuator 까지 옮겨서 compose·nginx 헬스체크(/actuator/health/readiness)가 깨진다.
 */
public final class ApiPaths {

	public static final String V1 = "/api/v1";

	private ApiPaths() {
	}
}
