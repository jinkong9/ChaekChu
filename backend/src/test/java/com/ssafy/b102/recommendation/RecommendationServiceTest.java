package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.dto.PopularBooksResponse;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.book.service.PopularBookService;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiRecommendationClient;
import com.ssafy.b102.recommendation.config.RecommendationProperties;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest;
import com.ssafy.b102.recommendation.dto.AiRecommendationResponse;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.recommendation.service.RecommendationService;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

class RecommendationServiceTest {

	private static final Long USER_ID = 42L;
	private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-10T00:00:00Z"), ZoneOffset.UTC);

	@Test
	@DisplayName("사용자 관심 태그·서재를 AI 요청으로 만들고 ISBN 결과를 canonical 도서로 결합한다")
	void buildsAiRequestAndMapsBooks() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		Book seed = book("9788950906030", 1L, "기준 책");
		Book result = book("9788983920676", 2L, "추천 책");
		LibraryItem libraryItem = mock(LibraryItem.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		when(libraryItem.getBook()).thenReturn(seed);
		when(libraryItem.getStatus()).thenReturn(ShelfStatus.READ);
		when(libraryItem.getRating()).thenReturn((short)5);
		when(libraryItem.getUpdatedAt()).thenReturn(Instant.parse("2026-09-09T00:00:00Z"));
		when(library.findByUser_IdOrderByUpdatedAtDesc(USER_ID)).thenReturn(List.of(libraryItem));
		when(interests.findTagCodesByUserId(USER_ID)).thenReturn(List.of("FICTION"));
		when(books.findByIsbn13In(List.of("9788983920676"))).thenReturn(List.of(result));
		when(aiClient.recommend(any())).thenReturn(new AiRecommendationResponse(
			"rec-1", "req-1", "42", "gms-text-embedding-3-small", "index-1", false,
			List.of(new AiRecommendationResponse.Item("9788983920676", 1, 91.2,
				Map.of("semantic", 88.0), List.of("FIC"),
				new AiRecommendationResponse.Reason("TAG_MATCH", "선택한 태그와 일치하는 책이에요."), List.of()))));

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), CLOCK);

		RecommendationResponse response = service.recommend(USER_ID, 5, null);

		ArgumentCaptor<AiRecommendationRequest> captor = ArgumentCaptor.forClass(AiRecommendationRequest.class);
		verify(aiClient).recommend(captor.capture());
		AiRecommendationRequest request = captor.getValue();
		assertThat(request.userId()).isEqualTo("42");
		assertThat(request.mode()).isEqualTo("PERSONALIZED");
		assertThat(request.seedIsbns()).containsExactly("9788950906030");
		assertThat(request.excludeIsbns()).containsExactly("9788950906030");
		assertThat(request.tags()).extracting(AiRecommendationRequest.TagPreference::code).containsExactly("FIC");
		assertThat(response.items()).hasSize(1);
		assertThat(response.items().get(0).book().bookId()).isEqualTo("2");
		assertThat(response.items().get(0).reasonType()).isEqualTo("TAG_MATCH");
		assertThat(response.generatedAt()).isEqualTo(Instant.parse("2026-09-10T00:00:00Z"));
	}

	@Test
	@DisplayName("온보딩 전 사용자는 AI를 호출하지 않고 차단한다")
	void requiresOnboarding() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(false);
		when(userService.getUser(USER_ID)).thenReturn(user);

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), CLOCK);

		org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.recommend(USER_ID, 5, null))
			.isInstanceOf(com.ssafy.b102.global.error.BusinessException.class)
			.extracting("code").isEqualTo(com.ssafy.b102.global.error.ErrorCode.ONBOARDING_REQUIRED);
	}

	@Test
	@DisplayName("관심 태그와 행동 seed가 없으면 연령·성별 인기순위로 콜드스타트를 구성하고 AI를 호출하지 않는다")
	void coldStartUsesSegmentPopularity() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		when(user.getBirthYear()).thenReturn((short) 1991);
		when(user.getGender()).thenReturn(com.ssafy.b102.user.entity.Gender.F);
		when(library.findByUser_IdOrderByUpdatedAtDesc(USER_ID)).thenReturn(List.of());
		when(interests.findTagCodesByUserId(USER_ID)).thenReturn(List.of());
		BookSummaryResponse first = summary("9788900000001", "연령대 인기 책 1");
		BookSummaryResponse second = summary("9788900000002", "연령대 인기 책 2");
		when(popularBooks.popularFor(USER_ID, PopularBookService.MAX_SIZE)).thenReturn(
			new PopularBooksResponse(new PopularBooksResponse.SegmentInfo("30", "F", "30대 여성"), List.of(first, second)));

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), CLOCK);

		RecommendationResponse response = service.recommend(USER_ID, 5, null);

		org.mockito.Mockito.verifyNoInteractions(aiClient);
		assertThat(response.mode()).isEqualTo("COLD_START");
		assertThat(response.fallback()).isTrue();
		assertThat(response.items()).extracting(item -> item.book().isbn13())
			.containsExactly("9788900000001", "9788900000002");
		assertThat(response.items().get(0).reasonType()).isEqualTo("SEGMENT_POPULAR");
		assertThat(response.items().get(0).reasonText()).isEqualTo("30대 여성에서 많이 대출된 책이에요.");
	}

	private static BookSummaryResponse summary(String isbn, String title) {
		return new BookSummaryResponse("1", isbn, title, List.of("작가"), "출판사", 2020,
			"https://img.example/book.jpg", null, "문학", "813.7");
	}

	private static Book book(String isbn, Long id, String title) {
		Book book = mock(Book.class);
		when(book.getIsbn13()).thenReturn(isbn);
		when(book.getId()).thenReturn(id);
		when(book.getTitle()).thenReturn(title);
		when(book.getAuthor()).thenReturn("작가 지음");
		when(book.getPublisher()).thenReturn("출판사");
		when(book.getCategoryCode()).thenReturn("813.7");
		return book;
	}
}
