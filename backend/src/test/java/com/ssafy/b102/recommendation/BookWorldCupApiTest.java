package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class BookWorldCupApiTest {
	private static final String SESSIONS = "/api/v1/users/me/dna/world-cup/sessions";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;
	@Autowired ObjectMapper objectMapper;

	private String bearer;
	private final List<String> titles = new ArrayList<>();
	private final String isbnPrefix = "979" + String.format("%010d", Math.floorMod(System.nanoTime(), 1_000_000_000L));

	@BeforeEach
	void setUp() {
		jdbc.update("delete from book_world_cup_synopses");
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "world-cup-" + UUID.randomUUID()));
		bearer = "Bearer " + jwt.issue(user.getId());
		for (int i = 1; i <= 16; i++) {
			String isbn = isbnPrefix.substring(0, 3) + String.format("%010d", Long.parseLong(isbnPrefix.substring(3)) + i);
			String title = "익명 대진 책 " + i;
			titles.add(title);
			jdbc.update("insert into books (isbn13,title,author,cover_url) values (?,?,?,?)", isbn, title, "저자 " + i,
				"https://cover.example/" + i + ".jpg");
			jdbc.update("""
				insert into book_world_cup_synopses
				    (isbn13,loan_rank,loan_count,synopsis,source_hash,input_hash,source_name,selection_rule,summary_version,model_version)
				values (?,?,?,?,?,?,?,?,?,?)""", isbn, i, 1000 - i, "익명으로 제공하는 소개문 " + i,
				"a".repeat(64), "b".repeat(64), "test", "loan_total_desc_isbn13_asc", "book-world-cup-summary-v1", "gpt-4o-mini");
		}
	}

	@Test
	@DisplayName("세션 선택 중에는 익명 소개·choiceId만 주고, 마지막 우승 응답에서만 책 정보를 공개한다")
	void hidesIdentityUntilChampionReveal() throws Exception {
		JsonNode current = json(mvc.perform(post(SESSIONS).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("IN_PROGRESS"))
			.andExpect(jsonPath("$.roundSize").value(16))
			.andExpect(jsonPath("$.choices.length()").value(2))
			.andExpect(jsonPath("$.choices[0].synopsis").isString())
			.andExpect(jsonPath("$.choices[0].choiceId").isString())
			.andExpect(jsonPath("$.champion").value(org.hamcrest.Matchers.nullValue()))
			.andReturn());

		for (int pickNumber = 1; pickNumber < 15; pickNumber++) {
			assertAnonymous(current);
			String choiceId = current.path("choices").get(0).path("choiceId").asText();
			current = pick(current.path("sessionId").asText(), choiceId);
			assertThat(current.path("status").asText()).isEqualTo("IN_PROGRESS");
		}

		assertAnonymous(current);
		String finalChoice = current.path("choices").get(0).path("choiceId").asText();
		current = pick(current.path("sessionId").asText(), finalChoice);
		assertThat(current.path("status").asText()).isEqualTo("COMPLETED");
		assertThat(current.path("choices").size()).isZero();
		assertThat(current.path("champion").path("title").asText()).isIn(titles);
		assertThat(current.path("champion").path("authors").isArray()).isTrue();
		assertThat(current.path("champion").path("coverUrl").asText()).contains("cover.example");
	}

	@Test
	@DisplayName("선택지 외 choiceId는 거절하고 토큰 없는 사용자는 세션을 시작할 수 없다")
	void validatesChoiceAndAuthentication() throws Exception {
		mvc.perform(post(SESSIONS)).andExpect(status().isUnauthorized());
		JsonNode started = json(mvc.perform(post(SESSIONS).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk()).andReturn());
		mvc.perform(post(SESSIONS + "/" + started.path("sessionId").asText() + "/picks")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"choiceId\":\"not-in-this-match\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	private JsonNode pick(String sessionId, String choiceId) throws Exception {
		String request = objectMapper.writeValueAsString(java.util.Map.of("choiceId", choiceId));
		MvcResult result = mvc.perform(post(SESSIONS + "/" + sessionId + "/picks")
			.header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON).content(request))
			.andExpect(status().isOk()).andReturn();
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private JsonNode json(MvcResult result) throws Exception {
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private static void assertAnonymous(JsonNode response) {
		assertThat(response.has("isbn13")).isFalse();
		assertThat(response.has("bookId")).isFalse();
		assertThat(response.path("champion").isNull()).isTrue();
		for (JsonNode choice : response.path("choices")) {
			assertThat(choice.has("title")).isFalse();
			assertThat(choice.has("author")).isFalse();
			assertThat(choice.has("coverUrl")).isFalse();
		}
	}
}
