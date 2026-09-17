package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

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
import com.ssafy.b102.recommendation.dto.NextRecommendationRequest;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.recommendation.service.RecommendationService;
import com.ssafy.b102.recommendation.service.RecommendationSnapshotService;
import com.ssafy.b102.recommendation.service.RecommendationSnapshotService.NextContext;
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
			new RecommendationProperties("http://ai:8000", null, null, 5, 10),
			mock(RecommendationSnapshotService.class), CLOCK);

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
		assertThat(response.appliedTags()).containsExactly("FICTION");
		assertThat(response.items().get(0).tags()).containsExactly("FICTION");
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
			new RecommendationProperties("http://ai:8000", null, null, 5, 10),
			mock(RecommendationSnapshotService.class), CLOCK);

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
			new RecommendationProperties("http://ai:8000", null, null, 5, 10),
			mock(RecommendationSnapshotService.class), CLOCK);

		RecommendationResponse response = service.recommend(USER_ID, 5, null);

		org.mockito.Mockito.verifyNoInteractions(aiClient);
		assertThat(response.mode()).isEqualTo("COLD_START");
		assertThat(response.fallback()).isTrue();
		assertThat(response.items()).extracting(item -> item.book().isbn13())
			.containsExactly("9788900000001", "9788900000002");
		assertThat(response.items().get(0).reasonType()).isEqualTo("SEGMENT_POPULAR");
		assertThat(response.items().get(0).reasonText()).isEqualTo("30대 여성에서 많이 대출된 책이에요.");
	}

	@Test
	@DisplayName("스냅샷 저장이 실패해도 추천 응답은 그대로 나간다 — 분석용 저장이 화면을 막으면 안 된다")
	void snapshotFailureDoesNotBreakResponse() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		when(library.findByUser_IdOrderByUpdatedAtDesc(USER_ID)).thenReturn(List.of());
		when(interests.findTagCodesByUserId(USER_ID)).thenReturn(List.of());
		when(popularBooks.popularFor(USER_ID, PopularBookService.MAX_SIZE)).thenReturn(
			new PopularBooksResponse(null, List.of(summary("9788900000003", "인기 책"))));
		RecommendationSnapshotService snapshots = mock(RecommendationSnapshotService.class);
		org.mockito.Mockito.doThrow(new IllegalStateException("저장 실패")).when(snapshots).save(any(), any());

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), snapshots, CLOCK);

		RecommendationResponse response = service.recommend(USER_ID, 5, null);

		assertThat(response.items()).hasSize(1);
		verify(snapshots).save(any(), any());
	}

	@Test
	@DisplayName("다음 추천은 직전 덱의 태그·가중치를 유지하고 직전 및 최근 덱을 제외한다")
	void nextRecommendationPreservesCriteriaAndRelaxesOldestDeckWhenShort() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		RecommendationSnapshotService snapshots = mock(RecommendationSnapshotService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		LibraryItem wish = mock(LibraryItem.class);
		Book wishedBook = book("9780000000001", 10L, "찜한 책");
		when(wish.getBook()).thenReturn(wishedBook);
		when(wish.getStatus()).thenReturn(ShelfStatus.WISH);
		when(library.findByUser_IdOrderByUpdatedAtDesc(USER_ID)).thenReturn(List.of(wish));
		when(snapshots.findNextContext(USER_ID, "rec-previous")).thenReturn(Optional.of(new NextContext(
			"PERSONALIZED", List.of("FICTION"),
			Map.of("semantic", 0.2, "tagMatch", 0.4, "coLoan", 0.1, "trending", 0.2, "steady", 0.1),
			List.of("9780000000002"),
			List.of(List.of("9780000000003"), List.of("9780000000004")))));

		List<AiRecommendationResponse.Item> shortItems = aiItems("9780000000011", "9780000000012", "9780000000013", "9780000000014");
		List<AiRecommendationResponse.Item> fullItems = aiItems("9780000000021", "9780000000022", "9780000000023", "9780000000024", "9780000000025");
		when(aiClient.recommend(any())).thenReturn(aiResponse("rec-next-short", shortItems), aiResponse("rec-next-full", fullItems));
		AtomicLong bookIds = new AtomicLong(100);
		when(books.findByIsbn13In(any())).thenAnswer(call -> call.<List<String>>getArgument(0).stream()
			.map(isbn -> book(isbn, bookIds.incrementAndGet(), "추천 책"))
			.toList());

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), snapshots, CLOCK);
		RecommendationResponse response = service.recommendNext(USER_ID,
			new NextRecommendationRequest("rec-previous", 5), 5);

		ArgumentCaptor<AiRecommendationRequest> captor = ArgumentCaptor.forClass(AiRecommendationRequest.class);
		verify(aiClient, org.mockito.Mockito.times(2)).recommend(captor.capture());
		List<AiRecommendationRequest> requests = captor.getAllValues();
		assertThat(requests.get(0).excludeIsbns()).containsExactlyInAnyOrder(
			"9780000000001", "9780000000002", "9780000000003", "9780000000004");
		assertThat(requests.get(1).excludeIsbns()).containsExactlyInAnyOrder(
			"9780000000001", "9780000000002", "9780000000003");
		assertThat(requests.get(1).tags()).extracting(AiRecommendationRequest.TagPreference::code).containsExactly("FIC");
		assertThat(requests.get(1).weights()).isEqualTo(new AiRecommendationRequest.RecommendationWeights(0.2, 0.4, 0.1, 0.2, 0.1));
		assertThat(response.recommendationId()).isEqualTo("rec-next-full");
		assertThat(response.items()).hasSize(5);
		verify(snapshots).save(USER_ID, response);
	}

	@Test
	@DisplayName("다른 사용자 덱 또는 존재하지 않는 덱으로 다음 추천을 만들 수 없다")
	void nextRecommendationRequiresOwnedSnapshot() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		RecommendationSnapshotService snapshots = mock(RecommendationSnapshotService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		when(snapshots.findNextContext(USER_ID, "rec-not-owned")).thenReturn(Optional.empty());
		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), snapshots, CLOCK);

		org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.recommendNext(USER_ID,
			new NextRecommendationRequest("rec-not-owned", null), 5))
			.isInstanceOf(com.ssafy.b102.global.error.BusinessException.class)
			.extracting("code").isEqualTo(com.ssafy.b102.global.error.ErrorCode.NOT_FOUND);
		verify(aiClient, never()).recommend(any());
	}

	@Test
	@DisplayName("다음 추천의 AI 실패는 기존 태그 조건을 보존한 인기순 폴백 덱으로 이어진다")
	void nextRecommendationFallsBackWithoutLosingCriteriaOrRepeatingPreviousBooks() {
		AiRecommendationClient aiClient = mock(AiRecommendationClient.class);
		UserService userService = mock(UserService.class);
		UserInterestRepository interests = mock(UserInterestRepository.class);
		LibraryItemRepository library = mock(LibraryItemRepository.class);
		BookRepository books = mock(BookRepository.class);
		PopularBookService popularBooks = mock(PopularBookService.class);
		RecommendationSnapshotService snapshots = mock(RecommendationSnapshotService.class);
		User user = mock(User.class);
		when(user.isOnboarded()).thenReturn(true);
		when(userService.getUser(USER_ID)).thenReturn(user);
		when(library.findByUser_IdOrderByUpdatedAtDesc(USER_ID)).thenReturn(List.of());
		when(snapshots.findNextContext(USER_ID, "rec-ai-failed")).thenReturn(Optional.of(new NextContext(
			"PERSONALIZED", List.of("FICTION"),
			Map.of("semantic", 0.2, "tagMatch", 0.4, "coLoan", 0.1, "trending", 0.2, "steady", 0.1),
			List.of("9780000000031"), List.of(List.of("9780000000032")))));
		when(aiClient.recommend(any())).thenThrow(new com.ssafy.b102.global.error.BusinessException(
			com.ssafy.b102.global.error.ErrorCode.RECOMMENDATION_UNAVAILABLE));
		when(popularBooks.popularFor(USER_ID, PopularBookService.MAX_SIZE)).thenReturn(new PopularBooksResponse(
			null, List.of(summary("9780000000031", "직전 추천 책"), summary("9780000000033", "인기 대체 책"))));

		RecommendationService service = new RecommendationService(aiClient, userService, interests, library, books, popularBooks,
			new RecommendationProperties("http://ai:8000", null, null, 5, 10), snapshots, CLOCK);
		RecommendationResponse response = service.recommendNext(USER_ID,
			new NextRecommendationRequest("rec-ai-failed", 5), 5);

		assertThat(response.mode()).isEqualTo("PERSONALIZED");
		assertThat(response.fallback()).isTrue();
		assertThat(response.appliedTags()).containsExactly("FICTION");
		assertThat(response.weights()).containsEntry("semantic", 0.2).containsEntry("tagMatch", 0.4);
		assertThat(response.items()).extracting(item -> item.book().isbn13()).containsExactly("9780000000033");
		verify(snapshots).save(USER_ID, response);
	}

	private static AiRecommendationResponse aiResponse(String recommendationId, List<AiRecommendationResponse.Item> items) {
		return new AiRecommendationResponse(recommendationId, "req", "42", "model-v1", "index-v1", false, items);
	}

	private static List<AiRecommendationResponse.Item> aiItems(String... isbns) {
		List<AiRecommendationResponse.Item> items = new java.util.ArrayList<>();
		for (int i = 0; i < isbns.length; i++) {
			items.add(new AiRecommendationResponse.Item(isbns[i], i + 1, 90.0 - i, Map.of("semantic", 80.0),
				List.of("FIC"), new AiRecommendationResponse.Reason("TAG_MATCH", "태그 일치"), List.of()));
		}
		return items;
	}

	private static BookSummaryResponse summary(String isbn, String title) {
		return new BookSummaryResponse("1", isbn, title, List.of("작가"), "출판사", 2020,
			"https://img.example/book.jpg", null, "문학", "813.7", null);
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
