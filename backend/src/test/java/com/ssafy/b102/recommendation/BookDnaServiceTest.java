package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiBookDnaClient;
import com.ssafy.b102.recommendation.config.BookDnaProperties;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.dto.BookDnaResponse;
import com.ssafy.b102.recommendation.service.BookDnaProfileStore;
import com.ssafy.b102.recommendation.service.BookDnaProfileStore.StoredProfile;
import com.ssafy.b102.recommendation.service.BookDnaService;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

/**
 * Book DNA 조립 — 스냅샷 선정·AI 호출·프로필 저장·캐시·장애 폴백. AI·DB 는 mock.
 * 저장 계층과 스냅샷 쿼리는 BookDnaProfileStoreTest 가 PG 로 본다.
 */
class BookDnaServiceTest {

	private static final Long USER = 8L;
	private static final Instant NOW = Instant.parse("2026-09-16T00:00:00Z");
	private static final String FP = "fp-current";
	private static final String READ_ISBN = "9780000000001";
	private static final String WISH_ISBN = "9780000000002";

	private final AiBookDnaClient aiClient = mock(AiBookDnaClient.class);
	private final UserService users = mock(UserService.class);
	private final UserInterestRepository interests = mock(UserInterestRepository.class);
	private final LibraryItemRepository library = mock(LibraryItemRepository.class);
	private final BookSummaryMapper mapper = mock(BookSummaryMapper.class);
	private final BookDnaProfileStore store = mock(BookDnaProfileStore.class);
	private BookDnaService service;

	@BeforeEach
	void setUp() {
		when(interests.findTagCodesByUserId(USER)).thenReturn(List.of("FICTION"));
		when(store.fingerprint(anyList(), anyList())).thenReturn(FP);
		when(store.find(USER)).thenReturn(Optional.empty());
		// item() 안에서도 when() 을 쓰므로 스텁 바깥에서 먼저 만든다 — 스텁 안에서 만들면 Mockito 가 UnfinishedStubbing 으로 본다
		LibraryItem read = item(READ_ISBN, ShelfStatus.READ, 5, LocalDate.of(2026, 9, 1));
		LibraryItem wish = item(WISH_ISBN, ShelfStatus.WISH, null, null);
		when(library.findDnaSnapshot(eq(USER), eq(ShelfStatus.READ), any(Pageable.class))).thenReturn(List.of(read, wish));
		service = new BookDnaService(aiClient, users, interests, library, mapper, store,
			new BookDnaProperties(null, Duration.ofHours(24)), Clock.fixed(NOW, ZoneOffset.UTC));
	}

	@Test
	@DisplayName("저장된 프로필이 없으면 AI 를 부르고 저장한다. 인덱스에 없던 책은 analyzed=false, readCount 는 READ 만")
	void callsAiAndStoresProfile() {
		when(aiClient.profile(any())).thenReturn(aiResponse("READY", 1, List.of(WISH_ISBN)));

		BookDnaResponse response = service.getMine(USER);

		ArgumentCaptor<AiBookDnaRequest> request = ArgumentCaptor.forClass(AiBookDnaRequest.class);
		verify(aiClient).profile(request.capture());
		assertThat(request.getValue().userId()).isEqualTo("8");
		assertThat(request.getValue().books()).extracting(AiBookDnaRequest.Book::isbn13, AiBookDnaRequest.Book::status)
			.containsExactly(tuple(READ_ISBN, "READ"), tuple(WISH_ISBN, "WISH"));

		// 지문은 AI 에 보낸 것 그대로에서 만든다(리뷰 P1) — DB 를 다시 읽는 두 번째 조회가 없다
		verify(store).fingerprint(eq(request.getValue().books()), anyList());

		ArgumentCaptor<StoredProfile> saved = ArgumentCaptor.forClass(StoredProfile.class);
		verify(store).save(eq(USER), saved.capture());
		assertThat(saved.getValue().fingerprint()).isEqualTo(FP);
		assertThat(saved.getValue().generatedAt()).isEqualTo(NOW);
		assertThat(saved.getValue().unresolvedIsbns()).containsExactly(WISH_ISBN);

		assertThat(response.generatedAt()).isEqualTo(NOW);
		assertThat(response.readCount()).isEqualTo(1);
		assertThat(response.declaredTags()).isNotNull();
		assertThat(response.books()).extracting(BookDnaResponse.Book::isbn13, BookDnaResponse.Book::analyzed)
			.containsExactly(tuple(READ_ISBN, true), tuple(WISH_ISBN, false));
		assertThat(response.profile().status()).isEqualTo("READY");
		assertThat(response.profile().axes()).extracting(BookDnaResponse.Score::code).containsExactly("FICTION");
	}

	@Test
	@DisplayName("서재 지문이 같고 TTL 안이면 AI 를 부르지 않고 저장된 프로필로 답한다 — generatedAt 은 저장 시각, 책 목록은 현재 서재")
	void servesStoredProfileWithoutAi() {
		Instant earlier = NOW.minus(Duration.ofHours(3));
		when(store.find(USER)).thenReturn(Optional.of(stored(FP, earlier, "INSUFFICIENT_DATA", List.of(READ_ISBN))));

		BookDnaResponse response = service.getMine(USER);

		verify(aiClient, never()).profile(any());
		verify(store, never()).save(anyLong(), any());
		assertThat(response.generatedAt()).isEqualTo(earlier);
		assertThat(response.profile().status()).isEqualTo("INSUFFICIENT_DATA");
		assertThat(response.books()).extracting(BookDnaResponse.Book::isbn13, BookDnaResponse.Book::analyzed)
			.containsExactly(tuple(READ_ISBN, false), tuple(WISH_ISBN, true));
	}

