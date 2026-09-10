package com.ssafy.b102.library;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §6.1 GET /library/me — 본인 서재만, updatedAt 내림차순, status 필터.
 * 실제 PostgreSQL(V1). 서재 행은 JDBC 로 직접 넣어 updated_at 을 고정한다. 각 테스트는 롤백.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class LibraryApiTest {

	private static final String ME = "/api/v1/library/me";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;

	private Long userId;
	private String bearer;
	private Long wishBook;
	private Long readBook;
	private Long seedBook;

	@BeforeEach
	void setUp() {
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "library-" + System.nanoTime()));
		userId = user.getId();
		bearer = "Bearer " + jwt.issue(userId);
		wishBook = insertBook(uniqueIsbn(1), "채식주의자", "한강 지음");
		readBook = insertBook(uniqueIsbn(2), "데미안", "헤르만 헤세 지음; 전영애 옮김");
		seedBook = insertBook(uniqueIsbn(3), "코스모스", "칼 세이건");
	}

	// ── 조회 ──

	@Test
	@DisplayName("전체 조회: updatedAt 내림차순, 필드 매핑(완독일·seed null·저자 분해), 타인 행은 안 보인다")
	void mine_all_orderedAndMapped() throws Exception {
		insertLibrary(userId, seedBook, "READ", 5, null, null, "ONBOARDING", 3);          // 가장 오래된 변경
		insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 2);
		insertLibrary(userId, readBook, "READ", 4, "전개가 빠르다.", "2026-09-01", "SERVICE", 1);   // 가장 최근 변경

		Long other = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "other-" + System.nanoTime())).getId();
		insertLibrary(other, wishBook, "WISH", null, null, null, "SERVICE", 0);

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(3))
			.andExpect(jsonPath("$.items[*].book.bookId").value(Matchers.contains(
				String.valueOf(readBook), String.valueOf(wishBook), String.valueOf(seedBook))))
			// 최근 완독 — 모든 필드가 채워진 행
			.andExpect(jsonPath("$.items[0].libraryItemId").isString())
			.andExpect(jsonPath("$.items[0].status").value("READ"))
			.andExpect(jsonPath("$.items[0].rating").value(4))
			.andExpect(jsonPath("$.items[0].reviewText").value("전개가 빠르다."))
			.andExpect(jsonPath("$.items[0].finishedDate").value("2026-09-01"))
			.andExpect(jsonPath("$.items[0].createdAt").isString())
			.andExpect(jsonPath("$.items[0].updatedAt").isString())
			.andExpect(jsonPath("$.items[0].book.title").value("데미안"))
			.andExpect(jsonPath("$.items[0].book.authors").value(Matchers.contains("헤르만 헤세")))   // 역할어·옮긴이 제거
			// 찜 — 완독일·평점 없음(키는 존재)
			.andExpect(jsonPath("$.items[1].status").value("WISH"))
			.andExpect(jsonPath("$.items[1].rating").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.items[1].finishedDate").value(Matchers.nullValue()))
			// 온보딩 seed — READ 인데 완독일 null
			.andExpect(jsonPath("$.items[2].status").value("READ"))
			.andExpect(jsonPath("$.items[2].rating").value(5))
			.andExpect(jsonPath("$.items[2].finishedDate").value(Matchers.nullValue()));
	}

	@Test
	@DisplayName("status 필터: WISH 만 · READ 만(온보딩 seed 포함)")
	void mine_filteredByStatus() throws Exception {
		insertLibrary(userId, seedBook, "READ", 5, null, null, "ONBOARDING", 3);
		insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 2);
		insertLibrary(userId, readBook, "READ", 4, null, "2026-09-01", "SERVICE", 1);

		mvc.perform(get(ME).param("status", "WISH").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].book.bookId").value(String.valueOf(wishBook)));

		mvc.perform(get(ME).param("status", "READ").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].book.bookId").value(Matchers.contains(
				String.valueOf(readBook), String.valueOf(seedBook))));
	}

	@Test
	@DisplayName("빈 서재 → 200, items []")
	void mine_empty() throws Exception {
		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isArray())
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("status 가 WISH/READ 밖(READING 은 폐기됨) → 400 VALIDATION_FAILED, fields[0].field=status")
	void mine_invalidStatus_400() throws Exception {
		mvc.perform(get(ME).param("status", "READING").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("status"));
	}

	@Test
	@DisplayName("토큰 없음 → 401 UNAUTHORIZED")
	void mine_noToken_401() throws Exception {
		mvc.perform(get(ME))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	// ── 픽스처 ──

	private Long insertBook(String isbn13, String title, String author) {
		return jdbc.queryForObject("insert into books(isbn13, title, author) values (?, ?, ?) returning id", Long.class, isbn13, title, author);
	}

	/** updated_at 은 now() - daysAgo 로 고정해 정렬을 결정적으로 만든다. */
	private void insertLibrary(Long user, Long book, String status, Integer rating, String review, String finishedAt,
		String source, int daysAgo) {
		jdbc.update("""
			insert into user_library(user_id, book_id, status, rating, review_text, finished_at, source, created_at, updated_at)
			values (?, ?, ?, ?, ?, cast(? as date), ?, now() - (? * interval '1 day'), now() - (? * interval '1 day'))
			""", user, book, status, rating, review, finishedAt, source, daysAgo, daysAgo);
	}

	private static String uniqueIsbn(int n) {
		long tail = (System.nanoTime() / 10 + n) % 1_000_000_000L;   // 9자리. CHECK: ^(978|979)[0-9]{10}$
		return "979" + n + String.format("%09d", tail);
	}
}
