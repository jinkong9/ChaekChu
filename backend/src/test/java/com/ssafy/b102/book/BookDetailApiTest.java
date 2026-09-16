package com.ssafy.b102.book;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
 * API_SPEC §4.4·§4.6 도서 상세·함께 대출된 책.
 *
 * 수요 지표는 기준월을 테스트마다 다르게 쓴다('2099-11'·'2099-12') — 실제 적재분('2026-08', 275만 행)과 섞이지 않게 하고,
 * 백분위 경계값 캐시(BookDemandRankResolver)가 테스트끼리 간섭하지 않게 하려는 것이다. 캐시는 기준월 단위라 월이 다르면 독립이다.
 * 각 테스트는 롤백. CI 는 빈 DB 라 픽스처만으로 돈다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class BookDetailApiTest {

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;

	private Long userId;
	private String bearer;
	private String otherBearer;
	private long bookId;
	private String isbn;

	@BeforeEach
	void setUp() {
		User me = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "detail-" + System.nanoTime()));
		userId = me.getId();
		bearer = "Bearer " + jwt.issue(userId);
		User other = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "detail-other-" + System.nanoTime()));
		otherBearer = "Bearer " + jwt.issue(other.getId());

		isbn = uniqueIsbn();
		bookId = book(isbn, "소년이 온다", "한강", "813.62");
	}

	// ── 상세 ──

	@Test
	@DisplayName("상세: 내부 id 조회 — BookSummary 평면 + 소개문·출처, 없는 값은 null 키로 유지")
	void detail_byInternalId() throws Exception {
		jdbc.update("update books set description = ?, description_source = 'DATA4LIBRARY', vol = '2' where id = ?",
			"소년의 이야기.", bookId);

		mvc.perform(get("/api/v1/books/" + bookId).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.bookId").value(String.valueOf(bookId)))
			.andExpect(jsonPath("$.isbn13").value(isbn))
			.andExpect(jsonPath("$.title").value("소년이 온다"))
			.andExpect(jsonPath("$.authors").value(contains("한강")))
			.andExpect(jsonPath("$.classNo").value("813.62"))
			.andExpect(jsonPath("$.volume").value("2"))                      // V6 books.vol — BookSummary 평면과 같은 이름
			.andExpect(jsonPath("$.category").value(startsWith("문학")))   // kdc_codes 있으면 "문학 > 한국문학", 없으면 대분류 폴백
			.andExpect(jsonPath("$.description").value("소년의 이야기."))
			.andExpect(jsonPath("$.descriptionSource").value("DATA4LIBRARY"))
			.andExpect(jsonPath("$.subtitle").value((Object) null))
			.andExpect(jsonPath("$.toc").value((Object) null))
			.andExpect(jsonPath("$.pageCount").value((Object) null))
			.andExpect(jsonPath("$.loanByAge").value((Object) null))
			.andExpect(jsonPath("$.my").value((Object) null))
			.andExpect(jsonPath("$.metrics").isArray());
	}

	@Test
	@DisplayName("상세: 13자리 ISBN 으로도 찾는다(홈 인기 링 경로) — 응답 bookId 는 내부 id")
	void detail_byIsbn13() throws Exception {
		mvc.perform(get("/api/v1/books/" + isbn).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.bookId").value(String.valueOf(bookId)))
			.andExpect(jsonPath("$.isbn13").value(isbn))
			.andExpect(jsonPath("$.volume").value((Object) null));           // 권차 미상은 null 키 유지 — 「단권」이 아니다
	}

	@Test
	@DisplayName("상세: 없는 id·없는 ISBN → 404 BOOK_NOT_FOUND, 토큰 없음 → 401")
	void detail_notFoundAndAuth() throws Exception {
		mvc.perform(get("/api/v1/books/999999999").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"))
			.andExpect(jsonPath("$.details.bookId").value("999999999"));
		mvc.perform(get("/api/v1/books/9790000000009").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"));
		mvc.perform(get("/api/v1/books/" + bookId))
			.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("상세: metrics 는 표시용 문자열 — 누적 대출·소장 도서관, 값 없는 지표는 배열에서 빠진다")
	void detail_metrics() throws Exception {
		long dummy = book(uniqueIsbn(), "더미", "저자", "813");
		demand(dummy, "2099-11", 99_999L, null, 10);          // 경계값이 이 책 위에 잡히도록
		demand(bookId, "2099-11", 27_551L, null, 1_535);      // loan_3m 없음 → 「최근 3개월 대출」 항목 없음

		mvc.perform(get("/api/v1/books/" + bookId).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.metrics[*].name").value(contains("누적 대출", "소장 도서관")))
			.andExpect(jsonPath("$.metrics[?(@.name=='누적 대출')].value").value(hasItem("27,551회")))
			.andExpect(jsonPath("$.metrics[?(@.name=='누적 대출')].asOf").value(hasItem("2099-11")))
			.andExpect(jsonPath("$.metrics[?(@.name=='누적 대출')].source").value(hasItem("정보나루")))
			.andExpect(jsonPath("$.metrics[?(@.name=='소장 도서관')].value").value(hasItem("1,535개관")));
	}

	@Test
	@DisplayName("상세: 수요 스냅샷이 없는 책은 metrics 빈 배열")
	void detail_noDemand() throws Exception {
		mvc.perform(get("/api/v1/books/" + bookId).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.metrics").isEmpty());
	}

	@Test
	@DisplayName("상세: 「전국 대출 순위」는 상위 25% 이내일 때만 — 20권 중 1위 상위 1%, 4위 상위 25%, 6위는 항목 없음")
	void detail_nationalRank() throws Exception {
		// loan_cum 100·200·…·2000 (20행). 경계값: 1~5% → 2000, 10% → 1900, 25% → 1600
		long[] ids = new long[20];
		for (int i = 0; i < 20; i++) {
			ids[i] = book(uniqueIsbn(), "순위책" + i, "저자", "813");
			demand(ids[i], "2099-12", (i + 1) * 100L, null, 1);
		}
		mvc.perform(get("/api/v1/books/" + ids[19] + "").header(HttpHeaders.AUTHORIZATION, bearer))   // 2000 → 1위
			.andExpect(jsonPath("$.metrics[?(@.name=='전국 대출 순위')].value").value(hasItem("상위 1%")));
		mvc.perform(get("/api/v1/books/" + ids[16]).header(HttpHeaders.AUTHORIZATION, bearer))        // 1700 → 10% 경계 밖, 25% 안
			.andExpect(jsonPath("$.metrics[?(@.name=='전국 대출 순위')].value").value(hasItem("상위 25%")));
		mvc.perform(get("/api/v1/books/" + ids[5]).header(HttpHeaders.AUTHORIZATION, bearer))         // 600 → 상위 25% 밖
			.andExpect(jsonPath("$.metrics[*].name").value(org.hamcrest.Matchers.not(hasItem("전국 대출 순위"))));
	}

	@Test
	@DisplayName("상세: my 는 본인 서재 기록만 — libraryItemId 로 상세에서 바로 PATCH 할 수 있다. 남의 기록은 안 보인다")
	void detail_myRecord() throws Exception {
		Long itemId = jdbc.queryForObject("""
			insert into user_library(user_id, book_id, status, rating, review_text, finished_at, source)
			values (?, ?, 'READ', 4, '전개가 빠르다.', date '2026-09-01', 'SERVICE') returning id""",
			Long.class, userId, bookId);

		mvc.perform(get("/api/v1/books/" + bookId).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.my.libraryItemId").value(String.valueOf(itemId)))
			.andExpect(jsonPath("$.my.status").value("READ"))
			.andExpect(jsonPath("$.my.rating").value(4))
			.andExpect(jsonPath("$.my.reviewText").value("전개가 빠르다."))
			.andExpect(jsonPath("$.my.finishedDate").value("2026-09-01"));

		mvc.perform(get("/api/v1/books/" + bookId).header(HttpHeaders.AUTHORIZATION, otherBearer))
			.andExpect(jsonPath("$.my").value((Object) null));
	}

	// ── 함께 대출된 책 ──

	@Test
	@DisplayName("함께 대출: rank 순, 카탈로그에 없는 대상(target_book_id NULL)은 빠지고 rank 는 건너뛴다")
	void coLoans_ordered() throws Exception {
		long t1 = book(uniqueIsbn(), "채식주의자", "한강", "813.62");
		long t2 = book(uniqueIsbn(), "흰", "한강", "813.62");
		jdbc.update("update books set vol = '1' where id = ?", t1);   // 함께대출 상대도 권차가 나가야 시리즈가 구별된다
		coLoan(bookId, t1, 1);
		coLoan(bookId, null, 2);          // 카탈로그에 없는 대상 — 응답에서 빠진다
		coLoan(bookId, t2, 3);

		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.source").value("DATA4LIBRARY"))
			.andExpect(jsonPath("$.asOf").value("2026-08"))
			.andExpect(jsonPath("$.items", hasSize(2)))
			.andExpect(jsonPath("$.items[*].rank").value(contains(1, 3)))
			.andExpect(jsonPath("$.items[0].book.bookId").value(String.valueOf(t1)))
			.andExpect(jsonPath("$.items[0].book.title").value("채식주의자"))
			.andExpect(jsonPath("$.items[0].book.authors").value(contains("한강")))
			.andExpect(jsonPath("$.items[0].book.volume").value("1"))
			.andExpect(jsonPath("$.items[1].book.volume").value((Object) null));
	}

	@Test
	@DisplayName("함께 대출: size 로 자른다(기본 8·최대 20), 범위 밖은 400")
	void coLoans_size() throws Exception {
		for (int i = 1; i <= 10; i++) {
			coLoan(bookId, book(uniqueIsbn(), "이웃" + i, "저자", "813"), i);
		}
		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items", hasSize(8)));                       // 기본 8
		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans").param("size", "3").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(jsonPath("$.items", hasSize(3)));
		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans").param("size", "21").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	@DisplayName("함께 대출: 관계가 없으면 items 빈 배열·asOf null (200), 없는 책은 404, 토큰 없으면 401")
	void coLoans_emptyAndErrors() throws Exception {
		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.asOf").value((Object) null));
		mvc.perform(get("/api/v1/books/999999999/co-loans").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"));
		mvc.perform(get("/api/v1/books/" + bookId + "/co-loans"))
			.andExpect(status().isUnauthorized());
	}

	// ── helpers ──

	private static String uniqueIsbn() {
		long tail = (System.nanoTime() / 7) % 1_000_000_000L;
		return "9791" + String.format("%09d", tail);
	}

	private long book(String isbn13, String title, String author, String kdc) {
		return jdbc.queryForObject("""
			insert into books(isbn13, title, author, publisher, pub_year, category_code, cover_url)
			values (?, ?, ?, '창비', 2014, ?, 'https://img.example/c.jpg') returning id""",
			Long.class, isbn13, title, author, kdc);
	}

	private void demand(long id, String month, Long loanCum, Integer loan3m, Integer holderLibs) {
		jdbc.update("""
			insert into book_demand_features(book_id, as_of_month, loan_cum, loan_3m, holder_libs, feature_version)
			values (?, ?, ?, ?, ?, 'test')""", id, month, loanCum, loan3m, holderLibs);
	}

	private void coLoan(long sourceId, Long targetId, int rank) {
		String targetIsbn = targetId == null ? uniqueIsbn()
			: jdbc.queryForObject("select isbn13 from books where id = ?", String.class, targetId);
		jdbc.update("""
			insert into book_relations(source_book_id, target_book_id, target_isbn13, relation_type, rank, collected_at)
			values (?, ?, ?, 'CO_LOAN', ?, date '2026-08-31')""", sourceId, targetId, targetIsbn, rank);
	}
}
