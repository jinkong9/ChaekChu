package com.ssafy.b102.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

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
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

import jakarta.persistence.EntityManager;

/**
 * API_SPEC §3.2·§3.3 온보딩 — OAuth 로 만들어진 PENDING 사용자가 프로필 → 취향을 보내 COMPLETED 가 되는 흐름.
 * 실제 PostgreSQL(V1 + V1.1 태그 seed). 각 테스트는 롤백.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class OnboardingApiTest {

	private static final String ME = "/api/v1/users/me";
	private static final String PROFILE = "/api/v1/users/me/profile";
	private static final String PREFERENCES = "/api/v1/users/me/preferences";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;
	@Autowired EntityManager em;   // 테스트 트랜잭션 안에서 JPA 변경을 JDBC 로 읽기 전에 flush

	private Long userId;
	private String bearer;
	private Long book1;
	private Long book2;

	@BeforeEach
	void setUp() {
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "onboarding-" + System.nanoTime()));
		userId = user.getId();
		bearer = "Bearer " + jwt.issue(userId);
		// ISBN 은 매 실행 고유하게 — 로컬 DB 에 샘플 도서가 이미 있어도 uq_books_isbn13 에 걸리지 않게 (CHECK: ^(978|979)[0-9]{10}$)
		book1 = insertBook(uniqueIsbn(1), "소년이 온다", "한강");
		book2 = insertBook(uniqueIsbn(2), "데미안", "헤르만 헤세");
	}

	private Long insertBook(String isbn13, String title, String author) {
		return jdbc.queryForObject("insert into books(isbn13, title, author) values (?, ?, ?) returning id", Long.class, isbn13, title, author);
	}

	private static String uniqueIsbn(int n) {
		long tail = (System.nanoTime() / 10 + n) % 1_000_000_000L;   // 9자리
		return "979" + n + String.format("%09d", tail);
	}

	// ── 프로필 ──

	@Test
	@DisplayName("프로필: 정상 저장 → 204, /users/me 에 반영, 온보딩 상태는 아직 PENDING")
	void profile_saved() throws Exception {
		mvc.perform(post(PROFILE).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nickname\":\"  책벌레  \",\"birthYear\":1996,\"gender\":\"F\"}"))
			.andExpect(status().isNoContent());

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.nickname").value("책벌레"))          // 앞뒤 공백 제거
			.andExpect(jsonPath("$.birthYear").value(1996))
			.andExpect(jsonPath("$.gender").value("F"))
			.andExpect(jsonPath("$.onboardingStatus").value("PENDING"));
	}

	@Test
	@DisplayName("프로필: 선택 항목 null 허용, 다시 보내면 덮어쓴다(멱등)")
	void profile_optionalNull_andOverwrite() throws Exception {
		mvc.perform(post(PROFILE).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nickname\":\"첫닉\",\"birthYear\":null,\"gender\":null}"))
			.andExpect(status().isNoContent());
		mvc.perform(post(PROFILE).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nickname\":\"둘째닉\",\"birthYear\":2001,\"gender\":\"m\"}"))
			.andExpect(status().isNoContent());

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.nickname").value("둘째닉"))
			.andExpect(jsonPath("$.birthYear").value(2001))
			.andExpect(jsonPath("$.gender").value("M"));
	}

	@Test
	@DisplayName("프로필: 닉네임 1자 · 출생연도 0(프론트가 빈 값을 0 으로 보냄) · 성별 X → 400 VALIDATION_FAILED, fields 에 셋 다")
	void profile_invalid_400WithFields() throws Exception {
		mvc.perform(post(PROFILE).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nickname\":\"a\",\"birthYear\":0,\"gender\":\"X\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[*].field").value(org.hamcrest.Matchers.containsInAnyOrder("nickname", "birthYear", "gender")));
	}

	@Test
	@DisplayName("프로필: 닉네임 누락(공백만) → 400, 토큰 없음 → 401")
	void profile_missingNickname_andNoToken() throws Exception {
		mvc.perform(post(PROFILE).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nickname\":\"   \"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("nickname"));
		mvc.perform(post(PROFILE).contentType(MediaType.APPLICATION_JSON).content("{\"nickname\":\"책벌레\"}"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	// ── 취향 ──

	@Test
	@DisplayName("취향: 장르(라벨·#라벨·코드 혼용, 모르는 값 무시) + 책 2권 → 204, COMPLETED, interestTags 순서 유지, 서재는 READ·완독일 없음·ONBOARDING")
	void preferences_saved_completesOnboarding() throws Exception {
		String body = "{\"genres\":[\"소설\",\"#과학\",\"TECH\",\"없는장르\",\"소설\"],"
			+ "\"books\":[{\"bookId\":\"" + book1 + "\",\"rating\":5},{\"bookId\":" + book2 + ",\"rating\":3}]}";   // bookId 숫자도 받는다(프론트 types 가 number)
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isNoContent());

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"))
			.andExpect(jsonPath("$.interestTags").value(org.hamcrest.Matchers.contains("#소설", "#과학", "#기술·IT")));

		em.flush();
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select book_id, status, rating, finished_at, source from user_library where user_id = ? order by book_id", userId);
		assertThat(rows).hasSize(2);
		assertThat(rows).allSatisfy(r -> {
			assertThat(r.get("status")).isEqualTo("READ");
			assertThat(r.get("finished_at")).isNull();
			assertThat(r.get("source")).isEqualTo("ONBOARDING");
		});
		assertThat(((Number) rows.get(0).get("rating")).intValue()).isEqualTo(5);
		assertThat(((Number) rows.get(1).get("rating")).intValue()).isEqualTo(3);
	}

	@Test
	@DisplayName("취향: 다시 보내면 관심 태그는 전체 교체, 이미 있는 책은 평점만 갱신(중복 행 없음)")
	void preferences_resubmit_replacesAndUpdates() throws Exception {
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[\"소설\",\"역사\"],\"books\":[{\"bookId\":\"" + book1 + "\",\"rating\":2}]}"))
			.andExpect(status().isNoContent());
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[\"여행\"],\"books\":[{\"bookId\":\"" + book1 + "\",\"rating\":4}]}"))
			.andExpect(status().isNoContent());

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.interestTags").value(org.hamcrest.Matchers.contains("#여행")));
		em.flush();
		List<Map<String, Object>> rows = jdbc.queryForList("select rating from user_library where user_id = ? and book_id = ?", userId, book1);
		assertThat(rows).hasSize(1);
		assertThat(((Number) rows.get(0).get("rating")).intValue()).isEqualTo(4);
	}

	@Test
	@DisplayName("취향: 건너뛰기(빈 배열 두 개) → 204, 그래도 COMPLETED")
	void preferences_skip_stillCompletes() throws Exception {
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[],\"books\":[]}"))
			.andExpect(status().isNoContent());
		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"))
			.andExpect(jsonPath("$.interestTags").isEmpty());
	}

	@Test
	@DisplayName("취향: 없는 책 → 404 BOOK_NOT_FOUND(details.bookId), 상태는 PENDING 그대로")
	void preferences_unknownBook_404() throws Exception {
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[\"소설\"],\"books\":[{\"bookId\":\"999999999\",\"rating\":5}]}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"))
			.andExpect(jsonPath("$.details.bookId").value("999999999"));
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[],\"books\":[{\"bookId\":\"abc\",\"rating\":5}]}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"));
	}

	@Test
	@DisplayName("취향: 별점 누락·범위 밖, 장르 6개 → 400 VALIDATION_FAILED")
	void preferences_invalid_400() throws Exception {
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[],\"books\":[{\"bookId\":\"" + book1 + "\"}]}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("books[0].rating"));
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[],\"books\":[{\"bookId\":\"" + book1 + "\",\"rating\":6}]}"))
			.andExpect(status().isBadRequest());
		mvc.perform(post(PREFERENCES).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"genres\":[\"소설\",\"에세이\",\"인문\",\"역사\",\"과학\",\"예술\"],\"books\":[]}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("genres"));
	}

	@Test
	@DisplayName("태그 seed: V1.1 이 온보딩 장르 12개를 GENRE 로 넣었다")
	void tagSeed_present() {
		Integer n = jdbc.queryForObject("select count(*) from tags where kind = 'GENRE'", Integer.class);
		assertThat(n).isEqualTo(12);
		assertThat(jdbc.queryForObject("select label from tags where tag_code = 'BUSINESS'", String.class)).isEqualTo("#경제·경영");
	}
}
