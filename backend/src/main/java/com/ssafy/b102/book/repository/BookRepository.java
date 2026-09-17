package com.ssafy.b102.book.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.ssafy.b102.book.entity.Book;

public interface BookRepository extends JpaRepository<Book, Long> {

	Optional<Book> findByIsbn13(String isbn13);

	List<Book> findByIsbn13In(Collection<String> isbns);

	/** 서지 없이 내부 id 만 필요할 때(이벤트 수집). 행 하나를 통째로 읽지 않는다. */
	@Query("select b.id from Book b where b.isbn13 = :isbn13")
	Optional<Long> findIdByIsbn13(String isbn13);

	/**
	 * 가챠 모집단(API_SPEC §4.8) — 추천 후보이고, 표지가 있고, KDC 가 있는 책. 두 쿼리가 같은 문장을 쓰도록 상수 하나로 묶는다(alias {@code b}).
	 * 표지: 가챠 화면이 표지를 300px 로 크게 띄운다. KDC(09-17 리뷰): 프론트가 classNo 로 DNA 레이더 축과 대조해 「정중앙/가장자리/새 영역」을
	 * 판정하므로 classNo 가 없으면 문구를 못 만든다 — 운영 후보 41만 중 23권이 그렇고, 빼도 모집단에 영향이 없다.
	 * is_candidate 는 배치가 채우는 컬럼(V5)이라 엔티티에 매핑하지 않았다 — 그래서 네이티브 쿼리다.
	 * {@code :exclude} 는 직전에 뽑힌 id. 없으면 {@code -1}(어떤 행과도 맞지 않는다) — null 을 묶으면 PG 가 파라미터 타입을 못 정한다.
	 */
	String GACHA_ELIGIBLE = "b.is_candidate and b.cover_url is not null and b.cover_url <> '' "
		+ "and b.category_code is not null and b.category_code <> '' and b.id <> :exclude";

	/**
	 * 가챠 1단계 — 모집단 중 무작위 한 권을 **페이지 표본** 안에서 고른다.
	 * TABLESAMPLE SYSTEM (0.5) 은 테이블 페이지의 0.5% 만 무작위로 읽는다(운영 331만 행이면 1.5만~2만 행). 그 안에 모집단 조건을 건 뒤
	 * random() 으로 하나 — 읽는 양이 전체의 0.5% 라 cold 여도 100ms 안이고, 운영 규모에서는 표본 안에 적격 행이 천 단위라 비지 않는다.
	 * 표본이 비면(행이 몇 개뿐인 로컬·테스트 DB) 호출자가 {@link #randomGachaBook} 으로 폴백한다.
	 * 모든 적격 책의 페이지가 같은 확률로 표본에 들고 표본 안에서 다시 균등하게 고르므로 책마다 거의 같은 확률이다.
	 */
	@Query(value = "select b.* from books b tablesample system (0.5) where " + GACHA_ELIGIBLE + " order by random() limit 1",
		nativeQuery = true)
	Optional<Book> sampleRandomGachaBook(long exclude);

	/**
	 * 가챠 2단계 폴백 — 표본 없이 전체에서. 후보 부분 인덱스(idx_books_candidate_id)를 타고 id 만 뽑아 정렬하므로
	 * description 같은 큰 컬럼이 정렬에 끼지 않고, 본문은 그 한 행만 읽는다. 운영에서는 거의 안 돌고 테스트·로컬에서 주로 돈다.
	 */
	@Query(value = "select o.* from books o where o.id = (select b.id from books b where " + GACHA_ELIGIBLE + " order by random() limit 1)",
		nativeQuery = true)
	Optional<Book> randomGachaBook(long exclude);

	// 검색 색인기는 여기를 쓰지 않는다 — books 와 book_demand_features.loan_cum 을 함께 읽어야 해서
	// 색인 전용 JdbcTemplate 리포지토리(search.repository.BookIndexRowRepository)로 옮겼다(매핑 v4).
}