	@Test
	@DisplayName("서재 지문이 다르면(책을 담았거나 평점을 고쳤으면) 다시 계산하고 새 지문으로 저장한다")
	void recomputesWhenLibraryChanged() {
		when(store.find(USER)).thenReturn(Optional.of(stored("fp-old", NOW.minus(Duration.ofHours(1)), "READY", List.of())));
		when(aiClient.profile(any())).thenReturn(aiResponse("READY", 2, List.of()));

		BookDnaResponse response = service.getMine(USER);

		verify(aiClient).profile(any());
		ArgumentCaptor<StoredProfile> saved = ArgumentCaptor.forClass(StoredProfile.class);
		verify(store).save(eq(USER), saved.capture());
		assertThat(saved.getValue().fingerprint()).isEqualTo(FP);
		assertThat(response.generatedAt()).isEqualTo(NOW);
	}

	@Test
	@DisplayName("지문이 같아도 TTL 을 넘기면 다시 계산한다 — 인덱스·태그 버전 변경을 따라가는 길")
	void recomputesAfterTtl() {
		when(store.find(USER)).thenReturn(Optional.of(stored(FP, NOW.minus(Duration.ofHours(25)), "READY", List.of())));
		when(aiClient.profile(any())).thenReturn(aiResponse("READY", 2, List.of()));

		service.getMine(USER);

		verify(aiClient).profile(any());
		verify(store).save(eq(USER), any());
	}

	@Test
	@DisplayName("AI 가 죽어 있으면 저장된 마지막 프로필(지문이 달라도, TTL 이 지났어도)로 답하고 저장하지 않는다")
	void fallsBackToStoredProfileWhenAiDown() {
		Instant old = NOW.minus(Duration.ofDays(3));
		when(store.find(USER)).thenReturn(Optional.of(stored("fp-old", old, "READY", List.of())));
		when(aiClient.profile(any())).thenThrow(new BusinessException(ErrorCode.DNA_UNAVAILABLE));

		BookDnaResponse response = service.getMine(USER);

		assertThat(response.generatedAt()).isEqualTo(old);
		assertThat(response.profile().status()).isEqualTo("READY");
		verify(store, never()).save(anyLong(), any());
	}

	@Test
	@DisplayName("AI 가 죽어 있고 저장된 것도 없으면 DNA_UNAVAILABLE 그대로")
	void throwsWhenAiDownAndNothingStored() {
		when(aiClient.profile(any())).thenThrow(new BusinessException(ErrorCode.DNA_UNAVAILABLE));

		assertThatThrownBy(() -> service.getMine(USER))
			.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.DNA_UNAVAILABLE));
	}

	@Test
	@DisplayName("스냅샷은 READ 우선 쿼리로 최대 200권")
	void snapshotUsesReadFirstQueryWithCap() {
		when(aiClient.profile(any())).thenReturn(aiResponse("READY", 1, List.of()));

		service.getMine(USER);

		verify(library).findDnaSnapshot(USER, ShelfStatus.READ, PageRequest.of(0, 200));
	}

	@Test
	@DisplayName("프로필 저장이 실패해도 응답은 나간다")
	void storeFailureDoesNotBreakResponse() {
		when(aiClient.profile(any())).thenReturn(aiResponse("READY", 1, List.of()));
		doThrow(new RuntimeException("db down")).when(store).save(anyLong(), any());

		assertThat(service.getMine(USER).profile().status()).isEqualTo("READY");
	}

	// ── 도우미 ──

	private LibraryItem item(String isbn, ShelfStatus status, Integer rating, LocalDate finished) {
		Book book = mock(Book.class);
		when(book.getIsbn13()).thenReturn(isbn);
		LibraryItem item = mock(LibraryItem.class);
		when(item.getBook()).thenReturn(book);
		when(item.getStatus()).thenReturn(status);
		when(item.getRating()).thenReturn(rating == null ? null : rating.shortValue());
		when(item.getFinishedAt()).thenReturn(finished);
		when(mapper.from(book)).thenReturn(new BookSummaryResponse(isbn.substring(10), isbn, "책 " + isbn, List.of("작가"),
			"출판사", 2026, null, null, "문학", "813.7", null));
		return item;
	}

	private static AiBookDnaResponse aiResponse(String status, int basedOn, List<String> unresolved) {
		return new AiBookDnaResponse("dna-req", "book-dna-v1", "embedding-v1", "index-v1", "tags-v1",
			new AiBookDnaResponse.Profile(status, basedOn,
				List.of(new AiBookDnaResponse.Score("FICTION", "소설", 100)), List.of(), List.of(), null,
				new AiBookDnaResponse.Evidence(basedOn, basedOn, List.of("FICTION"), List.of("FIC"))),
			unresolved);
	}

	private static StoredProfile stored(String fingerprint, Instant generatedAt, String status, List<String> unresolved) {
		return new StoredProfile(fingerprint, "dna-old", "book-dna-v1", "embedding-v1", "index-v1", "tags-v1",
			new AiBookDnaResponse.Profile(status, 0, List.of(), List.of(), List.of(), null,
				new AiBookDnaResponse.Evidence(0, 0, List.of(), List.of())),
			unresolved, generatedAt);
	}
}
