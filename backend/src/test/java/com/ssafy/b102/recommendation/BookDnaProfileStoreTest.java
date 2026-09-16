package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.service.BookDnaProfileStore;
import com.ssafy.b102.recommendation.service.BookDnaProfileStore.StoredProfile;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * Book DNA 저장 계층 — V8 user_dna_profiles 왕복, 서재 지문, 스냅샷 쿼리(READ 우선·완독일 내림차순·null 마지막). PG 가 필요하다.
 *
 * <b>{@code @Transactional} 을 쓰지 않는다.</b> 저장이 REQUIRES_NEW 라 테스트 트랜잭션이 롤백해도 행이 남는다.
 * 만든 사용자를 지워 정리한다 — user_library·user_dna_profiles 는 FK CASCADE 로 함께 사라진다.
 */
@SpringBootTest
@ActiveProfiles("test")
class BookDnaProfileStoreTest {

	@Autowired BookDnaProfileStore store;
	@Autowired LibraryItemRepository libraryRepository;
	@Autowired UserRepository userRepository;
	@Autowired BookRepository bookRepository;
	@Autowired JdbcTemplate jdbc;

	private User user;
	private final List<Long> books = new ArrayList<>();

	@BeforeEach
	void setUp() {
		user = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "dna-store-" + System.nanoTime()));
	}

	@AfterEach
	void tearDown() {
		jdbc.update("delete from users where id = ?", user.getId());
		books.forEach(id -> jdbc.update("delete from books where id = ?", id));
	}

	@Test
	@DisplayName("스냅샷: READ 가 완독일 내림차순(온보딩 seed 의 null 은 마지막)으로 먼저, WISH 는 그 뒤. Pageable 로 자른다")
	void snapshotOrdersReadFirst() {
		Book older = book("먼저 읽은 책");
		Book newer = book("최근 읽은 책");
		Book seed = book("온보딩 seed");
		Book wish = book("찜한 책");
		libraryRepository.save(LibraryItem.serviceEntry(user, wish, ShelfStatus.WISH, LocalDate.of(2026, 9, 16)));
		libraryRepository.save(LibraryItem.onboardingSeed(user, seed, 4));
		libraryRepository.save(LibraryItem.serviceEntry(user, older, ShelfStatus.READ, LocalDate.of(2026, 9, 1)));
		libraryRepository.save(LibraryItem.serviceEntry(user, newer, ShelfStatus.READ, LocalDate.of(2026, 9, 10)));

		assertThat(libraryRepository.findDnaSnapshot(user.getId(), ShelfStatus.READ, PageRequest.of(0, 200)))
			.extracting(item -> item.getBook().getId())
			.containsExactly(newer.getId(), older.getId(), seed.getId(), wish.getId());
		assertThat(libraryRepository.findDnaSnapshot(user.getId(), ShelfStatus.READ, PageRequest.of(0, 2)))
			.extracting(item -> item.getBook().getId())
			.containsExactly(newer.getId(), older.getId());
	}

	@Test
	@DisplayName("저장·조회 왕복 — profile·unresolvedIsbns·generatedAt 이 그대로 돌아오고, 같은 사용자는 덮어써 한 행이다")
	void saveAndFindRoundTrip() {
		assertThat(store.find(user.getId())).isEmpty();

		StoredProfile first = stored("fp-1", Instant.parse("2026-09-16T00:00:00Z"), "READY", List.of("9791100000001"));
		store.save(user.getId(), first);
		StoredProfile found = store.find(user.getId()).orElseThrow();
		assertThat(found.fingerprint()).isEqualTo("fp-1");
		assertThat(found.requestId()).isEqualTo("dna-test");
		assertThat(found.dnaVersion()).isEqualTo("book-dna-v1");
		assertThat(found.profile().status()).isEqualTo("READY");
		assertThat(found.profile().axes()).extracting(AiBookDnaResponse.Score::code).containsExactly("FICTION");
		assertThat(found.profile().evidence().topTags()).containsExactly("FIC");
		assertThat(found.unresolvedIsbns()).containsExactly("9791100000001");
		assertThat(found.generatedAt()).isEqualTo(first.generatedAt());

		store.save(user.getId(), stored("fp-2", Instant.parse("2026-09-16T01:00:00Z"), "INSUFFICIENT_DATA", List.of()));
		StoredProfile replaced = store.find(user.getId()).orElseThrow();
		assertThat(replaced.fingerprint()).isEqualTo("fp-2");
		assertThat(replaced.profile().status()).isEqualTo("INSUFFICIENT_DATA");
		assertThat(replaced.unresolvedIsbns()).isEmpty();
		assertThat(jdbc.queryForObject("select count(*) from user_dna_profiles where user_id = ?", Integer.class, user.getId()))
			.isEqualTo(1);
	}

	@Test
	@DisplayName("서재 지문: AI 에 보낸 스냅샷에서만 만든다 — 책·상태·평점·완독일·태그가 바뀌면 다르고, 책·태그 순서는 영향이 없다")
	void fingerprintIsPureFunctionOfSnapshot() {
		AiBookDnaRequest.Book a = new AiBookDnaRequest.Book("9791100000011", "READ", 5, LocalDate.of(2026, 9, 1));
		AiBookDnaRequest.Book b = new AiBookDnaRequest.Book("9791100000028", "WISH", null, null);
		String base = store.fingerprint(List.of(a, b), List.of("FICTION", "ESSAY"));

		assertThat(base).hasSize(32);
		assertThat(store.fingerprint(List.of(b, a), List.of("ESSAY", "FICTION"))).isEqualTo(base);      // 순서 무관
		assertThat(store.fingerprint(List.of(a), List.of("FICTION", "ESSAY"))).isNotEqualTo(base);      // 책 추가·삭제
		assertThat(store.fingerprint(List.of(a, new AiBookDnaRequest.Book(b.isbn13(), "READ", null, LocalDate.of(2026, 9, 16))),
			List.of("FICTION", "ESSAY"))).isNotEqualTo(base);                                              // 상태·완독일
		assertThat(store.fingerprint(List.of(new AiBookDnaRequest.Book(a.isbn13(), "READ", 4, a.finishedDate()), b),
			List.of("FICTION", "ESSAY"))).isNotEqualTo(base);                                              // 평점
		assertThat(store.fingerprint(List.of(a, b), List.of("FICTION"))).isNotEqualTo(base);             // 관심 태그
		assertThat(store.fingerprint(List.of(), List.of())).hasSize(32);                                    // 빈 서재도 지문이 있다
	}

	@Test
	@DisplayName("isFresh: 지문이 같고 TTL 안일 때만")
	void freshness() {
		Instant generated = Instant.parse("2026-09-16T00:00:00Z");
		StoredProfile stored = stored("fp", generated, "READY", List.of());
		java.time.Duration day = java.time.Duration.ofHours(24);
		assertThat(stored.isFresh("fp", generated.plus(java.time.Duration.ofHours(23)), day)).isTrue();
		assertThat(stored.isFresh("fp", generated.plus(day), day)).isTrue();
		assertThat(stored.isFresh("fp", generated.plus(java.time.Duration.ofHours(25)), day)).isFalse();
		assertThat(stored.isFresh("other", generated, day)).isFalse();
	}

	// ── 도우미 ──

	private Book book(String title) {
		long id = jdbc.queryForObject("insert into books (isbn13, title) values (?, ?) returning id", Long.class, uniqueIsbn(), title);
		books.add(id);
		return bookRepository.findById(id).orElseThrow();
	}

	private static String uniqueIsbn() {
		return "979" + String.format("%010d", System.nanoTime() % 10_000_000_000L);
	}

	private static StoredProfile stored(String fingerprint, Instant generatedAt, String status, List<String> unresolved) {
		return new StoredProfile(fingerprint, "dna-test", "book-dna-v1", "embedding-v1", "index-v1", "tags-v1",
			new AiBookDnaResponse.Profile(status, unresolved.isEmpty() ? 0 : 1,
				List.of(new AiBookDnaResponse.Score("FICTION", "소설", 100)), List.of(), List.of(), null,
				new AiBookDnaResponse.Evidence(1, 1, List.of("FICTION"), List.of("FIC"))),
			unresolved, generatedAt);
	}
}
