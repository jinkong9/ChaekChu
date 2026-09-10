package com.ssafy.b102.search.service;

import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.service.KdcCategoryResolver;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.dto.BookSearchResponse;
import com.ssafy.b102.search.repository.BookSearchRepository;
import com.ssafy.b102.search.repository.BookSearchResult;

/**
 * API_SPEC §4.1 — 도서 검색. 입력 정리 → ISBN 분기 → ES 조회 → BookSummary 조립.
 *
 * ISBN 분기: 하이픈·공백을 뗀 뒤 978/979 로 시작하는 13자리 숫자면 isbn13 정확 조회(0 또는 1건). 그 외는 본문 검색.
 *   L0 에 없는 ISBN 의 카카오 온디맨드 등록(서비스 방향 §7)은 아직 하지 않는다 — 빈 결과. 외부 호출·PG 쓰기가 얽혀 별도 작업으로 뺀다.
 * 장애: ES 에 닿지 못하거나 인덱스가 없으면 503 SEARCH_UNAVAILABLE. 검색 장애가 다른 기능을 막지 않도록 PG 로 우회하지 않는다(#37 에서 재검토).
 */
@Service
public class BookSearchService {

	private static final Logger log = LoggerFactory.getLogger(BookSearchService.class);
	private static final Pattern ISBN_SEPARATORS = Pattern.compile("[-\\s]");
	private static final Pattern ISBN13 = Pattern.compile("^97[89]\\d{10}$");

	private final BookSearchRepository repository;
	private final KdcCategoryResolver kdc;

	public BookSearchService(BookSearchRepository repository, KdcCategoryResolver kdc) {
		this.repository = repository;
		this.kdc = kdc;
	}

	/**
	 * @param rawQ 컨트롤러가 @NotBlank·@Size(100) 로 걸러 준 검색어. 여기서 앞뒤 공백을 뗀다
	 * @param page 0부터
	 * @param size 1~50
	 */
	public BookSearchResponse search(String rawQ, int page, int size) {
		String q = rawQ.trim();
		try {
			String isbn13 = asIsbn13(q);
			if (isbn13 != null) {
				Optional<BookDocument> found = repository.findByIsbn13(isbn13);
				List<BookSummaryResponse> items = found.map(d -> List.of(toSummary(d))).orElse(List.of());
				// 결과가 1건이라 0페이지에만 있다. 1페이지 이상은 total 만 같고 items 는 빈 배열
				return new BookSearchResponse(items.size(), page, size, page == 0 ? items : List.of());
			}
			BookSearchResult result = repository.search(q, page, size);
			return new BookSearchResponse(result.total(), page, size, result.items().stream().map(this::toSummary).toList());
		} catch (DataAccessException e) {
			// 접속 실패·타임아웃·인덱스 없음(NoSuchIndexException) 전부. 프론트는 "잠시 후 다시" 안내
			log.warn("검색 실패 — Elasticsearch 에 닿지 못했습니다. q='{}' page={} size={}: {}", q, page, size, e.getMessage());
			throw new BusinessException(ErrorCode.SEARCH_UNAVAILABLE);
		}
	}

	/** 하이픈·공백을 뗀 13자리 ISBN. 아니면 null. */
	static String asIsbn13(String q) {
		String compact = ISBN_SEPARATORS.matcher(q).replaceAll("");
		return ISBN13.matcher(compact).matches() ? compact : null;
	}

	private BookSummaryResponse toSummary(BookDocument d) {
		return new BookSummaryResponse(
			String.valueOf(d.getId()),
			d.getIsbn13(),
			d.getTitle(),
			d.getAuthors() == null ? List.of() : d.getAuthors(),
			d.getPublisher(),
			d.getPubYear(),
			d.getCoverUrl(),
			null,                                        // pageCount — books 에 없음
			kdc.pathOf(d.getCategoryCode()),             // "문학 > 한국문학" (kdc_codes 2단계, 없으면 대분류 폴백)
			d.getCategoryCode());
	}
}
