package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.book.service.KdcCategoryResolver;
import com.ssafy.b102.book.service.RandomBookService;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;

/** 서비스 규칙만 — 표본 → 전체 폴백 순서, exclude 기본값, 빈 모집단의 404. DB 없이 repository 를 mock 으로. */
class RandomBookServiceTest {

	private final BookRepository repository = mock(BookRepository.class);
	private final RandomBookService service = new RandomBookService(repository,
		new BookSummaryMapper(KdcCategoryResolver.fromLabels(Map.of("8", "문학", "81", "한국문학"))));

	@Test
	@DisplayName("exclude 없음 → -1 을 묶어 표본 → 전체 순서로 묻고, 둘 다 비면 404 BOOK_NOT_FOUND")
	void falls_back_then_404_when_empty() {
		when(repository.sampleRandomCandidateWithCover(-1L)).thenReturn(Optional.empty());
		when(repository.randomCandidateWithCover(-1L)).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.pick(null))
			.isInstanceOf(BusinessException.class)
			.extracting(e -> ((BusinessException) e).code()).isEqualTo(ErrorCode.BOOK_NOT_FOUND);

		InOrder inOrder = inOrder(repository);
		inOrder.verify(repository).sampleRandomCandidateWithCover(-1L);
		inOrder.verify(repository).randomCandidateWithCover(-1L);
	}

	@Test
	@DisplayName("표본에서 나오면 전체 쿼리는 부르지 않고 BookSummary 로 바꾼다 — bookId 문자열, classNo·coverUrl 그대로")
	void sample_hit_skips_fallback() {
		Book book = mock(Book.class);
		when(book.getId()).thenReturn(88123L);
		when(book.getIsbn13()).thenReturn("9788936434120");
		when(book.getTitle()).thenReturn("소년이 온다");
		when(book.getAuthor()).thenReturn("한강 지음");
		when(book.getCoverUrl()).thenReturn("https://img/1.jpg");
		when(book.getCategoryCode()).thenReturn("813.7");
		when(repository.sampleRandomCandidateWithCover(-1L)).thenReturn(Optional.of(book));

		BookSummaryResponse s = service.pick(null);

		assertThat(s.bookId()).isEqualTo("88123");
		assertThat(s.title()).isEqualTo("소년이 온다");
		assertThat(s.authors()).containsExactly("한강");
		assertThat(s.coverUrl()).isEqualTo("https://img/1.jpg");
		assertThat(s.classNo()).isEqualTo("813.7");
		assertThat(s.category()).isEqualTo("문학 > 한국문학");
		verify(repository, never()).randomCandidateWithCover(anyLong());
	}

	@Test
	@DisplayName("exclude 는 두 쿼리에 그대로 전달된다")
	void passes_exclude_to_both_queries() {
		when(repository.sampleRandomCandidateWithCover(88123L)).thenReturn(Optional.empty());
		when(repository.randomCandidateWithCover(88123L)).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.pick(88123L)).isInstanceOf(BusinessException.class);

		verify(repository).sampleRandomCandidateWithCover(88123L);
		verify(repository).randomCandidateWithCover(88123L);
	}
}
