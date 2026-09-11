package com.ssafy.b102.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.elasticsearch.NoSuchIndexException;

import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.service.KdcCategoryResolver;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.search.document.BookDocument;
import com.ssafy.b102.search.dto.BookSearchResponse;
import com.ssafy.b102.search.repository.BookSearchRepository;
import com.ssafy.b102.search.repository.BookSearchResult;
import com.ssafy.b102.search.service.BookSearchService;

/** 서비스 규칙만 — ISBN 분기, BookSummary 조립, 장애 변환. ES 없이 repository 를 mock 으로. */
class BookSearchServiceTest {

	private final BookSearchRepository repository = mock(BookSearchRepository.class);
	private final BookSearchService service = new BookSearchService(repository,
		KdcCategoryResolver.fromLabels(Map.of("8", "문학", "81", "한국문학")));

	private static final BookDocument DOC = BookDocument.builder()
		.id(88123L).isbn13("9788936434120").title("소년이 온다").authors(List.of("한강")).authorRaw("한강 지음")
		.publisher("창비").pubYear(2014).categoryCode("813.7").coverUrl("https://img/1.jpg").updatedAt(Instant.EPOCH)
		.build();

	@Test
	@DisplayName("일반 검색어: repository.search 결과를 BookSummary 로 — bookId 문자열, category 2단계 경로, pageCount null")
	void maps_document_to_summary() {
		when(repository.search("소년이 온다", "", 0, 20)).thenReturn(new BookSearchResult(1, List.of(DOC)));

		BookSearchResponse res = service.search("  소년이 온다  ", null, 0, 20);

		assertThat(res.total()).isEqualTo(1);
		assertThat(res.page()).isZero();
		assertThat(res.size()).isEqualTo(20);
		BookSummaryResponse s = res.items().get(0);
		assertThat(s.bookId()).isEqualTo("88123");
		assertThat(s.isbn13()).isEqualTo("9788936434120");
		assertThat(s.title()).isEqualTo("소년이 온다");
		assertThat(s.authors()).containsExactly("한강");
		assertThat(s.publisher()).isEqualTo("창비");
		assertThat(s.publicationYear()).isEqualTo(2014);
		assertThat(s.coverUrl()).isEqualTo("https://img/1.jpg");
		assertThat(s.pageCount()).isNull();
		assertThat(s.category()).isEqualTo("문학 > 한국문학");
		assertThat(s.classNo()).isEqualTo("813.7");
	}

	@Test
	@DisplayName("하이픈 ISBN 은 하이픈을 떼고 isbn13 정확 조회 — 본문 검색은 부르지 않는다")
	void isbn_with_hyphens_goes_to_exact_lookup() {
		when(repository.findByIsbn13("9788936434120")).thenReturn(Optional.of(DOC));

		BookSearchResponse res = service.search("978-89-364-3412-0", null, 0, 20);

		assertThat(res.total()).isEqualTo(1);
		assertThat(res.items()).extracting(BookSummaryResponse::bookId).containsExactly("88123");
		verify(repository, never()).search(anyString(), anyString(), anyInt(), anyInt());
	}

	@Test
	@DisplayName("ISBN 이 카탈로그에 없으면 total 0 (온디맨드 등록은 아직 없다)")
	void isbn_not_found_is_empty() {
		when(repository.findByIsbn13("9791160941867")).thenReturn(Optional.empty());

		BookSearchResponse res = service.search("9791160941867", null, 0, 20);

		assertThat(res.total()).isZero();
		assertThat(res.items()).isEmpty();
	}

	@Test
	@DisplayName("ISBN 결과는 0페이지에만 — 1페이지는 total 1, items []")
	void isbn_result_only_on_first_page() {
		when(repository.findByIsbn13("9788936434120")).thenReturn(Optional.of(DOC));

		BookSearchResponse res = service.search("9788936434120", null, 1, 20);

		assertThat(res.total()).isEqualTo(1);
		assertThat(res.page()).isEqualTo(1);
		assertThat(res.items()).isEmpty();
	}

