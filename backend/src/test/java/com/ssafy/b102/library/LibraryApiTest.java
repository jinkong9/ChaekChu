package com.ssafy.b102.library;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

import org.hamcrest.Matchers;
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

/**
 * API_SPEC §6.1 GET /library/me · §6.2 POST /library.
 * 실제 PostgreSQL(V1). 조회용 서재 행은 JDBC 로 직접 넣어 updated_at 을 고정한다. 각 테스트는 롤백.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class LibraryApiTest {

	private static final String LIBRARY = "/api/v1/library";
	private static final String ME = LIBRARY + "/me";

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

	// ── 담기 ──

	@Test
	@DisplayName("담기 WISH: 201 + LibraryItem 본문(완독일·평점 null), DB 는 source=SERVICE, 이후 조회에 보인다")
	void add_wish_201() throws Exception {
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + wishBook + "\",\"status\":\"WISH\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.libraryItemId").isString())
			.andExpect(jsonPath("$.status").value("WISH"))
			.andExpect(jsonPath("$.rating").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.reviewText").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.createdAt").isString())
			.andExpect(jsonPath("$.updatedAt").isString())
			.andExpect(jsonPath("$.book.bookId").value(String.valueOf(wishBook)))
			.andExpect(jsonPath("$.book.title").value("채식주의자"));

		Map<String, Object> row = jdbc.queryForMap(
			"select status, rating, finished_at, source from user_library where user_id = ? and book_id = ?", userId, wishBook);
		assertThat(row.get("status")).isEqualTo("WISH");
		assertThat(row.get("rating")).isNull();
		assertThat(row.get("finished_at")).isNull();
		assertThat(row.get("source")).isEqualTo("SERVICE");

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].book.bookId").value(String.valueOf(wishBook)));
	}

	@Test
	@DisplayName("담기 READ(소문자도 허용): 완독일 = 오늘(Asia/Seoul), bookId 숫자로 보내도 된다")
	void add_read_fillsTodayInSeoul() throws Exception {
		String todaySeoul = LocalDate.now(ZoneId.of("Asia/Seoul")).toString();

		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":" + readBook + ",\"status\":\"read\"}"))   // 프론트 types 의 bookId 가 number
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.finishedDate").value(todaySeoul));

		Object finishedAt = jdbc.queryForObject("select finished_at from user_library where user_id = ? and book_id = ?", Object.class, userId, readBook);
		assertThat(String.valueOf(finishedAt)).isEqualTo(todaySeoul);
	}

	@Test
	@DisplayName("담기: 이미 있는 책 → 409 LIBRARY_ITEM_EXISTS + details.libraryItemId(기존 행), 행은 그대로 1개")
	void add_duplicate_409WithExistingId() throws Exception {
		Long existingId = insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 1);

		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + wishBook + "\",\"status\":\"READ\"}"))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("LIBRARY_ITEM_EXISTS"))
			.andExpect(jsonPath("$.details.libraryItemId").value(String.valueOf(existingId)));

		Integer n = jdbc.queryForObject("select count(*) from user_library where user_id = ? and book_id = ?", Integer.class, userId, wishBook);
		assertThat(n).isEqualTo(1);
		assertThat(jdbc.queryForObject("select status from user_library where id = ?", String.class, existingId)).isEqualTo("WISH");   // 승격되지 않는다(PATCH 의 일)
	}

	@Test
	@DisplayName("담기: 없는 책 · 숫자가 아닌 bookId → 404 BOOK_NOT_FOUND(details.bookId)")
	void add_unknownBook_404() throws Exception {
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"999999999\",\"status\":\"WISH\"}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"))
			.andExpect(jsonPath("$.details.bookId").value("999999999"));
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"abc\",\"status\":\"WISH\"}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"))
			.andExpect(jsonPath("$.details.bookId").value("abc"));
	}

	@Test
	@DisplayName("담기: status 누락 · READING · bookId 빈 값 → 400 VALIDATION_FAILED, fields 에 해당 필드")
	void add_invalid_400() throws Exception {
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + wishBook + "\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("status"));
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + wishBook + "\",\"status\":\"READING\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[0].field").value("status"));
		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"  \",\"status\":\"WISH\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("bookId"));

		Integer n = jdbc.queryForObject("select count(*) from user_library where user_id = ?", Integer.class, userId);
		assertThat(n).isZero();
	}

	@Test
	@DisplayName("담기: 토큰 없음 → 401")
	void add_noToken_401() throws Exception {
		mvc.perform(post(LIBRARY).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + wishBook + "\",\"status\":\"WISH\"}"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	// ── 픽스처 ──

	private Long insertBook(String isbn13, String title, String author) {
		return jdbc.queryForObject("insert into books(isbn13, title, author) values (?, ?, ?) returning id", Long.class, isbn13, title, author);
	}

	/** updated_at 은 now() - daysAgo 로 고정해 정렬을 결정적으로 만든다. 만든 행의 id 를 돌려준다. */
	private Long insertLibrary(Long user, Long book, String status, Integer rating, String review, String finishedAt,
		String source, int daysAgo) {
		return jdbc.queryForObject("""
			insert into user_library(user_id, book_id, status, rating, review_text, finished_at, source, created_at, updated_at)
			values (?, ?, ?, ?, ?, cast(? as date), ?, now() - (? * interval '1 day'), now() - (? * interval '1 day'))
			returning id
			""", Long.class, user, book, status, rating, review, finishedAt, source, daysAgo, daysAgo);
	}

	private static String uniqueIsbn(int n) {
		long tail = (System.nanoTime() / 10 + n) % 1_000_000_000L;   // 9자리. CHECK: ^(978|979)[0-9]{10}$
		return "979" + n + String.format("%09d", tail);
	}
}
