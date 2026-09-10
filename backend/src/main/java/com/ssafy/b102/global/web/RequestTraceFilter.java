package com.ssafy.b102.global.web;

import java.io.IOException;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** 운영 smoke test와 로그를 연결하는 요청 식별자. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTraceFilter extends OncePerRequestFilter {

	public static final String HEADER = "X-Request-ID";
	private static final int MAX_LENGTH = 64;

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
		throws ServletException, IOException {
		String traceId = sanitize(request.getHeader(HEADER));
		response.setHeader(HEADER, traceId);
		try (MDC.MDCCloseable ignored = MDC.putCloseable("traceId", traceId)) {
			filterChain.doFilter(request, response);
		}
	}

	private static String sanitize(String raw) {
		if (raw != null && raw.matches("[A-Za-z0-9._-]{1," + MAX_LENGTH + "}")) {
			return raw;
		}
		return UUID.randomUUID().toString();
	}
}
