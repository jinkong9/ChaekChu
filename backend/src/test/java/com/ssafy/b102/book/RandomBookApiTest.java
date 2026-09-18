package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §4.8 — GET /books/random. 실제 PG 에 픽스처를 넣고 MockMvc 로 부른다.
 *
 * 무작위라 「어느 책」이 아니라 「어느 집합 안」인지를 반복 호출로 본다. 로컬 DB 에는 다른 테스트·적재분의 적격 행이 남아 있을 수 있어
 * 시작 시점의 적격 id 집합을 미리 읽어 허용 집합에 더한다 — CI 는 빈 DB 라 우리 픽스처 3권만 허용된다.
 * 표본 단계(TABLESAMPLE 0.5%)는 행이 몇 개뿐인 테스트 DB 에서 거의 항상 비어 폴백 경로가 돈다. 두 경로의 모집단 조건은 같은 문장이라 여기서는 결과 집합만 본다.
 * 각 테스트는 롤백.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class RandomBookApiTest {

	private static final String RANDOM = "/api/v1/books/random";
	/** 적격이 우리 3권뿐일 때 30번 안에 셋이 다 안 나올 확률은 3 × (2/3)^30 ≈ 0.002% — 플래키로 볼 수준이 아니다. */
	private static final int ROUNDS = 30;
	private static final String KDC = "813.7";
	private static final AtomicLong SEQ = new AtomicLong();

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;
	@Autowired ObjectMapper objectMapper;

	private String bearer;
	/** 픽스처를 넣기 전에 이미 있던 적격 책(로컬 DB 잔여물). CI 는 빈 집합. */
	private Set<String> eligibleBefore;
	/** 우리 적격 3권 — 표지 있는 CORE·NEW 후보. */
	private List<Long> eligible;
	/** 나와서는 안 되는 5권 — 표지 null 후보 · 표지 빈 문자열 후보 · 표지 있는 비후보(TAIL) · 표지는 있지만 KDC null 후보 · KDC 빈 문자열 후보. */
	private List<Long> ineligible;

	@BeforeEach
	void setUp() {
		User me = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "random-" + System.nanoTime()));
		bearer = "Bearer " + jwt.issue(me.getId());

		eligibleBefore = new HashSet<>(jdbc.queryForList("""
			select cast(id as text) from books
			where is_candidate and cover_url is not null and cover_url <> '' and category_code is not null and category_code <> ''""",
			String.class));
		eligible = List.of(
			book("가챠 적격 1", "https://img.example/1.jpg", "CORE", true),
			book("가챠 적격 2", "https://img.example/2.jpg", "NEW", true),
			book("가챠 적격 3", "https://img.example/3.jpg", "CORE", true));
		ineligible = List.of(
			book("표지 없는 후보", null, "CORE", true),
			book("빈 표지 후보", "", "CORE", true),
			book("표지 있는 비후보", "https://img.example/x.jpg", "TAIL", false),
			book("표지 있지만 KDC 없는 후보", "https://img.example/k1.jpg", "CORE", true, null),   // 프론트가 classNo 로 판정 문구를 만들어 KDC 없는 책은 뺀다(09-17 리뷰)
			book("표지 있지만 KDC 빈 문자열 후보", "https://img.example/k2.jpg", "CORE", true, ""));
	}

	@Test
	@DisplayName("모집단은 표지·KDC 있는 추천 후보만 — 30번 뽑아도 표지 없는 후보·빈 표지·비후보·KDC 없는 후보는 한 번도 안 나온다. 적격이 우리 3권뿐이면 셋이 다 나온다(매번 새로 뽑는다)")
	void picks_only_candidates_with_cover() throws Exception {
		Set<String> allowed = new HashSet<>(eligibleBefore);
		eligible.forEach(id -> allowed.add(String.valueOf(id)));
		Set<String> forbidden = ineligible.stream().map(String::valueOf).collect(Collectors.toSet());

		Set<String> seen = new HashSet<>();
		for (int i = 0; i < ROUNDS; i++) {
			String bookId = pick(null);
			assertThat(bookId).isIn(allowed).isNotIn(forbidden);
			seen.add(bookId);
		}
		if (eligibleBefore.isEmpty()) {
			assertThat(seen).hasSize(3);
		}
	}

	@Test
	@DisplayName("exclude 는 직전 책을 뺀다 — 그 id 는 30번 중 한 번도 안 나온다. 적격이 우리 3권뿐이면 나머지 둘만 나온다")
	void exclude_removes_that_book() throws Exception {
		long excluded = eligible.get(0);

		Set<String> seen = new HashSet<>();
		for (int i = 0; i < ROUNDS; i++) {
			String bookId = pick(excluded);
			assertThat(bookId).isNotEqualTo(String.valueOf(excluded));
			seen.add(bookId);
		}
		if (eligibleBefore.isEmpty()) {
			assertThat(seen).containsExactlyInAnyOrder(String.valueOf(eligible.get(1)), String.valueOf(eligible.get(2)));
		}
	}

	@Test
	@DisplayName("응답은 BookSummary 단일 객체(봉투 없음) — bookId 문자열·authors 배열·coverUrl 채움·volume 키 존재, Cache-Control: no-store")
	void shape_and_no_store() throws Exception {
		mvc.perform(get(RANDOM).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
			.andExpect(jsonPath("$.bookId").isString())
			.andExpect(jsonPath("$.title").isString())
			.andExpect(jsonPath("$.authors").isArray())
			.andExpect(jsonPath("$.coverUrl").isNotEmpty())
			.andExpect(jsonPath("$.classNo").hasJsonPath())
			.andExpect(jsonPath("$.volume").hasJsonPath())
			.andExpect(jsonPath("$.items").doesNotExist())
			.andExpect(jsonPath("$.book").doesNotExist());
	}

	@Test
	@DisplayName("토큰 없음 → 401")
	void unauthorized() throws Exception {
		mvc.perform(get(RANDOM))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	@DisplayName("exclude 가 숫자가 아니면 400 VALIDATION_FAILED, fields[].field = exclude")
	void exclude_not_a_number_is_400() throws Exception {
		mvc.perform(get(RANDOM).param("exclude", "abc").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("exclude")));
	}

	// ── helpers ──

	/** 한 번 뽑아 bookId 를 돌려준다. 우리 픽스처가 나왔으면 classNo 가 그대로 실렸는지도 본다(프론트가 레이더 축 대조에 쓰는 값). */
	private String pick(Long exclude) throws Exception {
		MockHttpServletRequestBuilder req = get(RANDOM).header(HttpHeaders.AUTHORIZATION, bearer);
		if (exclude != null) {
			req = req.param("exclude", String.valueOf(exclude));
		}
		String body = mvc.perform(req).andExpect(status().isOk())
			.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
		JsonNode node = objectMapper.readTree(body);
		String bookId = node.get("bookId").asText();
		if (eligible.contains(Long.valueOf(bookId))) {
			assertThat(node.get("classNo").asText()).isEqualTo(KDC);
			assertThat(node.get("coverUrl").asText()).startsWith("https://img.example/");
		}
		return bookId;
	}

	private static String uniqueIsbn() {
		long tail = (System.nanoTime() / 7 + SEQ.incrementAndGet()) % 1_000_000_000L;
		return "9791" + String.format("%09d", tail);
	}

	private long book(String title, String coverUrl, String layer, boolean candidate) {
		return book(title, coverUrl, layer, candidate, KDC);
	}

	/**
	 * catalog_layer 는 V5 CHECK 때문에 후보(is_candidate)면 CORE·NEW 여야 한다. 비후보는 TAIL. kdc 는 null·빈 문자열도 받는다(부적격 픽스처용).
	 * is_searchable 은 V11 CHECK(ck_books_candidate_needs_searchable — 후보면 검색 대상이어야 한다) 때문에 후보와 같은 값으로 넣는다.
	 */
	private long book(String title, String coverUrl, String layer, boolean candidate, String kdc) {
		return jdbc.queryForObject("""
			insert into books(isbn13, title, author, publisher, pub_year, category_code, cover_url, catalog_layer, is_searchable, is_candidate)
			values (?, ?, '가챠 저자', '가챠 출판사', 2020, ?, ?, ?, ?, ?) returning id""",
			Long.class, uniqueIsbn(), title, kdc, coverUrl, layer, candidate, candidate);
	}
}
