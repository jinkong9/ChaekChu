package com.ssafy.b102.book.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * V1 book_loaned_top20 조회 — (period, gender, age_group, ranking) 슬롯당 책 1권, 세그먼트당 상위 100위.
 * 엔티티 없이 SQL 로 읽는다: 화면이 원하는 것은 항상 "books 와 조인된 순위 목록" 이고 갱신은 배치가 CSV 로 한다.
 */
@Repository
public class PopularBookRepository {

	/** 한 슬롯(세그먼트 안의 한 권) 또는 합산 결과 한 권. 합산 결과에서는 ageGroup·gender 가 null, ranking 은 가장 좋은 원 순위. */
	public record PopularRow(Long bookId, String isbn13, String title, String author, String publisher, Integer pubYear,
		String categoryCode, String coverUrl, Integer loanCount, Integer ranking, String ageGroup, String gender) {
	}

	private static final String BOOK_COLUMNS = """
		b.id AS book_id, b.isbn13, b.title, b.author, b.publisher, b.pub_year, b.category_code, b.cover_url""";

	private final JdbcClient jdbc;

	public PopularBookRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** 가장 최근 기준월('YYYYMM'). 표가 비어 있으면 empty. */
	public Optional<String> latestPeriod() {
		return jdbc.sql("select max(period) from book_loaned_top20").query(String.class).optional();
	}

	/** 세그먼트 하나의 순위 목록 (ranking 오름차순). 표지·분류가 없는 책은 뺀다(§9-9). */
	public List<PopularRow> findSegment(String period, String ageGroup, String gender, int limit) {
		return jdbc.sql("""
				select %s, t.loan_count, t.ranking, t.age_group, t.gender
				from book_loaned_top20 t join books b on b.id = t.book_id
				where t.period = :period and t.age_group = :age and t.gender = :gender
				  and b.cover_url is not null and b.category_code is not null
				order by t.ranking, b.id
				limit :limit""".formatted(BOOK_COLUMNS))
			.param("period", period).param("age", ageGroup).param("gender", gender).param("limit", limit)
			.query(this::mapRow).list();
	}

	/**
	 * 여러 세그먼트를 책 단위로 합산해 재정렬 — 프론트 mock 의 topAcross 와 같은 규칙.
	 * ageGroups 가 비어 있으면 기준월의 전 세그먼트. 정렬은 loan_count 합 내림차순 → 가장 좋은 원 순위 → id.
	 */
	public List<PopularRow> findAggregated(String period, List<String> ageGroups, int limit) {
		String ageFilter = ageGroups.isEmpty() ? "" : " and t.age_group in (:ages)";
		var spec = jdbc.sql("""
				select %s, sum(t.loan_count)::int AS loan_count, min(t.ranking)::int AS ranking, null AS age_group, null AS gender
				from book_loaned_top20 t join books b on b.id = t.book_id
				where t.period = :period%s
				  and b.cover_url is not null and b.category_code is not null
				group by b.id, b.isbn13, b.title, b.author, b.publisher, b.pub_year, b.category_code, b.cover_url
				order by sum(t.loan_count) desc nulls last, min(t.ranking), b.id
				limit :limit""".formatted(BOOK_COLUMNS, ageFilter))
			.param("period", period).param("limit", limit);
		if (!ageGroups.isEmpty()) {
			spec = spec.param("ages", ageGroups);
		}
		return spec.query(this::mapRow).list();
	}

	/** 기준월의 모든 세그먼트에서 상위 perSegment 위까지. (age_group, gender, ranking) 순. 홈 링 응답의 재료. */
	public List<PopularRow> findAllSegments(String period, int perSegment) {
		return jdbc.sql("""
				select %s, t.loan_count, t.ranking, t.age_group, t.gender
				from book_loaned_top20 t join books b on b.id = t.book_id
				where t.period = :period and t.ranking <= :perSegment
				  and b.cover_url is not null and b.category_code is not null
				order by t.age_group, t.gender, t.ranking, b.id""".formatted(BOOK_COLUMNS))
			.param("period", period).param("perSegment", perSegment)
			.query(this::mapRow).list();
	}

	private PopularRow mapRow(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
		return new PopularRow(
			rs.getLong("book_id"),
			rs.getString("isbn13"),
			rs.getString("title"),
			rs.getString("author"),
			rs.getString("publisher"),
			rs.getObject("pub_year") == null ? null : rs.getInt("pub_year"),
			rs.getString("category_code"),
			rs.getString("cover_url"),
			rs.getObject("loan_count") == null ? null : rs.getInt("loan_count"),
			rs.getObject("ranking") == null ? null : rs.getInt("ranking"),
			rs.getString("age_group"),
			rs.getString("gender"));
	}
}
