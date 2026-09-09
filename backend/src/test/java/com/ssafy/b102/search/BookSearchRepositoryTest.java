package com.ssafy.b102.search;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.repository.BookSearchRepository;
import com.ssafy.b102.search.repository.BookSearchResult;
import com.ssafy.b102.search.service.BookIndexService;

/**
 * 3단계 — 검색 쿼리. 문서를 ES 에 직접 넣고(PG 불필요) 순위·부분일치·페이지 경계·ISBN 조회를 본다.
 * 출판사 "지브라북스테스트" 는 이 테스트 문서에만 있어, 그것으로 검색하면 우리 문서 8건만 나온다(다른 테스트 잔여물과 무관하게 total 을 단언).
 */
@SpringBootTest
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BookSearchRepositoryTest {

	private static final long BASE_ID = 9_100_000_000L;   // 실제 books.id 와 겹치지 않는 범위
	private static final String PUBLISHER = "지브라북스테스트";

	@Autowired BookSearchRepository repository;
	@Autowired ElasticsearchOperations operations;
	@Autowired BookIndexService indexService;
	@Autowired SearchProperties props;

	private final List<BookDocument> docs = List.of(
		doc(1, "9791100000011", "어린 왕자", List.of("생텍쥐페리"), 2015),
		doc(2, "9791100000028", "어린 왕자 해설서", List.of("김해설"), 2018),
		doc(3, "9791100000035", "소년이 온다", List.of("한강"), 2014),
		doc(4, "9791100000042", "채식주의자", List.of("한강"), 2007),
		doc(5, "9791100000059", "데미안", List.of("헤르만 헤세"), 2000),
		doc(6, "9791100000066", "데미안 읽기", List.of("이독서"), 2021),
		doc(7, "9791100000073", "지구별 여행자", List.of("류시화"), 2002),
		doc(8, "9791100000080", "어린왕자", List.of("생텍쥐페리"), 1996)   // 붙여 쓴 판본 — 완전일치 그룹이 띄어쓰기에 갈리지 않아야 한다
	);

	@BeforeAll
	void indexFixtures() {
		SearchTestSupport.ensureCurrentIndex(indexService, props);
		operations.save(docs, alias());
		indexService.refresh(props.alias());
	}

	@AfterAll
	void cleanup() {
		for (BookDocument d : docs) {
			operations.delete(String.valueOf(d.getId()), alias());
		}
		indexService.refresh(props.alias());
	}

	@Test
	@DisplayName("완전일치 그룹('어린 왕자'·'어린왕자' 판본)이 맨 위(id 순), 해설서는 그 다음 — 검색어 띄어쓰기와 무관하게 같은 순서 (매핑 v2)")
	void exact_group_first_regardless_of_whitespace() {
		List<Long> spaced = ids(repository.search("어린 왕자", 0, 10));
		List<Long> compact = ids(repository.search("어린왕자", 0, 10));
		assertThat(spaced).startsWith(BASE_ID + 1, BASE_ID + 8, BASE_ID + 2);
		assertThat(compact).isEqualTo(spaced);
	}

	@Test
	@DisplayName("제목 일부 '왕자' 로도 찾는다 (형태소)")
	void partial_word_matches() {
		assertThat(ids(repository.search("왕자", 0, 10))).contains(BASE_ID + 1, BASE_ID + 2, BASE_ID + 8);
	}

	@Test
	@DisplayName("저자 이름으로 찾는다 — '한강' 두 권")
	void author_query() {
		assertThat(ids(repository.search("한강", 0, 10))).contains(BASE_ID + 3, BASE_ID + 4);
	}

	@Test
	@DisplayName("저자+제목이 섞인 '한강 소년' 은 cross_fields 로 「소년이 온다」가 1위")
	void author_plus_title_cross_fields() {
		assertThat(ids(repository.search("한강 소년", 0, 10))).startsWith(BASE_ID + 3);
	}

	@Test
	@DisplayName("완전일치 제목 '데미안' 이 '데미안 읽기' 보다 위")
	void exact_title_ranks_first() {
		assertThat(ids(repository.search("데미안", 0, 10))).startsWith(BASE_ID + 5, BASE_ID + 6);
	}

	@Test
	@DisplayName("사전에 없는 고유명사 조각 '텍쥐페' 도 bigram 으로 찾는다")
	void unknown_proper_noun_fragment_via_ngram() {
		assertThat(ids(repository.search("텍쥐페", 0, 10))).contains(BASE_ID + 1);
	}

	@Test
	@DisplayName("페이지: 출판사로 우리 문서 8건만 잡아 size 3 → 3·3·2, 겹침 없음, total 일정")
	void pagination_boundaries() {
		BookSearchResult p0 = repository.search(PUBLISHER, 0, 3);
		BookSearchResult p1 = repository.search(PUBLISHER, 1, 3);
		BookSearchResult p2 = repository.search(PUBLISHER, 2, 3);
		BookSearchResult p3 = repository.search(PUBLISHER, 3, 3);

		assertThat(p0.total()).isEqualTo(8);
		assertThat(p1.total()).isEqualTo(8);
		assertThat(p0.items()).hasSize(3);
		assertThat(p1.items()).hasSize(3);
		assertThat(p2.items()).hasSize(2);
		assertThat(p3.items()).isEmpty();
		assertThat(p3.total()).isEqualTo(8);

		List<Long> all = new java.util.ArrayList<>(ids(p0));
		all.addAll(ids(p1));
		all.addAll(ids(p2));
		assertThat(all).doesNotHaveDuplicates().hasSize(8);
	}

	@Test
	@DisplayName("동점(같은 출판사만 매치)은 id 오름차순으로 고정")
	void tie_break_by_id() {
		assertThat(ids(repository.search(PUBLISHER, 0, 10))).isSorted();
	}

	@Test
	@DisplayName("아무것도 안 맞으면 total 0, items 빈 배열")
	void no_match() {
		BookSearchResult r = repository.search("ㅋㅋㅋ존재하지않는책제목ㅋㅋㅋ", 0, 10);
		assertThat(r.total()).isZero();
		assertThat(r.items()).isEmpty();
	}

	@Test
	@DisplayName("ISBN 조회: 있으면 그 문서, 없으면 empty")
	void isbn_lookup() {
		assertThat(repository.findByIsbn13("9791100000035")).map(BookDocument::getTitle).hasValue("소년이 온다");
		assertThat(repository.findByIsbn13("9791100009999")).isEmpty();
	}

	// ── helpers ──

	private static BookDocument doc(int n, String isbn, String title, List<String> authors, int year) {
		return BookDocument.builder()
			.id(BASE_ID + n).isbn13(isbn).title(title).authors(authors).authorRaw(String.join(", ", authors) + " 지음")
			.publisher(PUBLISHER).pubYear(year).categoryCode("800").coverUrl(null).updatedAt(Instant.parse("2026-01-01T00:00:00Z"))
			.build();
	}

	private static List<Long> ids(BookSearchResult r) {
		return r.items().stream().map(BookDocument::getId).toList();
	}

	private IndexCoordinates alias() {
		return IndexCoordinates.of(props.alias());
	}
}