	@Test
	@DisplayName("13자리 숫자여도 978/979 로 시작하지 않으면 ISBN 이 아니라 일반 검색어")
	void thirteen_digits_without_prefix_is_text() {
		when(repository.search("1234567890123", "", 0, 20)).thenReturn(BookSearchResult.empty());

		service.search("1234567890123", null, 0, 20);

		verify(repository).search("1234567890123", "", 0, 20);
	}

	@Test
	@DisplayName("ES 접속 실패 → 503 SEARCH_UNAVAILABLE")
	void connection_failure_becomes_503() {
		when(repository.search(anyString(), anyString(), anyInt(), anyInt())).thenThrow(new DataAccessResourceFailureException("connection refused"));

		assertThatThrownBy(() -> service.search("한강", null, 0, 20))
			.isInstanceOf(BusinessException.class)
			.extracting(e -> ((BusinessException) e).code()).isEqualTo(ErrorCode.SEARCH_UNAVAILABLE);
	}

	@Test
	@DisplayName("인덱스가 없어도(기동 때 ES 다운) 503 — 500 으로 새지 않는다")
	void missing_index_becomes_503() {
		when(repository.findByIsbn13(anyString())).thenThrow(new NoSuchIndexException("books"));

		assertThatThrownBy(() -> service.search("9788936434120", null, 0, 20))
			.isInstanceOf(BusinessException.class)
			.extracting(e -> ((BusinessException) e).code()).isEqualTo(ErrorCode.SEARCH_UNAVAILABLE);
	}

	@Test
	@DisplayName("저자 배열이 null 인 문서도 authors: [] 로 나간다")
	void null_authors_become_empty_list() {
		BookDocument noAuthor = BookDocument.builder().id(1L).title("무명").authors(null).build();
		when(repository.search("무명", "", 0, 20)).thenReturn(new BookSearchResult(1, List.of(noAuthor)));

		BookSummaryResponse s = service.search("무명", null, 0, 20).items().get(0);

		assertThat(s.authors()).isEmpty();
		assertThat(s.category()).isNull();
		assertThat(s.classNo()).isNull();
	}

	// ── 분류 필터·탐색 한도 (v4) ──

	@Test
	@DisplayName("검색어 없이 분류만: 빈 q 로 넘겨 대출순 조회가 된다")
	void kdc_only_passes_empty_query() {
		when(repository.search("", "8", 0, 20)).thenReturn(new BookSearchResult(3, List.of(DOC)));

		BookSearchResponse res = service.search(null, "8", 0, 20);

		assertThat(res.total()).isEqualTo(3);
		verify(repository).search("", "8", 0, 20);
	}

	@Test
	@DisplayName("분류는 앞뒤 공백을 떼고 넘긴다")
	void kdc_is_trimmed() {
		when(repository.search("데미안", "853", 0, 20)).thenReturn(BookSearchResult.empty());

		service.search(" 데미안 ", " 853 ", 0, 20);

		verify(repository).search("데미안", "853", 0, 20);
	}

	@Test
	@DisplayName("q·kdc 둘 다 없으면 400 VALIDATION_FAILED — ES 를 부르지 않는다")
	void neither_query_nor_kdc_is_400() {
		assertThatThrownBy(() -> service.search("   ", null, 0, 20))
			.isInstanceOf(BusinessException.class)
			.satisfies(e -> {
				BusinessException be = (BusinessException) e;
				assertThat(be.code()).isEqualTo(ErrorCode.VALIDATION_FAILED);
				assertThat(fields(be)).extracting(f -> f.get("field")).containsExactly("q");
			});
		verify(repository, never()).search(anyString(), anyString(), anyInt(), anyInt());
	}

