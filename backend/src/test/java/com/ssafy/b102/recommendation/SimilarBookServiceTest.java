package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.SimilarBookResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.book.service.KdcCategoryResolver;
import com.ssafy.b102.recommendation.client.AiRecommendationClient;
import com.ssafy.b102.recommendation.service.SimilarBookService;

/**
 * ISBN13 이 없는 책에는 AI 를 부르지 않는다 — AI 계약이 seedIsbns 에 `^97[89]\d{10}$` 를 강제해 부르면 422 다.
 *
 * DB 로는 이 상황을 만들 수 없어 단위 테스트로 둔다: books.isbn13 이 CHAR(13) NOT NULL 이고
 * CHECK `^(978|979)[0-9]{10}$` 라 적재된 행은 모두 형식을 만족한다. 방어 코드가 실제로 동작하는지만 고정한다.
 */
class SimilarBookServiceTest {

	@Test
	@DisplayName("ISBN13 이 없으면 AI 를 부르지 않고 빈 배열을 준다")
	void skipsAiWhenSeedHasNoIsbn() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		BookRepository books = mock(BookRepository.class);
		Book seed = mock(Book.class);
		when(seed.getId()).thenReturn(7L);
		when(seed.getIsbn13()).thenReturn(null);
		when(books.findById(7L)).thenReturn(Optional.of(seed));

		SimilarBookService service = new SimilarBookService(aiClient, books,
			mock(com.ssafy.b102.book.repository.WorkSeriesRepository.class),
			new BookSummaryMapper(KdcCategoryResolver.fromLabels(java.util.Map.of())));

		SimilarBookResponse response = service.similar("7", 8);

		assertThat(response.items()).isEmpty();
		assertThat(response.modelVersion()).isNull();
		assertThat(response.indexVersion()).isNull();
		verify(aiClient, never()).recommend(any());
	}
}
