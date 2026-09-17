package com.ssafy.b102.search.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
import com.ssafy.b102.search.repository.SearchScope;

/**
 * API_SPEC §4.1 — 도서 검색. 입력 정리 → ISBN 분기 → ES 조회 → BookSummary 조립.
 *
 * 검색어(q)와 분류(kdc) 중 하나는 있어야 한다. 둘 다 없으면 400 — 331만 권을 정렬해 내보내는 요청을 만들지 않는다.
 * 검색 범위(scope, 09-17): all(기본·생략 가능) · title · author · publisher. 대소문자·앞뒤 공백을 가리지 않는다. 넷 중 하나가 아니면 400.
 *   all 은 09-17 이전의 동작 그대로라 기존 호출은 바꿀 것이 없다. q 없이 kdc 만이면 점수를 내지 않아 쓰이지 않는다(값은 검증한다).
 * ISBN 분기: 하이픈·공백을 뗀 뒤 978/979 로 시작하는 13자리 숫자면 isbn13 정확 조회(0 또는 1건). 그 외는 본문 검색.
 *   결과가 한 권이라 kdc·scope 는 함께 와도 무시한다.
 *   L0 에 없는 ISBN 의 카카오 온디맨드 등록(서비스 방향 §7)은 아직 하지 않는다 — 빈 결과. 외부 호출·PG 쓰기가 얽혀 별도 작업으로 뺀다.
 * 탐색 한도: page·size 조합이 {@value #MAX_WINDOW}건을 넘으면 400. ES from+size 기본 상한이자 제품 결정(09-11) —
 *   깊은 페이지를 억지로 주지 않고 분류·검색어로 좁히게 유도한다. 그래서 search_after 커서는 두지 않는다.
 * 장애: ES 에 닿지 못하거나 인덱스가 없으면 503 SEARCH_UNAVAILABLE. 검색 장애가 다른 기능을 막지 않도록 PG 로 우회하지 않는다(#37 에서 재검토).
 */
@Service
public class BookSearchService {

	private static final Logger log = LoggerFactory.getLogger(BookSearchService.class);
	private static final Pattern ISBN_SEPARATORS = Pattern.compile("[-\\s]");
	private static final Pattern ISBN13 = Pattern.compile("^97[89]\\d{10}$");
	/** KDC 코드 prefix — 대분류 "8" · 중분류 "81" · 소분류 "813". books.category_code 는 "813.62" 처럼 소수점까지라 앞자리만 받는다. */
	private static final Pattern KDC_PREFIX = Pattern.compile("^\\d{1,3}$");
	/** ES from+size 상한 = 탐색 가능한 최대 건수. size=20 이면 page 0~499(화면 1~500쪽). */
	static final int MAX_WINDOW = 10_000;

	private final BookSearchRepository repository;
	private final KdcCategoryResolver kdc;

	public BookSearchService(BookSearchRepository repository, KdcCategoryResolver kdc) {
		this.repository = repository;
		this.kdc = kdc;
	}

