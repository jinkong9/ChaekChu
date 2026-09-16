package com.ssafy.b102.search;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.service.BookIndexService;

/**
 * 4단계 — GET /api/v1/books/search 계약(API_SPEC §4.1·§1.3·§1.4·§1.5). 실제 ES 에 문서 2건을 넣고 MockMvc 로 호출한다.
 * 검색은 사용자 행을 읽지 않으므로 토큰만 있으면 된다(users 행 불필요).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BookSearchApiTest {

	private static final String SEARCH = "/api/v1/books/search";
	private static final long BASE_ID = 9_200_000_000L;
	private static final String PUBLISHER = "옐로우북스테스트";   // 제목·저자와 토큰이 겹치지 않아야 두 문서가 동점 → id 순이 된다

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired ElasticsearchOperations operations;
	@Autowired BookIndexService indexService;
	@Autowired SearchProperties props;

	private String bearer;

	private final List<BookDocument> docs = List.of(
		BookDocument.builder().id(BASE_ID + 1).isbn13("9791200000018").title("바람의 노래를 들어라").authors(List.of("무라카미 하루키"))
			.authorRaw("무라카미 하루키 지음 ; 윤성원 옮김").publisher(PUBLISHER).pubYear(2006).categoryCode("833.6").coverUrl("https://img/x.jpg")
			.vol("3").updatedAt(Instant.parse("2026-01-01T00:00:00Z")).build(),
		BookDocument.builder().id(BASE_ID + 2).isbn13("9791200000025").title("감마 수학 입문").authors(List.of()).authorRaw(null)
			.publisher(PUBLISHER).pubYear(null).categoryCode(null).coverUrl(null)
			.updatedAt(Instant.parse("2026-01-01T00:00:00Z")).build()
	);

	@BeforeAll
	void setUp() {
		SearchTestSupport.ensureCurrentIndex(indexService, props);
		bearer = "Bearer " + jwt.issue(1L);
		operations.save(docs, IndexCoordinates.of(props.alias()));
		indexService.refresh(props.alias());
	}

	@AfterAll
	void tearDown() {
		for (BookDocument d : docs) {
			operations.delete(String.valueOf(d.getId()), IndexCoordinates.of(props.alias()));
		}
		indexService.refresh(props.alias());
	}

	@Test
	@DisplayName("200 — { total, page, size, items[BookSummary] }, bookId 는 문자열, authors 배열, category 대분류, pageCount null 키 존재")
	void search_shape() throws Exception {
		mvc.perform(get(SEARCH).param("q", "바람의 노래").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(1))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(20))
			.andExpect(jsonPath("$.items[0].bookId").value(String.valueOf(BASE_ID + 1)))
			.andExpect(jsonPath("$.items[0].isbn13").value("9791200000018"))
			.andExpect(jsonPath("$.items[0].title").value("바람의 노래를 들어라"))
			.andExpect(jsonPath("$.items[0].authors[0]").value("무라카미 하루키"))
			.andExpect(jsonPath("$.items[0].publisher").value(PUBLISHER))
			.andExpect(jsonPath("$.items[0].publicationYear").value(2006))
			.andExpect(jsonPath("$.items[0].coverUrl").value("https://img/x.jpg"))
			.andExpect(jsonPath("$.items[0].pageCount").value((Object) null))
			.andExpect(jsonPath("$.items[0].category").value(startsWith("문학")))   // kdc_codes 있으면 "문학 > 일본문학", 없으면(CI) 대분류 — BookDetailApiTest 와 같은 기준
			.andExpect(jsonPath("$.items[0].classNo").value("833.6"))
			.andExpect(jsonPath("$.items[0].volume").value("3"));          // 매핑 v6 — ES 문서의 vol 이 그대로 나간다
	}

	@Test
	@DisplayName("값이 없는 필드도 키는 남는다(null) — 프론트 타입 string | null 과 1:1")
	void nullable_fields_keep_keys() throws Exception {
		mvc.perform(get(SEARCH).param("q", "감마 수학 입문").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[0].bookId").value(String.valueOf(BASE_ID + 2)))
			.andExpect(jsonPath("$.items[0].authors").isArray())
			.andExpect(jsonPath("$.items[0].authors").isEmpty())
			.andExpect(jsonPath("$.items[0].publicationYear").value((Object) null))
			.andExpect(jsonPath("$.items[0].coverUrl").value((Object) null))
			.andExpect(jsonPath("$.items[0].category").value((Object) null))
			.andExpect(jsonPath("$.items[0].classNo").value((Object) null))
			.andExpect(jsonPath("$.items[0].volume").value((Object) null));
	}

	@Test
	@DisplayName("페이지: 출판사로 2건 → size 1, page 1 은 두 번째 문서, page 2 는 빈 배열에 total 유지")
	void pagination() throws Exception {
		mvc.perform(get(SEARCH).param("q", PUBLISHER).param("page", "1").param("size", "1").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(2))
			.andExpect(jsonPath("$.page").value(1))
			.andExpect(jsonPath("$.size").value(1))
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].bookId").value(String.valueOf(BASE_ID + 2)));

		mvc.perform(get(SEARCH).param("q", PUBLISHER).param("page", "2").param("size", "1").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(2))
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("ISBN(하이픈) → 정확 조회 1건. 없는 ISBN → total 0")
	void isbn_lookup() throws Exception {
		mvc.perform(get(SEARCH).param("q", "979-12-0000-001-8").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(1))
			.andExpect(jsonPath("$.items[0].isbn13").value("9791200000018"));

		mvc.perform(get(SEARCH).param("q", "9791200009999").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(0))
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("결과 없음은 200 에 total 0")
	void no_result_is_200() throws Exception {
		mvc.perform(get(SEARCH).param("q", "절대없는책제목zzz").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.total").value(0))
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	@DisplayName("토큰 없음 → 401 UNAUTHORIZED")
	void no_token_401() throws Exception {
		mvc.perform(get(SEARCH).param("q", "한강"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	@DisplayName("400 VALIDATION_FAILED — q 누락 · q 공백 · q 101자 · page -1 · size 0 · size 51. details.fields[].field 에 이름")
	void validation_failed() throws Exception {
		mvc.perform(get(SEARCH).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("q")));

		mvc.perform(get(SEARCH).param("q", "   ").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("q")));

		mvc.perform(get(SEARCH).param("q", "가".repeat(101)).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("q")));

		mvc.perform(get(SEARCH).param("q", "한강").param("page", "-1").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("page")));

		mvc.perform(get(SEARCH).param("q", "한강").param("size", "0").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("size")));

		mvc.perform(get(SEARCH).param("q", "한강").param("size", "51").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.details.fields[*].field").value(hasItem("size")));

		mvc.perform(get(SEARCH).param("q", "한강").param("size", "abc").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}
}
