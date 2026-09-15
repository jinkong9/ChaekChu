package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiBookDnaClient;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.dto.BookDnaResponse;
import com.ssafy.b102.recommendation.service.BookDnaService;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

class BookDnaServiceTest {

	@Test
	void buildsAiSnapshotAndMapsCanonicalBooks() {
		Long userId = 8L;
		AiBookDnaClient aiClient = mock(AiBookDnaClient.class);
		UserService users = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookSummaryMapper mapper = mock(BookSummaryMapper.class);
		Book book = mock(Book.class);
		LibraryItem item = mock(LibraryItem.class);
		BookSummaryResponse summary = new BookSummaryResponse("1", "9780000000001", "테스트 책", List.of("작가"),
			"출판사", 2026, null, null, "문학", "813.7", null);
		when(library.findByUser_IdOrderByUpdatedAtDesc(userId)).thenReturn(List.of(item));
		when(item.getBook()).thenReturn(book);
		when(book.getIsbn13()).thenReturn("9780000000001");
		when(item.getStatus()).thenReturn(ShelfStatus.READ);
		when(item.getRating()).thenReturn((short)5);
		when(item.getFinishedAt()).thenReturn(LocalDate.of(2026, 9, 1));
		when(mapper.from(book)).thenReturn(summary);
		when(interests.findTagCodesByUserId(userId)).thenReturn(List.of("FICTION"));
		when(aiClient.profile(any())).thenReturn(new AiBookDnaResponse(
			"dna-req", "book-dna-v1", "embedding-v1", "index-v1", "tags-v1",
			new AiBookDnaResponse.Profile("READY", 1,
				List.of(new AiBookDnaResponse.Score("FICTION", "소설", 100)), List.of(), List.of(), null,
				new AiBookDnaResponse.Evidence(1, 1, List.of("FICTION"), List.of("FICTION"))), List.of()));

		BookDnaService service = new BookDnaService(aiClient, users, interests, library, mapper,
			Clock.fixed(Instant.parse("2026-09-15T00:00:00Z"), ZoneOffset.UTC));

		BookDnaResponse response = service.getMine(userId);

		ArgumentCaptor<AiBookDnaRequest> captor = ArgumentCaptor.forClass(AiBookDnaRequest.class);
		verify(aiClient).profile(captor.capture());
		assertThat(captor.getValue().userId()).isEqualTo("8");
		assertThat(captor.getValue().declaredTags()).containsExactly("FICTION");
		assertThat(captor.getValue().books()).singleElement().satisfies(seed -> {
			assertThat(seed.isbn13()).isEqualTo("9780000000001");
			assertThat(seed.status()).isEqualTo("READ");
			assertThat(seed.rating()).isEqualTo(5);
		});
		assertThat(response.readCount()).isEqualTo(1);
		assertThat(response.books()).singleElement().satisfies(dnaBook -> {
			assertThat(dnaBook.isbn13()).isEqualTo("9780000000001");
			assertThat(dnaBook.title()).isEqualTo("테스트 책");
		});
		assertThat(response.profile().status()).isEqualTo("READY");
	}
}