	/**
	 * @param rawQ     검색어. 없거나 공백이면 분류만으로 조회한다(그때는 rawKdc 가 필수)
	 * @param rawKdc   KDC 코드 prefix 1~3자리. 없으면 분류 필터 없음
	 * @param rawScope 검색 범위 all · title · author · publisher. 없거나 공백이면 all
	 * @param page     0부터
	 * @param size     1~50
	 */
	public BookSearchResponse search(String rawQ, String rawKdc, String rawScope, int page, int size) {
		String q = rawQ == null ? "" : rawQ.trim();
		String kdcPrefix = rawKdc == null ? "" : rawKdc.trim();
		String scopeParam = rawScope == null ? "" : rawScope.trim();
		// 생략·공백은 ALL. 모르는 값은 null 로 두고 validate 가 400 으로 만든다
		SearchScope scope = scopeParam.isEmpty() ? SearchScope.ALL : SearchScope.fromParam(scopeParam).orElse(null);
		String isbn13 = asIsbn13(q);
		validate(q, kdcPrefix, scope, page, size, isbn13 != null);

		try {
			if (isbn13 != null) {
				Optional<BookDocument> found = repository.findByIsbn13(isbn13);
				List<BookSummaryResponse> items = found.map(d -> List.of(toSummary(d))).orElse(List.of());
				// 결과가 1건이라 0페이지에만 있다. 1페이지 이상은 total 만 같고 items 는 빈 배열
				return new BookSearchResponse(items.size(), page, size, page == 0 ? items : List.of());
			}
			BookSearchResult result = repository.search(q, kdcPrefix, scope, page, size);
			return new BookSearchResponse(result.total(), page, size, result.items().stream().map(this::toSummary).toList());
		} catch (DataAccessException e) {
			// 접속 실패·타임아웃·인덱스 없음(NoSuchIndexException) 전부. 프론트는 "잠시 후 다시" 안내
			log.warn("검색 실패 — Elasticsearch 에 닿지 못했습니다. q='{}' kdc='{}' scope={} page={} size={}: {}",
				q, kdcPrefix, scope, page, size, e.getMessage());
			throw new BusinessException(ErrorCode.SEARCH_UNAVAILABLE);
		}
	}

	/**
	 * 위반을 모아서 한 번에 400(fields[]) — 온보딩·서재와 같은 방식.
	 * ISBN 조회는 결과가 0~1건이라 ES 페이징도 분류 필터도 검색 범위도 타지 않는다. 그 세 규칙은 본문 검색일 때만 본다 —
	 * 그래야 문서가 약속한 「ISBN 이면 kdc·scope 를 무시한다」가 지켜지고, 예전처럼 어떤 page 로도 조회할 수 있다.
	 *
	 * @param scope 해석된 범위. null = 모르는 값이 왔다
	 */
	private static void validate(String q, String kdcPrefix, SearchScope scope, int page, int size, boolean isbnLookup) {
		List<Map<String, String>> fields = new ArrayList<>();
		if (q.isEmpty() && kdcPrefix.isEmpty()) {
			fields.add(field("q", "검색어 또는 분류(kdc) 중 하나는 필요합니다."));
		}
		if (!isbnLookup) {
			if (!kdcPrefix.isEmpty() && !KDC_PREFIX.matcher(kdcPrefix).matches()) {
				fields.add(field("kdc", "분류는 1~3자리 숫자입니다(예: 8 · 81 · 813). classNo(\"813.62\")를 그대로 보내지 말고 앞자리만 보내세요."));
			}
			if (scope == null) {
				fields.add(field("scope", "검색 범위는 " + SearchScope.allowedValues() + " 중 하나입니다. 생략하면 all(제목·저자·출판사)입니다."));
			}
			if ((long) page * size + size > MAX_WINDOW) {
				fields.add(field("page", "탐색 한도는 " + MAX_WINDOW + "건입니다. size=" + size
					+ " 이면 page 는 0~" + (MAX_WINDOW / size - 1) + " 까지입니다. 분류나 검색어로 결과를 좁혀 주세요."));
			}
		}
		if (!fields.isEmpty()) {
			throw new BusinessException(ErrorCode.VALIDATION_FAILED, Map.of("fields", fields));
		}
	}

	/** LinkedHashMap — 응답 JSON 의 키 순서를 {field, reason} 으로 고정한다(GlobalExceptionHandler 와 동일). */
	private static Map<String, String> field(String field, String reason) {
		Map<String, String> entry = new LinkedHashMap<>();
		entry.put("field", field);
		entry.put("reason", reason);
		return entry;
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
			d.getCategoryCode(),
			d.getVol());                                 // volume — 매핑 v6. v5 문서(재색인 전)는 필드가 없어 null 로 나간다
	}
}
