package com.ssafy.b102.search.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * 색인기가 PG 를 읽는 곳. books 를 id 키셋으로 배치만큼 읽고 book_demand_features.loan_cum 을 LEFT JOIN 한다.
 *
 * JPA 가 아니라 JdbcTemplate 인 이유: 대출 지표는 books 엔티티에 없고, 색인 말고는 쓰는 곳이 없다.
 * 엔티티·리포지토리를 늘리지 않고 색인 전용 읽기 모델(BookIndexRow)로 끝낸다.
 *
 * JOIN 은 (book_id, as_of_month) PK 를 그대로 타므로 추가 인덱스가 없다. 기준월을 고정하면 1:1 이라 행이 늘지 않는다.
 * 스냅샷이 하나뿐이고 더 늘지 않는 전제(09-11 확인)라 월 배치·증분 갱신 경로는 두지 않는다 —
 * 나중에 스냅샷이 추가되면 전체 재색인으로 반영한다(색인 시작 때 latestDemandMonth 를 다시 읽는다).
 */
@Repository
public class BookIndexRowRepository {

	/**
	 * 배치 1,000건을 CTE 로 먼저 고정한 뒤 JOIN 한다. MATERIALIZED 가 핵심 —
	 * LIMIT 을 JOIN 뒤에 걸면 플래너가 바깥 행 수를 모른 채 Merge Join 을 골라 book_demand_features(274만 행) 앞부분을
	 * 배치마다 다시 훑는다. 운영 DB 실측: 그 형태는 lastId 50만에서 684ms, 200만에서 1,232ms 로 늘었고(배치 3,312회 → 한 시간 넘김),
	 * 이 형태는 중간 구간도 4~5ms 로 Nested Loop + PK 조회로 안정적이다. MATERIALIZED 를 빼면 인라인되어 옛 플랜으로 되돌아간다.
	 *
	 * 파라미터 순서: CTE 안의 조건(where) → LIMIT → 그 다음 JOIN 의 as_of_month.
	 */
	/**
	 * V5(09-15)부터 색인 대상은 books.catalog_layer 가 있는 행 = 기존 L1(누적 대출 72+ ∪ 신간, 약 105만 권)만이다.
	 * L0 만 구간 226만 권은 93% 가 소개·표지가 없어 검색 결과에 빈 카드로만 나왔다(09-14 전수조사). 행은 그대로 있으므로 ISBN·상세·찜은 영향 없다.
	 * 추천 후보(is_candidate, 약 44만)는 이보다 좁지만 검색은 L1 전체를 유지한다 — 사용자가 아는 책은 찾혀야 한다.
	 * 부분 인덱스 idx_books_searchable_id (id) WHERE catalog_layer IS NOT NULL 을 탄다. countBooks 도 같은 조건이어야 「ES 문서 수 == PG 행수」완전성 검사가 맞는다.
	 */
	private static final String SEARCH_LAYER_ONLY = "   where catalog_layer is not null\n";

	private static final String BATCH_HEAD = """
		with batch as materialized (
		  select id, isbn13, title, author, publisher, pub_year, category_code, cover_url, updated_at
		    from books
		""" + SEARCH_LAYER_ONLY;

	private static final String BATCH_TAIL = """
		   order by id
		   limit ?
		)
		select b.id, b.isbn13, b.title, b.author, b.publisher, b.pub_year, b.category_code, b.cover_url,
		       b.updated_at, d.loan_cum
		  from batch b
		  left join book_demand_features d on d.book_id = b.id and d.as_of_month = ?
		 order by b.id
		""";

	private static final RowMapper<BookIndexRow> ROW_MAPPER = BookIndexRowRepository::mapRow;

	private final JdbcTemplate jdbc;

	public BookIndexRowRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/**
	 * 가장 최근 수요 스냅샷 기준월('YYYY-MM'). 표가 비어 있으면 빈 문자열 — CHAR(7) 과 매칭되는 행이 없어 loanCum 이 전부 null 이 된다
	 * (LEFT JOIN 이라 책은 그대로 색인된다). null 을 파라미터로 넘기지 않으려고 빈 문자열을 쓴다.
	 */
	public String latestDemandMonth() {
		String month = jdbc.queryForObject("select max(as_of_month) from book_demand_features", String.class);
		return month == null ? "" : month.trim();
	}

	/** id > lastId 인 책을 id 순으로 limit 건. OFFSET 없는 키셋 페이징이라 뒤로 갈수록 느려지지 않는다. */
	public List<BookIndexRow> findAfterId(String demandMonth, long lastId, int limit) {
		return jdbc.query(BATCH_HEAD + "     and id > ?\n" + BATCH_TAIL, ROW_MAPPER, lastId, limit, demandMonth);
	}

	/** 위와 같고 updated_at 이 since 이후인 책만. 증분 색인용 — loanCum 도 함께 다시 넣는다(null 로 덮어쓰지 않게). */
	public List<BookIndexRow> findUpdatedAfterId(String demandMonth, Instant since, long lastId, int limit) {
		return jdbc.query(BATCH_HEAD + "     and updated_at > ? and id > ?\n" + BATCH_TAIL,
			ROW_MAPPER, Timestamp.from(since), lastId, limit, demandMonth);
	}

	/** 색인 완전성 검증용 — populateAndSwitch 가 ES 문서 수와 비교한다. 색인 대상(catalog_layer 있음)만 센다. */
	public long countBooks() throws DataAccessException {
		Long count = jdbc.queryForObject("select count(*) from books where catalog_layer is not null", Long.class);
		return count == null ? 0 : count;
	}

	/** nullable 숫자는 getObject 로 받는다 — getInt/getLong 은 null 을 0 으로 바꾸고, wasNull 은 직전 get 호출에만 걸려 순서에 엮인다. */
	private static BookIndexRow mapRow(ResultSet rs, int rowNum) throws SQLException {
		Timestamp updatedAt = rs.getTimestamp("updated_at");
		return new BookIndexRow(
			rs.getLong("id"),
			rs.getString("isbn13"),
			rs.getString("title"),
			rs.getString("author"),
			rs.getString("publisher"),
			rs.getObject("pub_year", Integer.class),
			rs.getString("category_code"),
			rs.getString("cover_url"),
			rs.getObject("loan_cum", Long.class),
			updatedAt == null ? null : updatedAt.toInstant());
	}
}
