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
	 * 제목·저자·출판사 검색. 점수 = 형태소 일치(cross_fields, 모든 단어 필요) + 부분일치(bigram phrase) + 제목 완전일치 가산.
	 * 정렬: _score 내림차순 → id 오름차순(동점 고정). 인기 지표는 V2 컬럼이 생기면 tie-break 로 들어간다.
	 *
	 * @param q    앞뒤 공백을 뗀 검색어. 빈 문자열은 호출자가 막는다
	 * @param page 0부터
	 * @param size 1~50
	 */
	BookSearchResult search(String q, int page, int size);

	/** 하이픈 없는 13자리. 없으면 empty. */
	Optional<BookDocument> findByIsbn13(String isbn13);
}
