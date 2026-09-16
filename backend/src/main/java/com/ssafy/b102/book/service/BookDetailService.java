package com.ssafy.b102.book.service;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookDetailResponse;
import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.CoLoanResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookDetailRepository;
import com.ssafy.b102.book.repository.BookDetailRepository.DemandRow;
import com.ssafy.b102.book.repository.BookDetailRepository.RelatedRow;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.repository.LibraryItemRepository;

/**
 * API_SPEC §4.4·§4.6 — 도서 상세와 함께 대출된 책.
 *
 * 식별자 규칙(§4.4): 경로가 13자리 978/979 숫자면 ISBN13, 아니면 내부 id. 홈 인기 링이 ISBN 으로 이동하고 나머지 화면은 내부 id 로 이동한다.
 * 응답의 bookId 는 어느 쪽으로 찾았든 내부 id 다.
 */
@Service
public class BookDetailService {

	public static final int CO_LOAN_DEFAULT_SIZE = 8;
	public static final int CO_LOAN_MAX_SIZE = 20;

	static final String SOURCE_D4L = "정보나루";
	static final String CO_LOAN_SOURCE = "DATA4LIBRARY";
	static final String RELATION_CO_LOAN = "CO_LOAN";

	private static final DateTimeFormatter YEAR_MONTH = DateTimeFormatter.ofPattern("yyyy-MM");

	private final BookRepository bookRepository;
	private final BookDetailRepository detailRepository;
	private final LibraryItemRepository libraryItemRepository;
	private final BookSummaryMapper summaryMapper;
	private final BookDemandRankResolver rankResolver;

	public BookDetailService(BookRepository bookRepository, BookDetailRepository detailRepository,
		LibraryItemRepository libraryItemRepository, BookSummaryMapper summaryMapper,
		BookDemandRankResolver rankResolver) {
		this.bookRepository = bookRepository;
		this.detailRepository = detailRepository;
		this.libraryItemRepository = libraryItemRepository;
		this.summaryMapper = summaryMapper;
		this.rankResolver = rankResolver;
	}

	@Transactional(readOnly = true)
	public BookDetailResponse detail(Long userId, String rawBookId) {
		Book book = find(rawBookId);
		DemandRow demand = detailRepository.findLatestDemand(book.getId()).orElse(null);
		var summary = summaryMapper.from(book);

		return new BookDetailResponse(
			summary.bookId(), summary.isbn13(), summary.title(), summary.authors(), summary.publisher(),
			summary.publicationYear(), summary.coverUrl(), summary.pageCount(), summary.category(), summary.classNo(),
			summary.volume(),
			null,                                   // subtitle — 원천 없음
			book.getDescription(),
			book.getDescriptionSource(),
			null,                                   // toc — 국중 회수분 미적재
			metricsOf(demand),
			null,                                   // loanByAge — loan_grps 미적재(수집률 0.7%)
			myRecordOf(userId, book.getId()));
	}

	@Transactional(readOnly = true)
	public CoLoanResponse coLoans(String rawBookId, int size) {
		Book book = find(rawBookId);
		List<RelatedRow> rows = detailRepository.findRelated(book.getId(), RELATION_CO_LOAN, size);
		List<CoLoanResponse.Item> items = rows.stream()
			.map(r -> new CoLoanResponse.Item(
				summaryMapper.of(r.bookId(), r.isbn13(), r.title(), r.author(), r.publisher(), r.pubYear(),
					r.categoryCode(), r.coverUrl(), r.vol()),
				r.rank()))
			.toList();
		String asOf = rows.stream()
			.map(RelatedRow::collectedAt).filter(java.util.Objects::nonNull).findFirst()
			.map(YEAR_MONTH::format).orElse(null);
		return new CoLoanResponse(items, CO_LOAN_SOURCE, asOf);
	}

	/** 13자리 ISBN 이면 isbn13 으로, 아니면 내부 id 로(BookIdentifiers). 어느 쪽도 아니거나 없으면 404 BOOK_NOT_FOUND. */
	private Book find(String rawBookId) {
		String id = BookIdentifiers.normalize(rawBookId);
		Long internalId = BookIdentifiers.isIsbn13(id) ? null : BookIdentifiers.asInternalId(id);
		Optional<Book> found = BookIdentifiers.isIsbn13(id)
			? bookRepository.findByIsbn13(id)
			: internalId == null ? Optional.empty() : bookRepository.findById(internalId);
		return found.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", id)));
	}

	/**
	 * 표시용 지표. 값이 없는 항목은 넣지 않는다 — 프론트가 배열을 그대로 그리고 빈 배열이면 섹션을 숨긴다.
	 * 채움률(EC2 09-10): loan_cum·holder_libs 100%, loan_3m 10.8%. trending_score 는 스냅샷이 하나뿐이라 아직 전부 NULL.
	 */
	private List<BookDetailResponse.Metric> metricsOf(DemandRow demand) {
		if (demand == null) {
			return List.of();
		}
		List<BookDetailResponse.Metric> metrics = new ArrayList<>(4);
		String asOf = demand.asOfMonth();

		String rank = rankResolver.topPercentLabel(asOf, demand.loanCum());
		if (rank != null) {
			metrics.add(new BookDetailResponse.Metric(SOURCE_D4L, "전국 대출 순위", rank, asOf));
		}
		if (demand.loanCum() != null) {
			metrics.add(new BookDetailResponse.Metric(SOURCE_D4L, "누적 대출", count(demand.loanCum(), "회"), asOf));
		}
		if (demand.loan3m() != null) {
			metrics.add(new BookDetailResponse.Metric(SOURCE_D4L, "최근 3개월 대출", count(demand.loan3m(), "회"), asOf));
		}
		if (demand.holderLibs() != null) {
			metrics.add(new BookDetailResponse.Metric(SOURCE_D4L, "소장 도서관", count(demand.holderLibs(), "개관"), asOf));
		}
		return List.copyOf(metrics);
	}

	/** 계약 §6.2 — 본인 기록만. 담지 않았으면 null 이라 프론트가 섹션을 숨긴다. */
	private BookDetailResponse.MyRecord myRecordOf(Long userId, Long bookId) {
		LibraryItem item = libraryItemRepository.findByUserIdAndBookId(userId, bookId).orElse(null);
		if (item == null) {
			return null;
		}
		return new BookDetailResponse.MyRecord(
			String.valueOf(item.getId()),
			item.getStatus().name(),
			item.getRating() == null ? null : item.getRating().intValue(),
			item.getReviewText(),
			item.getFinishedAt());
	}

	private static String count(Number value, String unit) {
		return String.format("%,d%s", value.longValue(), unit);
	}
}
