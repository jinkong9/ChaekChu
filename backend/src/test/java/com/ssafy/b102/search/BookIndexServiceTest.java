package com.ssafy.b102.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.IndexOperations;
import org.springframework.data.elasticsearch.core.document.Document;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.service.BookIndexService;
import com.ssafy.b102.search.service.BookIndexService.IndexReport;
import com.ssafy.b102.search.service.IncompleteIndexException;

/**
 * 2단계 — PG books → ES bulk 색인, 증분 색인, 재색인 + alias 전환.
 * 실제 PostgreSQL + Elasticsearch. 색인기는 자기 트랜잭션으로 PG 를 읽으므로 테스트 데이터는 커밋해 넣고 끝에 지운다(@Transactional 롤백 불가).
 */
@SpringBootTest
@ActiveProfiles("test")
class BookIndexServiceTest {

	/** 색인기는 book_demand_features 의 MAX(as_of_month) 를 기준월로 잡는다. 운영 스냅샷과 같은 값을 써 그 경로를 그대로 태운다. */
	private static final String DEMAND_MONTH = "2026-08";

	@Autowired BookIndexService indexService;
	@Autowired ElasticsearchOperations operations;
	@Autowired SearchProperties props;
	@Autowired JdbcTemplate jdbc;

	private final List<Long> bookIds = new ArrayList<>();
	private String tempIndex;

	private Long oldBook;     // updated_at 2020 — 증분 색인 대상 아님
	private Long freshBook;   // updated_at now

	@BeforeEach
	void setUp() {
		SearchTestSupport.ensureCurrentIndex(indexService, props);
		oldBook = insertBook(uniqueIsbn(1), "소년이 온다", "한강 지음", "창비", 2014, "813.7", Instant.parse("2020-01-01T00:00:00Z"));
		insertBook(uniqueIsbn(2), "데미안", "헤르만 헤세 지음 ; 전영애 옮김", "민음사", 2000, "853", Instant.parse("2020-01-01T00:00:00Z"));
		freshBook = insertBook(uniqueIsbn(3), "구름빵", "글·그림 백희나", "한솔수북", 2004, null, Instant.now());
		insertDemand(freshBook, 4200L);   // 수요 지표가 있는 책. oldBook·데미안은 없다 → loanCum null
	}

	@AfterEach
	void tearDown() {
		IndexCoordinates alias = IndexCoordinates.of(props.alias());
		for (Long id : bookIds) {
			operations.delete(String.valueOf(id), alias);
		}
		indexService.refresh(props.alias());
		if (!bookIds.isEmpty()) {
			jdbc.update("delete from books where id in (" + String.join(",", bookIds.stream().map(String::valueOf).toList()) + ")");
		}
		if (tempIndex != null) {
			indexService.switchAlias(props.indexName());   // 원래 물리 인덱스로 되돌리고
			operations.indexOps(IndexCoordinates.of(tempIndex)).delete();
		}
	}

	@Test
	@DisplayName("indexAll: PG 행이 문서로 들어가고, 저자는 배열로 분해되며, 다시 돌려도 덮어쓴다(멱등)")
	void indexAll_maps_and_is_idempotent() {
		IndexReport first = indexService.indexAll();
		assertThat(first.failed()).isZero();
		assertThat(first.indexed()).isGreaterThanOrEqualTo(3);

		BookDocument d = get(freshBook);
		assertThat(d.getTitle()).isEqualTo("구름빵");
		assertThat(d.getAuthors()).containsExactly("백희나");
		assertThat(d.getAuthorRaw()).isEqualTo("글·그림 백희나");
		assertThat(d.getPublisher()).isEqualTo("한솔수북");
		assertThat(d.getPubYear()).isEqualTo(2004);
		assertThat(d.getCategoryCode()).isNull();
		assertThat(d.getUpdatedAt()).isNotNull();
		assertThat(d.getHasCover()).isFalse();                        // cover_url 없음(v3)
		assertThat(d.getLoanCum()).isEqualTo(4200L);                  // book_demand_features 를 LEFT JOIN 해 넣는다(v4)

		BookDocument demian = get(bookIds.get(1));
		assertThat(demian.getAuthors()).containsExactly("헤르만 헤세");   // 옮긴이 제외
		assertThat(demian.getCategoryCode()).isEqualTo("853");
		assertThat(demian.getLoanCum()).isNull();                     // 수요 지표가 없는 책은 null — 색인은 되고 정렬에서 뒤로 간다

		IndexReport second = indexService.indexAll();
		assertThat(second.indexed()).isEqualTo(first.indexed());
		assertThat(second.failed()).isZero();
		assertThat(get(freshBook).getTitle()).isEqualTo("구름빵");
	}

	@Test
	@DisplayName("catalog_layer 가 없는 책(L0 만)은 indexAll·증분·sourceCount 에서 빠지고, 추천 후보가 아니어도 L1(TAIL·제외 사유) 이면 색인된다 (V5)")
	void only_search_layer_is_indexed() {
		Long metaOnly = insertBook(uniqueIsbn(4), "어느 지역 향토지", "편찬위원회", "시청", 1998, "911", Instant.now(), false);
		jdbc.update("update books set catalog_layer = 'TAIL', is_candidate = false where id = ?", oldBook);                // L1 꼬리 — 검색만
		jdbc.update("update books set candidate_exclusion = 'STUDY_AID', is_candidate = false where id = ?", bookIds.get(1)); // 후보 제외 — 검색은 됨
		long searchable = jdbc.queryForObject("select count(*) from books where catalog_layer is not null", Long.class);

		IndexReport report = indexService.indexAll();
		assertThat(report.failed()).isZero();
		assertThat(indexService.sourceCount()).isEqualTo(searchable);                        // 완전성 검사 기준 = 검색 층 행수
		assertThat(get(freshBook)).isNotNull();
		assertThat(get(oldBook)).isNotNull();                                                // TAIL 도 색인
		assertThat(get(bookIds.get(1))).isNotNull();                                         // 후보 제외여도 색인
		assertThat(operations.get(String.valueOf(metaOnly), BookDocument.class, IndexCoordinates.of(props.alias()))).isNull();

		IndexReport incremental = indexService.indexUpdatedSince(Instant.now().minus(1, ChronoUnit.DAYS));
		assertThat(incremental.failed()).isZero();
		assertThat(operations.get(String.valueOf(metaOnly), BookDocument.class, IndexCoordinates.of(props.alias()))).isNull();
	}

