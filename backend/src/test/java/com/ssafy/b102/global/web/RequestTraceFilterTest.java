package com.ssafy.b102.global.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import jakarta.servlet.ServletException;

class RequestTraceFilterTest {

	private final RequestTraceFilter filter = new RequestTraceFilter();

	@Test
	void echoesSafeRequestIdInResponse() throws ServletException, IOException {
		MockHttpServletRequest request = new MockHttpServletRequest();
		request.addHeader(RequestTraceFilter.HEADER, "smoke-123");
		MockHttpServletResponse response = new MockHttpServletResponse();

		filter.doFilter(request, response, new MockFilterChain());

		assertThat(response.getHeader(RequestTraceFilter.HEADER)).isEqualTo("smoke-123");
	}

	@Test
	void replacesUnsafeRequestId() throws ServletException, IOException {
		MockHttpServletRequest request = new MockHttpServletRequest();
		request.addHeader(RequestTraceFilter.HEADER, "bad value");
		MockHttpServletResponse response = new MockHttpServletResponse();

		filter.doFilter(request, response, new MockFilterChain());

		assertThat(response.getHeader(RequestTraceFilter.HEADER)).matches("[0-9a-f-]{36}");
	}
}
