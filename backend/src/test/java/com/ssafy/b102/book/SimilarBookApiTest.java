package com.ssafy.b102.book;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.recommendation.client.AiRecommendationClient;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest;
import com.ssafy.b102.recommendation.dto.AiRecommendationResponse;
import com.ssafy.b102.recommendation.service.SimilarBookService;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §4.5 GET /books/{bookId}/similar — 비슷한 책.
 *
 * AI 호출은 목으로 막는다. 여기서 지킬 것은 AI 의 추천 품질이 아니라 <b>백엔드가 AI 응답을 어떻게 해석하는가</b>다 —
 * 폴백을 버리는가, ISBN 없는 책에 아예 요청을 안 보내는가, 순서를 지키는가, 카탈로그에 없는 ISBN 을 빼는가.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SimilarBookApiTest {

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;
	@MockitoBean AiRecommendationClient aiClient;

	private String bearer;
	private Long seedId;
	private String seedIsbn;

	@BeforeEach
	void setUp() {
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "similar-" + System.nanoTime()));
		bearer = "Bearer " + jwt.issue(user.getId());
		seedIsbn = uniqueIsbn();
		seedId = insertBook(seedIsbn, "슬로 리딩", "하시모토 다케시 지음");
	}

	@Test
	@DisplayName("AI 가 준 순서대로 서지를 붙여 내보낸다 — 이유·점수·버전도 함께")
	void similar_mapsInAiOrder() throws Exception {
		String first = uniqueIsbn();
		String second = uniqueIsbn();
		insertBook(second, "두 번째 이웃", "저자 나");     // 일부러 뒤집어 넣는다 — DB 순서가 아니라 AI 순서를 따라야 한다
		insertBook(first, "첫 번째 이웃", "저자 가");
		when(aiClient.recommend(any())).thenReturn(response(false, item(first, 57.8), item(second, 49.7)));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[0].book.isbn13").value(first))
			.andExpect(jsonPath("$.items[0].book.title").value("첫 번째 이웃"))
			.andExpect(jsonPath("$.items[0].score").value(57.8))
			.andExpect(jsonPath("$.items[0].reason").value("관심 도서와 서지·분류 특성이 비슷한 책이에요."))
			.andExpect(jsonPath("$.items[1].book.isbn13").value(second))
			.andExpect(jsonPath("$.modelVersion").value("test-model"))
			.andExpect(jsonPath("$.indexVersion").value("test-index"));
	}

	@Test
	@DisplayName("기준 책 한 권만 seed 로, 태그 없이, 의미 유사도만으로 요청한다")
	void similar_sendsSeedOnlyRequest() throws Exception {
		when(aiClient.recommend(any())).thenReturn(response(false));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar?size=4").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk());

		ArgumentCaptor<AiRecommendationRequest> captor = ArgumentCaptor.forClass(AiRecommendationRequest.class);
		verify(aiClient).recommend(captor.capture());
		AiRecommendationRequest sent = captor.getValue();
		org.assertj.core.api.Assertions.assertThat(sent.seedIsbns()).containsExactly(seedIsbn);
		org.assertj.core.api.Assertions.assertThat(sent.tags()).isEmpty();
		org.assertj.core.api.Assertions.assertThat(sent.size()).isEqualTo(8);   // 같은 작품을 접으니 넉넉히 받는다
		org.assertj.core.api.Assertions.assertThat(sent.weights().semantic()).isEqualTo(1.0);
		org.assertj.core.api.Assertions.assertThat(sent.weights().trending()).isZero();
		org.assertj.core.api.Assertions.assertThat(sent.weights().steady()).isZero();
	}

	// ── 빈 배열로 끊어야 하는 경우 ──

	@Test
	@DisplayName("폴백된 결과는 버린다 — 「비슷한 책」 자리에 무관한 인기 도서가 뜨면 안 된다")
	void similar_dropsFallbackResult() throws Exception {
		String popular = uniqueIsbn();
		insertBook(popular, "많이 빌린 책", "저자 다");
		when(aiClient.recommend(any())).thenReturn(response(true, item(popular, 88.0)));   // fallback=true

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.modelVersion").doesNotExist())
			.andExpect(jsonPath("$.indexVersion").doesNotExist());
	}

	@Test
	@DisplayName("이웃이 카탈로그에 없으면 그 항목만 빠지고, 전부 없으면 빈 배열이 된다")
	void similar_skipsUnknownIsbns() throws Exception {
		String known = uniqueIsbn();
		insertBook(known, "아는 이웃", "저자 라");
		when(aiClient.recommend(any())).thenReturn(response(false, item("9799999999999", 60.0), item(known, 50.0)));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].book.isbn13").value(known));

		when(aiClient.recommend(any())).thenReturn(response(false, item("9799999999998", 60.0)));
		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("기준 책의 다른 판본은 뺀다 — 실제 사례: 긴긴밤(9788954677158)의 이웃에 같은 긴긴밤이 올라왔다")
	void similar_dropsOtherEditionOfSeed() throws Exception {
		String otherEdition = uniqueIsbn();
		String different = uniqueIsbn();
		insertBook(otherEdition, "긴긴밤", "루리");           // seed 와 같은 작품, 다른 ISBN
		insertBook(different, "달 내리는 밤", "이순원");
		jdbc.update("update books set title = '긴긴밤', author = '루리' where id = ?", seedId);
		when(aiClient.recommend(any()))
			.thenReturn(response(false, item(otherEdition, 92.0), item(different, 50.0)));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].book.isbn13").value(different));
	}

	@Test
	@DisplayName("같은 시리즈의 다른 권은 살린다 — 셜록 홈즈 7권이 한 권으로 뭉개지던 문제")
	void similar_keepsOtherVolumesOfSameSeries() throws Exception {
		String set = "9788949124209";
		String v2 = uniqueIsbn();
		String v3 = uniqueIsbn();
		insertVolume(v2, "셜록 홈즈", "아서 코난 도일", "2", set);
		insertVolume(v3, "셜록 홈즈", "아서 코난 도일", "3", set);
		jdbc.update("update books set title='셜록 홈즈', author='아서 코난 도일', vol='1', set_isbn=? where id=?", set, seedId);
		when(aiClient.recommend(any())).thenReturn(response(false, item(v2, 90.0), item(v3, 88.0)));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[0].book.volume").value("2"))
			.andExpect(jsonPath("$.items[1].book.volume").value("3"));
	}

	@Test
	@DisplayName("이웃끼리 같은 작품이면 첫 권만 남긴다 — 출판사·부제·병기 제목이 달라도 같은 작품이다")
	void similar_keepsOneEditionPerWork() throws Exception {
		String munhak = uniqueIsbn();
		String other = uniqueIsbn();
		String third = uniqueIsbn();
		insertBook(munhak, "작별하지 않는다", "한강 지음");
		insertBook(other, "(2024년 개정판)작별하지 않는다=We do not part", "한강 지음 ;김유경 옮김");
		insertBook(third, "소년이 온다", "한강");
		when(aiClient.recommend(any()))
			.thenReturn(response(false, item(munhak, 90.0), item(other, 88.0), item(third, 70.0)));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[0].book.isbn13").value(munhak))
			.andExpect(jsonPath("$.items[1].book.isbn13").value(third));
	}

	@Test
	@DisplayName("접고 나서도 size 를 채우려 AI 에는 넉넉히(size×2, 상한 10) 요청한다")
	void similar_overfetchesForDedup() throws Exception {
		when(aiClient.recommend(any())).thenReturn(response(false));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar?size=4").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk());
		mvc.perform(get("/api/v1/books/" + seedId + "/similar?size=8").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk());

		ArgumentCaptor<AiRecommendationRequest> captor = ArgumentCaptor.forClass(AiRecommendationRequest.class);
		verify(aiClient, org.mockito.Mockito.times(2)).recommend(captor.capture());
		org.assertj.core.api.Assertions.assertThat(captor.getAllValues())
			.extracting(AiRecommendationRequest::size)
			.containsExactly(8, SimilarBookService.MAX_SIZE);   // 8 → 8, 16 → 10 으로 잘린다
	}

	@Test
	@DisplayName("AI 가 이웃을 못 찾아도 200 에 빈 배열이다")
	void similar_emptyWhenNoNeighbour() throws Exception {
		when(aiClient.recommend(any())).thenReturn(response(false));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty());
	}

	// ── 오류 ──

	@Test
	@DisplayName("ISBN13 으로도 찾고, 없는 책은 404 · size 범위 밖은 400 · 토큰 없으면 401")
	void similar_errors() throws Exception {
		when(aiClient.recommend(any())).thenReturn(response(false));

		mvc.perform(get("/api/v1/books/" + seedIsbn + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk());
		mvc.perform(get("/api/v1/books/999999999/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"));
		mvc.perform(get("/api/v1/books/" + seedId + "/similar?size=11").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		mvc.perform(get("/api/v1/books/" + seedId + "/similar"))
			.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("AI 가 죽어 있으면 503 — 상세 화면의 다른 영역은 그대로다")
	void similar_aiDown() throws Exception {
		when(aiClient.recommend(any())).thenThrow(new BusinessException(ErrorCode.RECOMMENDATION_UNAVAILABLE));

		mvc.perform(get("/api/v1/books/" + seedId + "/similar").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.code").value("RECOMMENDATION_UNAVAILABLE"));
	}

	// ── 도우미 ──

	private static AiRecommendationResponse response(boolean fallback, AiRecommendationResponse.Item... items) {
		return new AiRecommendationResponse("rec_test", "req_test", "0", "test-model", "test-index",
			fallback, List.of(items));
	}

	private static AiRecommendationResponse.Item item(String isbn13, double score) {
		return new AiRecommendationResponse.Item(isbn13, null, score, Map.of(), List.of(),
			new AiRecommendationResponse.Reason("SEMANTIC", "관심 도서와 서지·분류 특성이 비슷한 책이에요."), List.of());
	}

	private void insertVolume(String isbn13, String title, String author, String vol, String setIsbn) {
		jdbc.update("insert into books(isbn13, title, author, vol, set_isbn) values (?, ?, ?, ?, ?)",
			isbn13, title, author, vol, setIsbn);
	}

	private Long insertBook(String isbn13, String title, String author) {
		return jdbc.queryForObject("insert into books(isbn13, title, author) values (?, ?, ?) returning id",
			Long.class, isbn13, title, author);
	}

	private static final java.util.concurrent.atomic.AtomicInteger SEQ = new java.util.concurrent.atomic.AtomicInteger();

	/** 실행 안에서 겹치지 않는 13자리. CHECK: ^(978|979)[0-9]{10}$ */
	private static String uniqueIsbn() {
		long tail = Math.floorMod(System.nanoTime() / 1000 + SEQ.incrementAndGet(), 10_000_000_000L);
		return "978" + String.format("%010d", tail);
	}
}