	@Test
	@DisplayName("indexUpdatedSince: updated_at 이 기준 이후인 책만 색인한다")
	void indexUpdatedSince_only_recent_rows() {
		IndexReport report = indexService.indexUpdatedSince(Instant.now().minus(1, ChronoUnit.DAYS));
		assertThat(report.failed()).isZero();
		assertThat(report.indexed()).isGreaterThanOrEqualTo(1);

		assertThat(get(freshBook)).isNotNull();
		assertThat(operations.get(String.valueOf(oldBook), BookDocument.class, IndexCoordinates.of(props.alias()))).isNull();
	}

	@Test
	@DisplayName("reindexInto: 새 물리 인덱스를 채우고 alias 를 원자적으로 옮긴다. 옛 인덱스는 남는다")
	void reindexInto_switches_alias() {
		tempIndex = props.indexName() + "_reindex_" + System.nanoTime();

		IndexReport report = indexService.reindexInto(tempIndex);
		assertThat(report.index()).isEqualTo(tempIndex);
		assertThat(report.indexed()).isGreaterThanOrEqualTo(3);

		assertThat(indexService.aliasTargets()).containsExactly(tempIndex);
		assertThat(operations.indexOps(IndexCoordinates.of(props.indexName())).exists()).isTrue();   // 옛 인덱스 보존
		assertThat(get(freshBook).getTitle()).isEqualTo("구름빵");   // alias 로 읽으면 새 인덱스가 보인다

		// 되돌리기 — switchAlias 는 반대 방향도 같은 한 요청
		assertThat(indexService.switchAlias(props.indexName())).containsExactly(tempIndex);
		assertThat(indexService.aliasTargets()).containsExactly(props.indexName());
	}

	@Test
	@DisplayName("populateAndSwitch: 문서가 거부되면(매핑 불일치) alias 를 옮기지 않고 IncompleteIndexException — 새 인덱스는 조사용으로 남는다")
	void populateAndSwitch_refuses_partial_index() {
		tempIndex = props.indexName() + "_bad_" + System.nanoTime();
		// title 을 integer 로 잡은 인덱스 — 모든 문서가 mapper_parsing_exception 으로 거부된다
		IndexOperations bad = operations.indexOps(IndexCoordinates.of(tempIndex));
		bad.create();
		bad.putMapping(Document.parse("{\"properties\":{\"title\":{\"type\":\"integer\"}}}"));

		assertThatThrownBy(() -> indexService.populateAndSwitch(tempIndex))
			.isInstanceOf(IncompleteIndexException.class)
			.satisfies(e -> {
				IncompleteIndexException ie = (IncompleteIndexException) e;
				assertThat(ie.report().failed()).isGreaterThanOrEqualTo(3);
				assertThat(ie.actual()).isLessThan(ie.expected());
			});

		assertThat(indexService.aliasTargets()).containsExactly(props.indexName());          // alias 그대로
		assertThat(operations.indexOps(IndexCoordinates.of(tempIndex)).exists()).isTrue();   // 조사용으로 남음
	}

	// ── helpers ──

	private BookDocument get(Long id) {
		return operations.get(String.valueOf(id), BookDocument.class, IndexCoordinates.of(props.alias()));
	}

	/** 검색 층(catalog_layer CORE, 추천 후보 true)으로 넣는다 — V5 부터 색인기는 catalog_layer 가 있는 행만 읽는다. */
	private Long insertBook(String isbn13, String title, String author, String publisher, Integer pubYear, String kdc, Instant updatedAt) {
		return insertBook(isbn13, title, author, publisher, pubYear, kdc, updatedAt, true);
	}

	private Long insertBook(String isbn13, String title, String author, String publisher, Integer pubYear, String kdc, Instant updatedAt,
		boolean candidate) {
		Long id = jdbc.queryForObject(
			"insert into books(isbn13, title, author, publisher, pub_year, category_code, updated_at, catalog_layer, is_candidate) "
				+ "values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id",
			Long.class, isbn13, title, author, publisher, pubYear, kdc, java.sql.Timestamp.from(updatedAt),
			candidate ? "CORE" : null, candidate);
		bookIds.add(id);
		return id;
	}

	/** book_demand_features 한 행. books 를 지우면 fk_bdf_book ON DELETE CASCADE 로 함께 사라진다. */
	private void insertDemand(Long bookId, Long loanCum) {
		jdbc.update("insert into book_demand_features(book_id, as_of_month, loan_cum, feature_version) values (?, ?, ?, ?)",
			bookId, DEMAND_MONTH, loanCum, "test");
	}

	private static String uniqueIsbn(int n) {
		long tail = (System.nanoTime() / 10 + n) % 1_000_000_000L;   // 9자리, CHECK ^(978|979)[0-9]{10}$
		return "979" + n + String.format("%09d", tail);
	}
}
