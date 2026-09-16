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
 * 3단계 — 검색 쿼리. 문서를 ES 에 직접 넣고(PG 불필요) 순위·부분일치·페이지 경계·ISBN 조회·표지 가중(v3)·KDC 필터와 대출순(v4)·동점의 대출순(09-16)을 본다.
 * 출판사 "지브라북스테스트" 는 이 테스트 문서에만 있어, 그것으로 검색하면 우리 문서 9건만 나온다(다른 테스트 잔여물과 무관하게 total 을 단언).
 * 분류만으로 조회하는 테스트는 검색어가 없어 다른 클래스의 문서도 후보에 들어오므로, 결과에서 BASE_ID 이상만 골라 상대 순서를 본다.
 *
 * 표지: 6(데미안 읽기)·9(어린 왕자 2020)만 있다. 나머지는 hasCover=false 라 점수 × noCoverWeight(0.7).
 * 분류: 863.6 프랑스문학(1·2·8·9) · 813.7 한국문학(3·4) · 853.6 독일문학(5·6) · 818(7).
 */
@SpringBootTest
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BookSearchRepositoryTest {

	private static final long BASE_ID = 9_100_000_000L;   // 실제 books.id 와 겹치지 않는 범위
	private static final String PUBLISHER = "지브라북스테스트";
	private static final String COVER = "https://img.test/cover.jpg";

	@Autowired BookSearchRepository repository;
	@Autowired ElasticsearchOperations operations;
	@Autowired BookIndexService indexService;
	@Autowired SearchProperties props;

	private final List<BookDocument> docs = List.of(
		doc(1, "9791100000011", "어린 왕자", List.of("생텍쥐페리"), 2015, null, "863.6", 500L),
		doc(2, "9791100000028", "어린 왕자 해설서", List.of("김해설"), 2018, null, "863.6", 10L),
		doc(3, "9791100000035", "소년이 온다", List.of("한강"), 2014, null, "813.7", 300L),
		doc(4, "9791100000042", "채식주의자", List.of("한강"), 2007, null, "813.7", null),       // 수요 지표 없음 → 대출순에서 뒤
		doc(5, "9791100000059", "데미안", List.of("헤르만 헤세"), 2000, null, "853.6", 100L),
		doc(6, "9791100000066", "데미안 읽기", List.of("이독서"), 2021, COVER, "853.6", 5L),      // 표지 있음 — 그래도 완전일치 「데미안」 아래여야 한다
		doc(7, "9791100000073", "지구별 여행자", List.of("류시화"), 2002, null, "818", 100L),   // 5 와 대출이 같다 — 대출까지 같으면 id 순인지 본다
		doc(8, "9791100000080", "어린왕자", List.of("생텍쥐페리"), 1996, null, "863.6", 200L),    // 붙여 쓴 판본 — 완전일치 그룹이 띄어쓰기에 갈리지 않아야 한다
		doc(9, "9791100000097", "어린 왕자", List.of("생텍쥐페리"), 2020, COVER, "863.6", 1000L)  // 표지 있는 판본 — 같은 완전일치 그룹에서 맨 앞
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

	// ── 관련도 ──

	@Test
	@DisplayName("완전일치 그룹('어린 왕자'·'어린왕자' 판본)이 맨 위 — 표지 있는 9 가 먼저, 나머지는 대출순(1: 500 → 8: 200), 해설서는 그 다음. 검색어 띄어쓰기와 무관 (v3)")
	void exact_group_first_cover_first_regardless_of_whitespace() {
		List<Long> spaced = ids(repository.search("어린 왕자", null, 0, 10));
		List<Long> compact = ids(repository.search("어린왕자", null, 0, 10));
		assertThat(spaced).startsWith(BASE_ID + 9, BASE_ID + 1, BASE_ID + 8, BASE_ID + 2);
		assertThat(compact).isEqualTo(spaced);
	}

	@Test
	@DisplayName("표지 가중은 순서만 바꾸고 후보를 빼지 않는다 — 표지 없는 판본·해설서도 전부 나온다")
	void cover_weight_does_not_drop_candidates() {
		BookSearchResult r = repository.search("어린 왕자", null, 0, 10);
		assertThat(ids(r)).contains(BASE_ID + 1, BASE_ID + 8, BASE_ID + 9, BASE_ID + 2);
	}

	@Test
	@DisplayName("제목 일부 '왕자' 로도 찾는다 (형태소)")
	void partial_word_matches() {
		assertThat(ids(repository.search("왕자", null, 0, 10))).contains(BASE_ID + 1, BASE_ID + 2, BASE_ID + 8, BASE_ID + 9);
	}

	@Test
	@DisplayName("저자 이름으로 찾는다 — '한강' 두 권")
	void author_query() {
		assertThat(ids(repository.search("한강", null, 0, 10))).contains(BASE_ID + 3, BASE_ID + 4);
	}

	@Test
	@DisplayName("저자+제목이 섞인 '한강 소년' 은 cross_fields 로 「소년이 온다」가 1위")
	void author_plus_title_cross_fields() {
		assertThat(ids(repository.search("한강 소년", null, 0, 10))).startsWith(BASE_ID + 3);
	}

	@Test
	@DisplayName("완전일치 제목 '데미안'(표지 없음, ×0.7) 이 표지 있는 '데미안 읽기' 보다 여전히 위 — 표지 가중이 관련도 서열을 뒤집지 않는다")
	void exact_title_without_cover_still_beats_partial_with_cover() {
		assertThat(ids(repository.search("데미안", null, 0, 10))).startsWith(BASE_ID + 5, BASE_ID + 6);
	}

	@Test
	@DisplayName("사전에 없는 고유명사 조각 '텍쥐페' 도 bigram 으로 찾는다")
	void unknown_proper_noun_fragment_via_ngram() {
		assertThat(ids(repository.search("텍쥐페", null, 0, 10))).contains(BASE_ID + 1);
	}

	// ── KDC 필터 (v4) ──

	@Test
	@DisplayName("검색어 + 분류: 필터는 점수에 끼지 않아 순서가 그대로다. 863 은 프랑스문학 판본만, 813 은 0건")
	void kdc_filters_without_changing_order() {
		assertThat(ids(repository.search("어린 왕자", "863", 0, 10)))
			.containsExactly(BASE_ID + 9, BASE_ID + 1, BASE_ID + 8, BASE_ID + 2);
		assertThat(ids(repository.search("어린 왕자", "8", 0, 10)))
			.startsWith(BASE_ID + 9, BASE_ID + 1, BASE_ID + 8, BASE_ID + 2);   // 대분류는 다 통과

		BookSearchResult otherClass = repository.search("어린 왕자", "813", 0, 10);
		assertThat(otherClass.total()).isZero();
		assertThat(otherClass.items()).isEmpty();
	}

	@Test
	@DisplayName("분류 prefix 는 1~3자리 모두 — '85' 와 '853' 이 같은 독일문학 두 권")
	void kdc_prefix_depths() {
		assertThat(ids(repository.search("데미안", "85", 0, 10))).containsExactly(BASE_ID + 5, BASE_ID + 6);
		assertThat(ids(repository.search("데미안", "853", 0, 10))).containsExactly(BASE_ID + 5, BASE_ID + 6);
	}

	@Test
	@DisplayName("분류만(검색어 없음): 누적 대출 내림차순 — 863 은 1000·500·200·10 순")
	void kdc_only_sorts_by_loan_desc() {
		assertThat(ours(repository.search(null, "863", 0, 50)))
			.containsExactly(BASE_ID + 9, BASE_ID + 1, BASE_ID + 8, BASE_ID + 2);
	}

	@Test
	@DisplayName("분류만: 대출값이 없는 책은 마지막 — 813 은 300 인 3 다음에 null 인 4")
	void kdc_only_puts_missing_loan_last() {
		assertThat(ours(repository.search("", "813", 0, 50))).containsExactly(BASE_ID + 3, BASE_ID + 4);
	}

	// ── 페이지·동점·ISBN ──

	@Test
	@DisplayName("페이지: 출판사로 우리 문서 9건만 잡아 size 3 → 3·3·3, 겹침 없음, total 일정")
	void pagination_boundaries() {
		BookSearchResult p0 = repository.search(PUBLISHER, null, 0, 3);
		BookSearchResult p1 = repository.search(PUBLISHER, null, 1, 3);
		BookSearchResult p2 = repository.search(PUBLISHER, null, 2, 3);
		BookSearchResult p3 = repository.search(PUBLISHER, null, 3, 3);

		assertThat(p0.total()).isEqualTo(9);
		assertThat(p1.total()).isEqualTo(9);
		assertThat(p0.items()).hasSize(3);
		assertThat(p1.items()).hasSize(3);
		assertThat(p2.items()).hasSize(3);
		assertThat(p3.items()).isEmpty();
		assertThat(p3.total()).isEqualTo(9);

		List<Long> all = new java.util.ArrayList<>(ids(p0));
		all.addAll(ids(p1));
		all.addAll(ids(p2));
		assertThat(all).doesNotHaveDuplicates().hasSize(9);
	}

	@Test
	@DisplayName("동점(같은 출판사만 매치): 표지 있는 9·6 이 먼저(대출 1000 → 5), 표지 없는 나머지는 대출 내림차순 500·300·200·100·100·10, 대출까지 같은 5·7 은 id 순, 대출 없는 4 는 마지막 (09-16)")
	void tie_break_cover_then_loan_then_id() {
		assertThat(ids(repository.search(PUBLISHER, null, 0, 10))).containsExactly(
			BASE_ID + 9, BASE_ID + 6,
			BASE_ID + 1, BASE_ID + 3, BASE_ID + 8, BASE_ID + 5, BASE_ID + 7, BASE_ID + 2, BASE_ID + 4);
	}

	@Test
	@DisplayName("아무것도 안 맞으면 total 0, items 빈 배열")
	void no_match() {
		BookSearchResult r = repository.search("ㅋㅋㅋ존재하지않는책제목ㅋㅋㅋ", null, 0, 10);
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

	/** coverUrl 이 있으면 hasCover=true — BookDocumentMapper 와 같은 규칙. */
	private static BookDocument doc(int n, String isbn, String title, List<String> authors, int year,
		String coverUrl, String categoryCode, Long loanCum) {
		return BookDocument.builder()
			.id(BASE_ID + n).isbn13(isbn).title(title).authors(authors).authorRaw(String.join(", ", authors) + " 지음")
			.publisher(PUBLISHER).pubYear(year).categoryCode(categoryCode).coverUrl(coverUrl).hasCover(coverUrl != null)
			.loanCum(loanCum).updatedAt(Instant.parse("2026-01-01T00:00:00Z"))
			.build();
	}

	private static List<Long> ids(BookSearchResult r) {
		return r.items().stream().map(BookDocument::getId).toList();
	}

	/** 검색어 없는 조회는 다른 테스트 클래스의 문서도 후보에 든다. 우리 픽스처만 골라 상대 순서를 본다. */
	private static List<Long> ours(BookSearchResult r) {
		return r.items().stream().map(BookDocument::getId).filter(id -> id >= BASE_ID).toList();
	}

	private IndexCoordinates alias() {
		return IndexCoordinates.of(props.alias());
	}
}
