package com.ssafy.b102.book.repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * 도서 상세가 읽는 V2 파생 표 — 수요 지표(book_demand_features)와 관계(book_relations).
 * 서지 본체는 JPA(BookRepository)로 읽고, 여기는 화면용 조인·집계만 SQL 로 한다.
 */
@Repository
public class BookDetailRepository {

	/** 한 책의 최신 스냅샷 수요 지표. 값은 없을 수 있다(컬럼별 채움률이 다르다). */
	public record DemandRow(String asOfMonth, Long loanCum, Integer loan3m, Integer holderLibs) {
	}

	/** 관계 한 줄 — 대상 책의 서지까지 함께 읽는다. */
	public record RelatedRow(Long bookId, String isbn13, String title, String author, String publisher,
		Integer pubYear, String categoryCode, String coverUrl, String vol, Integer rank, LocalDate collectedAt) {
	}

	private final JdbcClient jdbc;

	public BookDetailRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** 가장 최근 기준월의 수요 지표 한 줄. */
	public Optional<DemandRow> findLatestDemand(long bookId) {
		return jdbc.sql("""
				select as_of_month, loan_cum, loan_3m, holder_libs
				from book_demand_features
				where book_id = :bookId
				order by as_of_month desc
				limit 1""")
			.param("bookId", bookId)
			.query((rs, n) -> new DemandRow(
				rs.getString("as_of_month"),
				rs.getObject("loan_cum") == null ? null : rs.getLong("loan_cum"),
				rs.getObject("loan_3m") == null ? null : rs.getInt("loan_3m"),
				rs.getObject("holder_libs") == null ? null : rs.getInt("holder_libs")))
			.optional();
	}

	/**
	 * 관계 목록 — 카탈로그에 연결된 대상만(`target_book_id IS NOT NULL`). 함께대출 정답의 3~17% 는 카탈로그에 없어 빠진다.
	 * 인덱스 idx_br_src_type (source_book_id, relation_type, rank) 를 그대로 탄다.
	 */
	public List<RelatedRow> findRelated(long sourceBookId, String relationType, int limit) {
		return jdbc.sql("""
				select b.id, b.isbn13, b.title, b.author, b.publisher, b.pub_year, b.category_code, b.cover_url, b.vol,
				       r.rank, r.collected_at
				from book_relations r join books b on b.id = r.target_book_id
				where r.source_book_id = :bookId and r.relation_type = :type
				order by r.rank, b.id
				limit :limit""")
			.param("bookId", sourceBookId).param("type", relationType).param("limit", limit)
			.query((rs, n) -> new RelatedRow(
				rs.getLong("id"),
				rs.getString("isbn13"),
				rs.getString("title"),
				rs.getString("author"),
				rs.getString("publisher"),
				rs.getObject("pub_year") == null ? null : rs.getInt("pub_year"),
				rs.getString("category_code"),
				rs.getString("cover_url"),
				rs.getString("vol"),
				rs.getInt("rank"),
				rs.getObject("collected_at", LocalDate.class)))
			.list();
	}

	/** 기준월의 수요 행 수. 백분위 임계값 계산에 쓴다. */
	public long countDemand(String asOfMonth) {
		Long n = jdbc.sql("select count(*) from book_demand_features where as_of_month = :m")
			.param("m", asOfMonth).query(Long.class).single();
		return n == null ? 0 : n;
	}

	/**
	 * 기준월에서 loan_cum 내림차순 offset 번째 값 = 그 지점의 경계 대출 수.
	 * 인덱스 idx_bdf_month_cum (as_of_month, loan_cum DESC NULLS LAST) 를 순서대로 훑는다 — 25% 지점(약 69만)이 EC2 에서 0.7초.
	 */
	public Optional<Long> loanCumAtOffset(String asOfMonth, long offset) {
		return jdbc.sql("""
				select loan_cum from book_demand_features
				where as_of_month = :m and loan_cum is not null
				order by loan_cum desc
				offset :off limit 1""")
			.param("m", asOfMonth).param("off", offset)
			.query(Long.class).optional();
	}
}
