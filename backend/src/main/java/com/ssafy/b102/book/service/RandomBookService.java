package com.ssafy.b102.book.service;

import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;

/**
 * API_SPEC §4.8 — 가챠. 표지 있는 추천 후보(is_candidate) 중 무작위 한 권을 BookSummary 로 준다.
 *
 * 모집단이 후보 44만이 아니라 「표지 있는 후보」인 이유: 후보 제외 규칙 NO_SIGNAL 은 소개·표지·키워드·관계 중 하나만 있어도 통과시켜
 * 표지 없는 후보가 있고, 가챠 화면은 뽑은 책 표지를 300px 로 크게 띄우므로 표지가 없으면 회색 자리만 남는다.
 * 뽑기는 두 단계 — 페이지 표본(TABLESAMPLE 0.5%) 안에서 먼저, 비면 전체에서(BookRepository 주석). 운영은 1단계에서 끝난다.
 * exclude 는 프론트가 직전 bookId 를 넘길 때만 쓴다. 연속 호출에서 같은 책이 나올 확률은 모집단 역수(0.001% 안팎)라 서버는 이력을 저장하지 않는다 —
 * 그 확률까지 0 으로 막고 싶은 화면이 파라미터 하나로 해결하도록 열어 둔 것뿐이다.
 * 모집단이 비면 404 BOOK_NOT_FOUND — 운영에서는 나지 않고, 후보 배치를 안 돌린 로컬 DB 에서 난다.
 */
@Service
public class RandomBookService {

	/** exclude 가 없을 때 쿼리에 묶는 값. books.id 는 양수라 어떤 행과도 맞지 않는다. null 을 묶으면 PG 가 파라미터 타입을 못 정해 실패한다. */
	static final long NO_EXCLUDE = -1L;

	private final BookRepository books;
	private final BookSummaryMapper mapper;

	public RandomBookService(BookRepository books, BookSummaryMapper mapper) {
		this.books = books;
		this.mapper = mapper;
	}

	/** @param exclude 직전에 뽑힌 bookId. null 이면 제외 없음 */
	@Transactional(readOnly = true)
	public BookSummaryResponse pick(Long exclude) {
		long excludeId = exclude == null ? NO_EXCLUDE : exclude;
		Book book = books.sampleRandomCandidateWithCover(excludeId)
			.or(() -> books.randomCandidateWithCover(excludeId))
			.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND,
				Map.of("reason", "표지 있는 추천 후보가 없습니다. 후보 배치(is_candidate)가 돌았는지 확인하세요.")));
		return mapper.from(book);
	}
}
