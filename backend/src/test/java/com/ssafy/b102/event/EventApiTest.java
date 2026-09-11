package com.ssafy.b102.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §7.1 POST /events — 행동 이벤트 수집.
 *
 * 이 API 의 계약은 「무엇을 해도 202」이므로, 상태 코드만 봐서는 아무것도 검증되지 않는다.
 * 그래서 모든 테스트가 <b>user_actions 에 실제로 몇 행이 어떤 값으로 들어갔는지</b>를 본다.
 * 실제 PostgreSQL(V1·V3)을 쓰고 각 테스트는 롤백한다 — 이벤트 저장은 REQUIRES_NEW 가 아니라 요청 트랜잭션에 붙는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class EventApiTest {

	private static final String EVENTS = "/api/v1/events";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;
	@Autowired ObjectMapper objectMapper;

	private Long userId;
	private String bearer;
	private Long bookId;
	private String isbn13;

	@BeforeEach
	void setUp() {
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "event-" + System.nanoTime()));
		userId = user.getId();
		bearer = "Bearer " + jwt.issue(userId);
		isbn13 = uniqueIsbn();
		bookId = insertBook(isbn13, "소년이 온다");
	}

	// ── 저장되는 경우 ──

	@Test
	@DisplayName("CLICK: 사용자·도서·순위·표시 위치·화면·세션이 그대로 남고 context 는 대문자로 정규화된다")
	void click_storesEveryColumn() throws Exception {
		send(Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId), "rank", 3, "position", 1,
			"context", "recommend", "sessionId", "s-1", "clientEventId", "c-1"));

		Map<String, Object> row = onlyAction();
		assertThat(row.get("user_id")).isEqualTo(userId);
		assertThat(row.get("book_id")).isEqualTo(bookId);
		assertThat(row.get("event_type")).isEqualTo("CLICK");
		assertThat(((Number)row.get("rank")).intValue()).isEqualTo(3);
		assertThat(((Number)row.get("display_position")).intValue()).isEqualTo(1);
		assertThat(row.get("context")).isEqualTo("RECOMMEND");
		assertThat(row.get("session_id")).isEqualTo("s-1");
		assertThat(row.get("client_event_id")).isEqualTo("c-1");
		assertThat(row.get("recommendation_id")).isNull();
	}

	@Test
	@DisplayName("bookId 를 ISBN13 으로 보내도 내부 id 로 풀어서 저장한다")
	void click_acceptsIsbn13() throws Exception {
		send(Map.of("eventType", "CLICK", "bookId", isbn13));

		assertThat(onlyAction().get("book_id")).isEqualTo(bookId);
	}

	@Test
	@DisplayName("저장된 추천 덱이 있으면 recommendationId 를 내부 id 로 이어 붙인다")
	void impression_linksSavedDeck() throws Exception {
		long deckId = insertDeck("rec_test_linked");

		send(Map.of("eventType", "IMPRESSION", "recommendationId", "rec_test_linked", "clientEventId", "c-imp"));

		assertThat(onlyAction().get("recommendation_id")).isEqualTo(deckId);
	}

	@Test
	@DisplayName("저장된 덱이 없는 recommendationId 는 비워서 저장한다 — 책 단위 신호까지 버리지는 않는다")
	void click_keepsEventWhenDeckUnknown() throws Exception {
		send(Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId), "recommendationId", "rec_없는덱"));

		Map<String, Object> row = onlyAction();
		assertThat(row.get("recommendation_id")).isNull();
		assertThat(row.get("book_id")).isEqualTo(bookId);
	}

	@Test
	@DisplayName("남의 덱 id 를 실어 보내도 잇지 않는다 — 그 덱의 지표를 흔들 수 없다")
	void click_doesNotLinkOtherUsersDeck() throws Exception {
		Long stranger = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "other-" + System.nanoTime())).getId();
		jdbc.update("""
			insert into recommendations (user_id, public_id, mode, fallback, based_on_count, weights, input_tags)
			values (?, 'rec_남의덱', 'PERSONALIZED', false, 0, '{}'::jsonb, '[]'::jsonb)""", stranger);

		send(Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId), "recommendationId", "rec_남의덱"));

		assertThat(onlyAction().get("recommendation_id")).isNull();
	}

	@Test
	@DisplayName("SEARCH: 질의어와 결과 수가 payload 로 들어간다")
	void search_storesQueryInPayload() throws Exception {
		send(Map.of("eventType", "SEARCH", "query", "  한강  ", "resultCount", 42, "context", "SEARCH"));

		assertThat(onlyAction().get("book_id")).isNull();
		assertThat(payload("query")).isEqualTo("한강");
		assertThat(payload("resultCount")).isEqualTo("42");
	}

	@Test
	@DisplayName("BOOK_VIEW: 체류 시간은 payload 에 남고, 하루를 넘는 값은 버린다(탭을 열어 둔 것이다)")
	void bookView_storesDwellButDropsAbsurd() throws Exception {
		send(Map.of("eventType", "BOOK_VIEW", "bookId", String.valueOf(bookId), "dwellMs", 4200, "clientEventId", "c-1"));
		assertThat(payload("dwellMs")).isEqualTo("4200");

		send(Map.of("eventType", "BOOK_VIEW", "bookId", String.valueOf(bookId), "dwellMs", 999_999_999L,
			"clientEventId", "c-2"));
		assertThat(countActions()).isEqualTo(2);
		assertThat(jdbc.queryForObject(
			"select payload->>'dwellMs' from user_actions where user_id = ? and client_event_id = 'c-2'",
			String.class, userId)).isNull();
	}

	@Test
	@DisplayName("DISMISS 도 그대로 받는다 — 하나뿐인 부정 신호다")
	void dismiss_isStored() throws Exception {
		send(Map.of("eventType", "DISMISS", "bookId", String.valueOf(bookId), "context", "RECOMMEND"));

		assertThat(onlyAction().get("event_type")).isEqualTo("DISMISS");
	}

	// ── 버리는 경우 (모두 202) ──

	@Test
	@DisplayName("같은 clientEventId 로 두 번 오면 한 건만 남는다 — StrictMode 이중 마운트 대비")
	void duplicateClientEventId_storedOnce() throws Exception {
		Map<String, Object> body = Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId),
			"clientEventId", "same-key");
		send(body);
		send(body);

		assertThat(countActions()).isEqualTo(1);
	}

	@Test
	@DisplayName("모르는 종류·필수 값 누락·없는 도서는 202 를 주고 저장하지 않는다")
	void invalidEvents_acceptedButDropped() throws Exception {
		send(Map.of("eventType", "SOMETHING_NEW", "bookId", String.valueOf(bookId)));   // 모르는 종류
		send(Map.of("eventType", "CLICK"));                                             // 책이 없다
		send(Map.of("eventType", "IMPRESSION"));                                        // 덱이 없다
		send(Map.of("eventType", "SEARCH"));                                            // 질의어가 없다
		send(Map.of("eventType", "REASON_VIEW", "bookId", String.valueOf(bookId)));      // 덱이 없다
		send(Map.of("eventType", "CLICK", "bookId", "999999999"));                      // 카탈로그에 없는 책

		assertThat(countActions()).isZero();
	}

	@Test
	@DisplayName("본문이 비어도 202 다 — 이벤트가 화면을 막지 않는다")
	void emptyBody_accepted() throws Exception {
		mvc.perform(post(EVENTS).header(HttpHeaders.AUTHORIZATION, bearer)
				.contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isAccepted());
		mvc.perform(post(EVENTS).header(HttpHeaders.AUTHORIZATION, bearer)
				.contentType(MediaType.APPLICATION_JSON).content(""))
			.andExpect(status().isAccepted());

		assertThat(countActions()).isZero();
	}

	// ── 정규화 ──

	@Test
	@DisplayName("앞선 클라이언트 시계는 서버 시각으로 바꾸고, 범위 밖 순위·위치는 비운다")
	void normalizesSkewAndOutOfRangeNumbers() throws Exception {
		Instant future = Instant.now().plus(2, ChronoUnit.HOURS);
		send(Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId), "occurredAt", future.toString(),
			"rank", 0, "position", 99_999));

		Map<String, Object> row = onlyAction();
		assertThat(((Timestamp)row.get("occurred_at")).toInstant())
			.isBefore(Instant.now().plus(6, ChronoUnit.MINUTES));
		assertThat(row.get("rank")).isNull();
		assertThat(row.get("display_position")).isNull();
	}

	@Test
	@DisplayName("컬럼 폭을 넘는 문자열은 잘라서라도 저장한다 — 한 건 때문에 실패시키지 않는다")
	void truncatesOverlongStrings() throws Exception {
		send(Map.of("eventType", "CLICK", "bookId", String.valueOf(bookId),
			"context", "A".repeat(50), "sessionId", "B".repeat(80), "clientEventId", "C".repeat(200)));

		Map<String, Object> row = onlyAction();
		assertThat((String)row.get("context")).hasSize(20);
		assertThat((String)row.get("session_id")).hasSize(36);
		assertThat((String)row.get("client_event_id")).hasSize(64);
	}

	@Test
	@DisplayName("토큰이 없으면 401 — 비회원 이벤트는 받지 않는다")
	void withoutToken_unauthorized() throws Exception {
		mvc.perform(post(EVENTS).contentType(MediaType.APPLICATION_JSON).content("{\"eventType\":\"CLICK\"}"))
			.andExpect(status().isUnauthorized());
	}

	// ── 도우미 ──

	private void send(Map<String, Object> body) throws Exception {
		mvc.perform(post(EVENTS).header(HttpHeaders.AUTHORIZATION, bearer)
				.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)))
			.andExpect(status().isAccepted());
	}

	private Map<String, Object> onlyAction() {
		List<Map<String, Object>> rows = jdbc.queryForList("select * from user_actions where user_id = ?", userId);
		assertThat(rows).hasSize(1);
		return rows.get(0);
	}

	private String payload(String key) {
		return jdbc.queryForObject("select payload->>'" + key + "' from user_actions where user_id = ?",
			String.class, userId);
	}

	private int countActions() {
		Integer count = jdbc.queryForObject("select count(*) from user_actions where user_id = ?", Integer.class, userId);
		return count == null ? 0 : count;
	}

	/** 덱 한 건. 이벤트가 public_id 로 찾아 붙일 대상이다. */
	private long insertDeck(String publicId) {
		return jdbc.queryForObject("""
			insert into recommendations (user_id, public_id, mode, fallback, based_on_count, weights, input_tags)
			values (?, ?, 'PERSONALIZED', false, 0, '{}'::jsonb, '[]'::jsonb) returning id""", Long.class,
			userId, publicId);
	}

	private Long insertBook(String isbn, String title) {
		return jdbc.queryForObject(
			"insert into books (isbn13, title, author) values (?, ?, '한강') returning id", Long.class, isbn, title);
	}

	private static String uniqueIsbn() {
		return "979" + String.format("%010d", System.nanoTime() % 10_000_000_000L);
	}
}
