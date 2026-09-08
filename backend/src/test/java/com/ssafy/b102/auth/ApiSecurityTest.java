package com.ssafy.b102.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;

/** API_SPEC §1.3 — 인증 실패와 공통 HTTP 오류가 모두 { code, message } JSON 한 형식인지. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiSecurityTest {

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;

	@Test
	@DisplayName("토큰 없음 → 401 UNAUTHORIZED JSON")
	void noToken_401Json() throws Exception {
		mvc.perform(get("/api/v1/users/me"))
			.andExpect(status().isUnauthorized())
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
			.andExpect(jsonPath("$.message").isString());
	}

	@Test
	@DisplayName("위조 토큰 → 401 UNAUTHORIZED JSON")
	void tamperedToken_401Json() throws Exception {
		String token = jwt.issue(1L);
		String tampered = token.substring(0, token.length() - 3) + "abc";
		mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + tampered))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	@DisplayName("유효 토큰인데 사용자 행이 없음(탈퇴 등) → 404 USER_NOT_FOUND")
	void validTokenUnknownUser_404() throws Exception {
		mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt.issue(999_999_999L)))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("USER_NOT_FOUND"))
			.andExpect(jsonPath("$.details.userId").value("999999999"));
	}

	@Test
	@DisplayName("없는 경로 → 404 NOT_FOUND JSON (인증 뒤)")
	void unknownPath_404Json() throws Exception {
		mvc.perform(get("/api/v1/nope").header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt.issue(1L)))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("NOT_FOUND"));
	}

	@Test
	@DisplayName("헬스체크·Swagger 는 토큰 없이 열린다")
	void publicEndpoints_openWithoutToken() throws Exception {
		mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
		mvc.perform(get("/v3/api-docs")).andExpect(status().isOk());
	}
}
