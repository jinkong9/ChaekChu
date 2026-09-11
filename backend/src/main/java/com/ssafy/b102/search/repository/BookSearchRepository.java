package com.ssafy.b102.search.repository;

import java.util.Optional;

import com.ssafy.b102.search.document.BookDocument;

/**
 * 도서 검색 읽기 — ES alias 를 조회한다. 구현은 ElasticsearchBookSearchRepository.
 * 인터페이스를 둔 이유: 서비스 테스트에서 ES 없이 바꿔 끼우고, 점수식이 바뀌어도 서비스는 모르게.
 *
 * ES 에 닿지 못하면 Spring 의 DataAccessException 계열이 그대로 올라온다. 503 변환은 서비스가 한다.
 */
public interface BookSearchRepository {

	/**
	 * 제목·저자·출판사 검색 + KDC 분류 필터. 둘 중 하나는 있어야 한다(호출자가 막는다).
	 *
	 * 정렬은 검색어가 있느냐로 갈린다(09-11 확정):
	 *   q 있음 — 관련도(_score) 내림차순 → id 오름차순. kdc 는 점수에 영향 없는 filter 로만 걸린다.
	 *   q 없음 — loanCum(누적 대출) 내림차순, 값이 없는 책은 뒤 → id 오름차순.
	 *
	 * @param q         앞뒤 공백을 뗀 검색어. 비어 있으면 분류만으로 조회한다
	 * @param kdcPrefix KDC 코드 prefix("8" · "81" · "813"). 비어 있으면 필터 없음
	 * @param page      0부터
	 * @param size      1~50
	 */
	BookSearchResult search(String q, String kdcPrefix, int page, int size);

	/** 하이픈 없는 13자리. 없으면 empty. */
	Optional<BookDocument> findByIsbn13(String isbn13);
}
