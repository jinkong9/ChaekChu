package com.ssafy.b102.book;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Year;

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
import com.ssafy.b102.user.entity.Gender;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §4.2·§4.3·§10-0(1). 기준월 '209912' 로 픽스처를 넣어 실제 적재분(202608 등)이 있는 로컬 DB 에서도 max(period) 가 픽스처를 고른다.
 * CI 는 빈 DB — 픽스처만으로 동작해야 한다. 각 테스트는 롤백.
 *
 * 픽스처 (세그먼트 → 책(대출수, 순위)):
 *   30/F: B1(500,1) B2(400,2) B3(300,3)      30/M: B2(450,1) B4(420,2) B5(100,3)      20/F: B6(900,1)
 *   → 30대 합산: B2 850 · B1 500 · B4 420 · B3 300 · B5 100   /  전체 합산: B6 900 · B2 850 · B1 500 …
 *   B7 은 표지가 없어(§9-9) 30/F 4위에 있어도 응답에서 빠져야 한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class PopularBooksApiTest {

	private static final String PERIOD = "209912";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;

	private long b1, b2, b3, b4, b5, b6, b7;
	private String bearerFull;      // 30대 여성
	private String bearerAgeOnly;   // 30대, 성별 응답 안 함
	private String bearerNone;      // 프로필 없음

	@BeforeEach
	void setUp() {
		int birthYearFor30s = Year.now().getValue() - 35;   // 35세 → 30대
		bearerFull = bearerOf(user("popular-full", birthYearFor30s, Gender.F));
		bearerAgeOnly = bearerOf(user("popular-age", birthYearFor30s, null));
		bearerNone = bearerOf(user("popular-none", null, null));

		b1 = book("소년이 온다", "한강", "813.7", true);
		b2 = book("데미안", "헤르만 헤세", "853", true);
		b3 = book("아몬드", "손원평", "813.7", true);
		b4 = book("1984", "조지 오웰", "843", true);
		b5 = book("채식주의자", "한강", "813.7", true);
		b6 = book("어린 왕자", "생텍쥐페리", "863", true);
		b7 = book("표지없는책", "아무개", "813.7", false);

		top(b1, "30", "F", 1, 500);
		top(b2, "30", "F", 2, 400);
		top(b3, "30", "F", 3, 300);
		top(b7, "30", "F", 4, 250);
		top(b2, "30", "M", 1, 450);
		top(b4, "30", "M", 2, 420);
		top(b5, "30", "M", 3, 100);
		top(b6, "20", "F", 1, 900);
	}

	// ── /books/popular ──

	@Test
	@DisplayName("연령+성별 → 그 세그먼트 순위 그대로, segment 라벨 '30대 여성', 표지 없는 책은 제외, BookSummary 필드 채움")
	void popular_fullSegment() throws Exception {
		mvc.perform(get("/api/v1/books/popular").header(HttpHeaders.AUTHORIZATION, bearerFull))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.segment.age").value("30"))
			.andExpect(jsonPath("$.segment.gender").value("F"))
			.andExpect(jsonPath("$.segment.label").value("30대 여성"))
			.andExpect(jsonPath("$.items[*].bookId").value(contains(String.valueOf(b1), String.valueOf(b2), String.valueOf(b3))))
			.andExpect(jsonPath("$.items[0].title").value("소년이 온다"))
			.andExpect(jsonPath("$.items[0].authors").value(contains("한강")))
			.andExpect(jsonPath("$.items[0].coverUrl").isString())
			.andExpect(jsonPath("$.items[0].category").value(org.hamcrest.Matchers.startsWith("문학")))   // kdc_codes 있으면 "문학 > 한국문학", 없으면 대분류 폴백
			.andExpect(jsonPath("$.items[0].classNo").value("813.7"))
			.andExpect(jsonPath("$.items[0].pageCount").value((Object) null));
	}

	@Test
	@DisplayName("연령만 → 같은 연령대 남녀 합산 재랭킹 (B2 850 > B1 500 > B4 420), segment.gender null, 라벨 '30대'")
	void popular_ageOnlyAggregates() throws Exception {
		mvc.perform(get("/api/v1/books/popular").param("size", "3").header(HttpHeaders.AUTHORIZATION, bearerAgeOnly))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.segment.age").value("30"))
			.andExpect(jsonPath("$.segment.gender").value((Object) null))
			.andExpect(jsonPath("$.segment.label").value("30대"))
			.andExpect(jsonPath("$.items[*].bookId").value(contains(String.valueOf(b2), String.valueOf(b1), String.valueOf(b4))));
	}

	@Test
	@DisplayName("프로필 없음 → 전 세그먼트 합산 (B6 900 > B2 850 > B1 500), segment null")
	void popular_noProfileAggregatesAll() throws Exception {
		mvc.perform(get("/api/v1/books/popular").param("size", "3").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.segment").value((Object) null))
			.andExpect(jsonPath("$.items[*].bookId").value(contains(String.valueOf(b6), String.valueOf(b2), String.valueOf(b1))));
	}

	@Test
	@DisplayName("size 기본 12·최대 40, 범위 밖은 400 VALIDATION_FAILED, 토큰 없음 401")
	void popular_sizeAndAuth() throws Exception {
		mvc.perform(get("/api/v1/books/popular").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(lessThanOrEqualTo(12)));
		mvc.perform(get("/api/v1/books/popular").param("size", "41").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		mvc.perform(get("/api/v1/books/popular").param("size", "0").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isBadRequest());
		mvc.perform(get("/api/v1/books/popular"))
			.andExpect(status().isUnauthorized());
	}

	// ── /books/popular-segments ──

	@Test
	@DisplayName("홈 링: 기준월 창(직전 3개월)·generatedAt, 행이 있는 세그먼트만, ranking 순, loanCount·coverLargeUrl 포함")
	void segments_shape() throws Exception {
		mvc.perform(get("/api/v1/books/popular-segments").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.generatedAt").value("2100-01-01T00:00:00Z"))
			.andExpect(jsonPath("$.period.startDate").value("2099-10-01"))
			.andExpect(jsonPath("$.period.endDate").value("2099-12-31"))
			.andExpect(jsonPath("$.segments[*].id").value(contains("20_F", "30_M", "30_F")))   // 10·20·…·60 × M,F 순, 빈 세그먼트 제외
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].label").value(hasItem("30대 여성")))
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].items.length()").value(hasItem(3)))   // B7(표지 없음) 제외
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].items[0].ranking").value(hasItem(1)))
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].items[0].loanCount").value(hasItem(500)))
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].items[0].book.bookId").value(hasItem(String.valueOf(b1))))
			.andExpect(jsonPath("$.segments[?(@.id=='30_F')].items[0].coverLargeUrl").value(hasItem("https://img.example/" + b1 + ".jpg")))
			.andExpect(jsonPath("$.segments[?(@.id=='20_F')].items[0].book.title").value(hasItem("어린 왕자")));
	}

	@Test
	@DisplayName("홈 링: 토큰 없음 401")
	void segments_requiresAuth() throws Exception {
		mvc.perform(get("/api/v1/books/popular-segments")).andExpect(status().isUnauthorized());
	}

	// ── /tags ──

	@Test
	@DisplayName("태그 사전: seed 12개, code·label('#소설')·kind·selectable")
	void tags_list() throws Exception {
		mvc.perform(get("/api/v1/tags").header(HttpHeaders.AUTHORIZATION, bearerNone))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items", hasSize(12)))
			.andExpect(jsonPath("$.items[?(@.code=='FICTION')].label").value(hasItem("#소설")))
			.andExpect(jsonPath("$.items[?(@.code=='FICTION')].kind").value(hasItem("GENRE")))
			.andExpect(jsonPath("$.items[?(@.code=='FICTION')].selectable").value(hasItem(true)));
		mvc.perform(get("/api/v1/tags")).andExpect(status().isUnauthorized());
	}

	// ── helpers ──

	private User user(String subject, Integer birthYear, Gender gender) {
		User u = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, subject + "-" + System.nanoTime()));
		u.updateProfile("테스터", birthYear, gender);
		return u;
	}

	private String bearerOf(User u) {
		return "Bearer " + jwt.issue(u.getId());
	}

	private long book(String title, String author, String kdc, boolean withCover) {
		long tail = (System.nanoTime() / 10) % 1_000_000_000L;
		String isbn = "9799" + String.format("%09d", tail);
		Long id = jdbc.queryForObject(
			"insert into books(isbn13, title, author, publisher, pub_year, category_code) values (?, ?, ?, '테스트출판', 2020, ?) returning id",
			Long.class, isbn, title, author, kdc);
		if (withCover) {
			jdbc.update("update books set cover_url = ? where id = ?", "https://img.example/" + id + ".jpg", id);
		}
		return id;
	}

	private void top(long bookId, String age, String gender, int ranking, int loanCount) {
		jdbc.update("insert into book_loaned_top20(book_id, gender, age_group, ranking, loan_count, period) values (?, ?, ?, ?, ?, ?)",
			bookId, gender, age, ranking, loanCount, PERIOD);
	}
}
