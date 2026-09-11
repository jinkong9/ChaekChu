package com.ssafy.b102.book;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;

/**
 * API_SPEC §4.7 GET /kdc — 분류 사전.
 *
 * kdc_codes seed 는 저장소에 없고 운영은 팀원이 따로 적재했다(로컬·CI DB 는 비어 있다). 그래서 운영 949행에 기대지 않고
 * 이 테스트가 표를 비우고 축소판(대 2 · 중 3 · 소 2)을 넣는다 — 트랜잭션 롤백이라 로컬 DB 에 남지 않는다.
 * 사전은 사용자 행을 보지 않으므로 토큰만 있으면 된다(users 행 불필요).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class KdcApiTest {

	private static final String KDC = "/api/v1/kdc";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired JdbcTemplate jdbc;

	private String bearer;

	@BeforeEach
	void setUp() {
		bearer = "Bearer " + jwt.issue(1L);
		// 자기참조 FK(fk_kdc_parent)는 문장 끝에 검사되므로 한 번에 지워도 된다. 부모부터 넣는다.
		jdbc.update("delete from kdc_codes");
		insert("0", "총류", null, 1);
		insert("8", "문학", null, 1);
		insert("80", "문학", "8", 2);
		insert("81", "한국문학", "8", 2);
		insert("82", "중국문학", "8", 2);
		insert("811", "시", "81", 3);
		insert("813", "소설", "81", 3);
	}

	@Test
	@DisplayName("depth=1: 대분류만 code 순으로, parentCode 는 null — 앱 시작 시 칩 목록")
	void depth1_returns_top_classes() throws Exception {
		mvc.perform(get(KDC).param("depth", "1").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[*].code").value(Matchers.contains("0", "8")))
			.andExpect(jsonPath("$.items[1].label").value("문학"))
			.andExpect(jsonPath("$.items[1].depth").value(1))
			.andExpect(jsonPath("$.items[1].parentCode").value(Matchers.nullValue()));
	}

	@Test
	@DisplayName("parent=8: 문학의 중분류만, depth 2, parentCode 8 — 토큰 드릴다운")
	void parent_returns_children() throws Exception {
		mvc.perform(get(KDC).param("parent", "8").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(3))
			.andExpect(jsonPath("$.items[*].code").value(Matchers.contains("80", "81", "82")))
			.andExpect(jsonPath("$.items[1].label").value("한국문학"))
			.andExpect(jsonPath("$.items[1].depth").value(2))
			.andExpect(jsonPath("$.items[1].parentCode").value("8"));
	}

	@Test
	@DisplayName("parent=81: 한국문학의 소분류. 813 은 소설 — 검색 kdc=813 에 그대로 쓴다")
	void parent_two_digits_returns_leaf_classes() throws Exception {
		mvc.perform(get(KDC).param("parent", "81").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].code").value(Matchers.contains("811", "813")))
			.andExpect(jsonPath("$.items[1].label").value("소설"))
			.andExpect(jsonPath("$.items[1].depth").value(3))
			.andExpect(jsonPath("$.items[1].parentCode").value("81"));
	}

	@Test
	@DisplayName("소분류로 parent 를 물으면 자식이 없어 items [] — 404 가 아니다")
	void leaf_parent_returns_empty_list() throws Exception {
		mvc.perform(get(KDC).param("parent", "813").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isArray())
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("파라미터 없음: 전체를 code 문자열 순으로 — \"0\" < \"8\" < \"80\" < \"811\" < \"813\" < \"81\"? 아니라 \"81\" < \"811\"")
	void no_params_returns_whole_dictionary() throws Exception {
		mvc.perform(get(KDC).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(7))
			.andExpect(jsonPath("$.items[*].code").value(Matchers.contains("0", "8", "80", "81", "811", "813", "82")));
	}

	@Test
	@DisplayName("depth=2·3 도 한 단계 전체를 준다")
	void depth_two_and_three() throws Exception {
		mvc.perform(get(KDC).param("depth", "2").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items.length()").value(3));
		mvc.perform(get(KDC).param("depth", "3").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items.length()").value(2));
	}

	@Test
	@DisplayName("응답에 하루치 Cache-Control — 브라우저가 다시 묻지 않는다")
	void response_is_cacheable_for_a_day() throws Exception {
		mvc.perform(get(KDC).param("depth", "1").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.CACHE_CONTROL, Matchers.containsString("max-age=86400")));
	}

	@Test
	@DisplayName("depth 와 parent 동시 사용 → 400 VALIDATION_FAILED(fields.depth)")
	void depth_with_parent_is_400() throws Exception {
		mvc.perform(get(KDC).param("depth", "1").param("parent", "8").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("depth"));
	}

	@Test
	@DisplayName("depth 가 1~3 밖 · parent 가 숫자 아님 → 400, fields 에 해당 필드")
	void out_of_range_params_are_400() throws Exception {
		mvc.perform(get(KDC).param("depth", "4").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("depth"));
		mvc.perform(get(KDC).param("depth", "0").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest());
		mvc.perform(get(KDC).param("parent", "8134").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("parent"));
		mvc.perform(get(KDC).param("parent", "문학").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("parent"));
	}

	@Test
	@DisplayName("depth 가 숫자가 아니면 400 (형식 변환 실패)")
	void non_numeric_depth_is_400() throws Exception {
		mvc.perform(get(KDC).param("depth", "one").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	@DisplayName("토큰 없음 → 401")
	void no_token_is_401() throws Exception {
		mvc.perform(get(KDC).param("depth", "1"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	private void insert(String code, String label, String parent, int depth) {
		jdbc.update("insert into kdc_codes(code, label, parent_code, depth) values (?, ?, ?, ?)", code, label, parent, depth);
	}
}
