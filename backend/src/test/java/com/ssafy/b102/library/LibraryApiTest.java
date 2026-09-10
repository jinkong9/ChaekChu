package com.ssafy.b102.library;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
 * API_SPEC §6 서재 — §6.1 GET /library/me · §6.2 POST /library · §6.3 PATCH /library/{id} · §6.4 DELETE /library/{id}.
 * 실제 PostgreSQL(V1). 기존 서재 행은 JDBC 로 직접 넣어 updated_at 을 고정한다. 각 테스트는 롤백.
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
	@DisplayName("status 필터: 소문자 ?status=wish 도 본문과 같은 규칙으로 받는다(WebMvcConfig Converter)")
	void mine_filterCaseInsensitive() throws Exception {
		insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 1);
		insertLibrary(userId, readBook, "READ", 4, null, "2026-09-01", "SERVICE", 2);

		mvc.perform(get(ME).param("status", "wish").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].status").value("WISH"));
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

	// ── 수정 ──

	@Test
	@DisplayName("수정 WISH→READ(날짜 없음): 완독일 = 오늘(Asia/Seoul), 200 + 본문, updatedAt 이 바뀌어 목록 맨 앞으로")
	void patch_wishToRead_fillsToday() throws Exception {
		Long older = insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 5);
		insertLibrary(userId, readBook, "READ", 4, null, "2026-09-01", "SERVICE", 1);
		String todaySeoul = LocalDate.now(ZoneId.of("Asia/Seoul")).toString();

		mvc.perform(patch(LIBRARY + "/" + older).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.libraryItemId").value(String.valueOf(older)))
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.finishedDate").value(todaySeoul))
			.andExpect(jsonPath("$.book.bookId").value(String.valueOf(wishBook)));

		Map<String, Object> row = jdbc.queryForMap("select status, finished_at from user_library where id = ?", older);
		assertThat(row.get("status")).isEqualTo("READ");
		assertThat(String.valueOf(row.get("finished_at"))).isEqualTo(todaySeoul);

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items[0].libraryItemId").value(String.valueOf(older)));   // 5일 전 행이 갱신되어 맨 앞
	}

	@Test
	@DisplayName("수정 WISH→read(소문자) + finishedDate 지정: 지정한 날짜가 들어간다")
	void patch_wishToRead_withDate() throws Exception {
		Long id = insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"read\",\"finishedDate\":\"2026-08-15\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.finishedDate").value("2026-08-15"));
	}

	@Test
	@DisplayName("수정 WISH→READ 인데 finishedDate 를 명시적 null 로 보냄: 「없음」과 같이 오늘 — seed 처럼 null 이 되면 안 된다")
	void patch_wishToRead_explicitNullDate_fillsToday() throws Exception {
		Long id = insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 1);
		String todaySeoul = LocalDate.now(ZoneId.of("Asia/Seoul")).toString();

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\",\"finishedDate\":null}"))   // 날짜 입력을 비워 둔 폼이 이렇게 보낸다
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.finishedDate").value(todaySeoul));
	}

	@Test
	@DisplayName("수정 READ→WISH: 완독일 null, 평점·감상은 남는다(계약 §4.2)")
	void patch_readToWish_clearsFinishedKeepsRating() throws Exception {
		Long id = insertLibrary(userId, readBook, "READ", 4, "좋았다", "2026-09-01", "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"WISH\",\"finishedDate\":\"2026-08-15\"}"))   // WISH 가 이기고 날짜는 무시
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("WISH"))
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.rating").value(4))
			.andExpect(jsonPath("$.reviewText").value("좋았다"));

		assertThat(jdbc.queryForObject("select finished_at from user_library where id = ?", Object.class, id)).isNull();
	}

	@Test
	@DisplayName("수정 READ 에 READ 다시(멱등): 완독일 유지 — 날짜 있는 행도, 온보딩 seed 의 null 도")
	void patch_readAgain_keepsFinishedDate() throws Exception {
		Long dated = insertLibrary(userId, readBook, "READ", 4, null, "2026-09-01", "SERVICE", 1);
		Long seed = insertLibrary(userId, seedBook, "READ", 5, null, null, "ONBOARDING", 2);

		mvc.perform(patch(LIBRARY + "/" + dated).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.finishedDate").value("2026-09-01"));
		mvc.perform(patch(LIBRARY + "/" + seed).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\",\"rating\":3}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.rating").value(3));
	}

	@Test
	@DisplayName("수정 평점·감상만: 완독일 유지(seed 의 null 도), 감상은 strip, 다른 필드는 그대로")
	void patch_ratingAndReviewOnly_keepsFinishedDate() throws Exception {
		Long seed = insertLibrary(userId, seedBook, "READ", 5, null, null, "ONBOARDING", 2);
		Long dated = insertLibrary(userId, readBook, "READ", 4, "처음 감상", "2026-09-01", "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + seed).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":3,\"reviewText\":\"  다시 읽고 싶다  \"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.rating").value(3))
			.andExpect(jsonPath("$.reviewText").value("다시 읽고 싶다"))
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()));

		mvc.perform(patch(LIBRARY + "/" + dated).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":2}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.rating").value(2))
			.andExpect(jsonPath("$.reviewText").value("처음 감상"))       // 키를 안 보냈으니 유지
			.andExpect(jsonPath("$.finishedDate").value("2026-09-01"));

		assertThat(jdbc.queryForObject("select source from user_library where id = ?", String.class, seed)).isEqualTo("ONBOARDING");   // source 는 안 바뀐다
	}

	@Test
	@DisplayName("수정 null 로 지우기: rating null → 삭제, reviewText 공백만 → null, finishedDate null → READ 완독일 지움")
	void patch_nullsClear() throws Exception {
		Long id = insertLibrary(userId, readBook, "READ", 4, "좋았다", "2026-09-01", "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":null,\"reviewText\":\"   \",\"finishedDate\":null}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.rating").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.reviewText").value(Matchers.nullValue()))
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()));

		Map<String, Object> row = jdbc.queryForMap("select rating, review_text, finished_at from user_library where id = ?", id);
		assertThat(row.get("rating")).isNull();
		assertThat(row.get("review_text")).isNull();
		assertThat(row.get("finished_at")).isNull();
	}

	@Test
	@DisplayName("수정 finishedDate 만: READ 항목은 반영, WISH 항목은 무시(null 유지)")
	void patch_finishedDateOnly_readOnly() throws Exception {
		Long read = insertLibrary(userId, readBook, "READ", null, null, "2026-09-01", "SERVICE", 1);
		Long wish = insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 2);

		mvc.perform(patch(LIBRARY + "/" + read).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"finishedDate\":\"2026-07-01\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.finishedDate").value("2026-07-01"));
		mvc.perform(patch(LIBRARY + "/" + wish).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"finishedDate\":\"2026-07-01\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("WISH"))
			.andExpect(jsonPath("$.finishedDate").value(Matchers.nullValue()));
	}

	@Test
	@DisplayName("수정 빈 본문 {} → 200, 아무것도 안 바뀐다")
	void patch_emptyBody_noChange() throws Exception {
		Long id = insertLibrary(userId, readBook, "READ", 4, "좋았다", "2026-09-01", "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("READ"))
			.andExpect(jsonPath("$.rating").value(4))
			.andExpect(jsonPath("$.reviewText").value("좋았다"))
			.andExpect(jsonPath("$.finishedDate").value("2026-09-01"));
	}

	@Test
	@DisplayName("수정 검증: status READING · rating 6 · reviewText 301자 · finishedDate 형식 오류 → 400, fields 에 넷 다, DB 는 그대로")
	void patch_invalid_400AllFields() throws Exception {
		Long id = insertLibrary(userId, readBook, "READ", 4, "좋았다", "2026-09-01", "SERVICE", 1);
		String longReview = "가".repeat(301);

		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READING\",\"rating\":6,\"reviewText\":\"" + longReview + "\",\"finishedDate\":\"2026-13-01\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[*].field").value(Matchers.containsInAnyOrder("status", "rating", "reviewText", "finishedDate")));

		// 정확히 300자는 통과. 이모지(UTF-16 2단위) 300개도 「300자」 — PG VARCHAR(300) 과 같은 코드포인트 기준
		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"reviewText\":\"" + "가".repeat(300) + "\"}"))
			.andExpect(status().isOk());
		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"reviewText\":\"" + "📚".repeat(300) + "\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.reviewText").value("📚".repeat(300)));

		// rating "" 는 삭제(null)로 오인하지 않고 400. "4"(문자열 숫자) 는 4
		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":\"\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[0].field").value("rating"));
		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":\"3\"}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.rating").value(3));
		mvc.perform(patch(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"rating\":4}"))
			.andExpect(status().isOk());

		Map<String, Object> row = jdbc.queryForMap("select status, rating, finished_at from user_library where id = ?", id);
		assertThat(row.get("status")).isEqualTo("READ");
		assertThat(((Number) row.get("rating")).intValue()).isEqualTo(4);
		assertThat(String.valueOf(row.get("finished_at"))).isEqualTo("2026-09-01");
	}

	@Test
	@DisplayName("수정: 타인 항목 → 403 FORBIDDEN, 없는 항목·숫자 아닌 id → 404 LIBRARY_ITEM_NOT_FOUND(details.libraryItemId)")
	void patch_forbidden403_notFound404() throws Exception {
		Long other = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "other-" + System.nanoTime())).getId();
		Long theirs = insertLibrary(other, wishBook, "WISH", null, null, null, "SERVICE", 1);

		mvc.perform(patch(LIBRARY + "/" + theirs).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\"}"))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("FORBIDDEN"));
		assertThat(jdbc.queryForObject("select status from user_library where id = ?", String.class, theirs)).isEqualTo("WISH");

		mvc.perform(patch(LIBRARY + "/999999999").header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\"}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("LIBRARY_ITEM_NOT_FOUND"))
			.andExpect(jsonPath("$.details.libraryItemId").value("999999999"));
		mvc.perform(patch(LIBRARY + "/abc").header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"status\":\"READ\"}"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("LIBRARY_ITEM_NOT_FOUND"));
	}

	// ── 삭제 ──

	@Test
	@DisplayName("삭제: 204, 행이 사라지고 목록에서 빠진다. 다시 지우면 404. 같은 책을 다시 담으면 새 id")
	void delete_204_thenGone() throws Exception {
		Long id = insertLibrary(userId, readBook, "READ", 4, "좋았다", "2026-09-01", "SERVICE", 1);
		insertLibrary(userId, wishBook, "WISH", null, null, null, "SERVICE", 2);

		mvc.perform(delete(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNoContent());

		Integer n = jdbc.queryForObject("select count(*) from user_library where id = ?", Integer.class, id);
		assertThat(n).isZero();
		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].book.bookId").value(String.valueOf(wishBook)));

		mvc.perform(delete(LIBRARY + "/" + id).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("LIBRARY_ITEM_NOT_FOUND"));

		mvc.perform(post(LIBRARY).header(HttpHeaders.AUTHORIZATION, bearer).contentType(MediaType.APPLICATION_JSON)
				.content("{\"bookId\":\"" + readBook + "\",\"status\":\"WISH\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.libraryItemId").value(Matchers.not(String.valueOf(id))));
	}

	@Test
	@DisplayName("삭제: 타인 항목 → 403, 행은 남는다. 토큰 없음 → 401")
	void delete_forbidden403_noToken401() throws Exception {
		Long other = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "other-" + System.nanoTime())).getId();
		Long theirs = insertLibrary(other, wishBook, "WISH", null, null, null, "SERVICE", 1);

		mvc.perform(delete(LIBRARY + "/" + theirs).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("FORBIDDEN"));
		assertThat(jdbc.queryForObject("select count(*) from user_library where id = ?", Integer.class, theirs)).isEqualTo(1);

		mvc.perform(delete(LIBRARY + "/" + theirs))
			.andExpect(status().isUnauthorized());
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