	@Test
	@DisplayName("분류가 1~3자리 숫자가 아니면 400 (8134 · 8a · 소설)")
	void malformed_kdc_is_400() {
		for (String bad : List.of("8134", "8a", "소설", "-1")) {
			assertThatThrownBy(() -> service.search("데미안", bad, 0, 20))
				.as("kdc=%s", bad)
				.isInstanceOf(BusinessException.class)
				.satisfies(e -> assertThat(fields((BusinessException) e)).extracting(f -> f.get("field")).contains("kdc"));
		}
	}

	@Test
	@DisplayName("탐색 한도 10,000건: size=20 이면 page 499 는 되고 500 은 400 — 허용 최대 페이지를 메시지에 담는다")
	void page_beyond_window_is_400() {
		when(repository.search("데미안", "", 499, 20)).thenReturn(BookSearchResult.empty());
		service.search("데미안", null, 499, 20);   // 499 × 20 + 20 = 10000 — 경계는 통과

		assertThatThrownBy(() -> service.search("데미안", null, 500, 20))
			.isInstanceOf(BusinessException.class)
			.satisfies(e -> {
				BusinessException be = (BusinessException) e;
				assertThat(be.code()).isEqualTo(ErrorCode.VALIDATION_FAILED);
				assertThat(fields(be)).singleElement()
					.satisfies(f -> {
						assertThat(f.get("field")).isEqualTo("page");
						assertThat(f.get("reason")).contains("0~499");
					});
			});
	}

	@Test
	@DisplayName("ISBN 조회는 탐색 한도·분류 검증을 타지 않는다 — 결과가 0~1건이라 ES 페이징도 필터도 안 쓴다")
	void isbn_lookup_skips_window_and_kdc_checks() {
		when(repository.findByIsbn13("9788936434120")).thenReturn(Optional.of(DOC));

		// page 500 은 본문 검색이면 400 이지만 ISBN 조회는 예전처럼 통과한다(0페이지가 아니라 items 는 빈 배열)
		assertThat(service.search("9788936434120", null, 500, 20).total()).isEqualTo(1);
		// 문서가 약속한 「ISBN 이면 kdc 무시」 — classNo 를 그대로 보내도 400 이 아니다
		assertThat(service.search("9788936434120", "813.62", 0, 20).items()).hasSize(1);
	}

	@Test
	@DisplayName("본문 검색에서는 classNo 를 그대로 보내면 400 — 앞자리만 받는다")
	void classNo_as_kdc_is_400_for_text_search() {
		assertThatThrownBy(() -> service.search("데미안", "813.62", 0, 20))
			.isInstanceOf(BusinessException.class)
			.satisfies(e -> assertThat(fields((BusinessException) e)).extracting(f -> f.get("field")).contains("kdc"));
	}

	@Test
	@DisplayName("details.fields 의 키 순서는 {field, reason} 으로 고정 — 다른 엔드포인트와 같은 모양")
	void field_entry_key_order_is_stable() {
		assertThatThrownBy(() -> service.search(null, null, 0, 20))
			.isInstanceOf(BusinessException.class)
			.satisfies(e -> assertThat(fields((BusinessException) e)).singleElement()
				.satisfies(f -> assertThat(f.keySet()).containsExactly("field", "reason")));
	}

	@Test
	@DisplayName("탐색 한도는 size 에 따라 달라진다 — size=50 이면 page 199 까지")
	void window_depends_on_size() {
		when(repository.search("데미안", "", 199, 50)).thenReturn(BookSearchResult.empty());
		service.search("데미안", null, 199, 50);

		assertThatThrownBy(() -> service.search("데미안", null, 200, 50))
			.isInstanceOf(BusinessException.class)
			.satisfies(e -> assertThat(fields((BusinessException) e)).singleElement()
				.satisfies(f -> assertThat(f.get("reason")).contains("0~199")));
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, String>> fields(BusinessException e) {
		return (List<Map<String, String>>) e.details().get("fields");
	}
}
