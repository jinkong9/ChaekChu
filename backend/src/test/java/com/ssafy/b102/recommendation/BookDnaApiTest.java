package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiBookDnaClient;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * GET /users/me/dna 를 컨트롤러부터 PG 까지 실제 빈으로 — AI 클라이언트만 mock.
 * 서비스에 트랜잭션이 없으므로(AI 호출이 DB 커넥션을 물지 않게) 엔티티가 트랜잭션 밖에서 읽히는 경로, 저장(REQUIRES_NEW) 뒤 두 번째 요청이
 * AI 없이 답하는 경로, AI 장애 때 저장분으로 답하는 경로를 통째로 본다. 단위 테스트(BookDnaServiceTest)는 이 셋을 mock 으로만 봤다.
 *
 * <b>{@code @Transactional} 을 쓰지 않는다.</b> 저장이 REQUIRES_NEW 라 테스트 트랜잭션으로는 지워지지 않는다. 사용자를 지워 정리한다(CASCADE).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BookDnaApiTest {

	private static final String DNA = "/api/v1/users/me/dna";

	@Autowired MockMvc mvc;
	@Autowired JwtTokenProvider jwt;
	@Autowired UserRepository userRepository;
	@Autowired BookRepository bookRepository;
	@Autowired LibraryItemRepository libraryRepository;
	@Autowired JdbcTemplate jdbc;
	@MockitoBean AiBookDnaClient aiClient;

	private User user;
	private String bearer;
	private Book read;
	private Book wish;
	private final List<Long> books = new ArrayList<>();

	@BeforeEach
	void setUp() {
		user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "dna-api-" + System.nanoTime()));
		bearer = "Bearer " + jwt.issue(user.getId());
		read = book("데미안", "헤르만 헤세 지음");
		wish = book("채식주의자", "한강 지음");
		libraryRepository.save(LibraryItem.serviceEntry(user, wish, ShelfStatus.WISH, LocalDate.of(2026, 9, 16)));
		libraryRepository.save(LibraryItem.serviceEntry(user, read, ShelfStatus.READ, LocalDate.of(2026, 9, 1)));
	}

	@AfterEach
	void tearDown() {
		jdbc.update("delete from users where id = ?", user.getId());   // user_library · user_dna_profiles 는 CASCADE
		books.forEach(id -> jdbc.update("delete from books where id = ?", id));
	}

	@Test
	@DisplayName("첫 조회는 AI 를 부르고 저장, 서재가 그대로면 두 번째 조회는 AI 없이 같은 프로필 — books 는 READ 먼저, analyzed 는 unresolved 반영")
	void firstCallComputesSecondCallServesStored() throws Exception {
		when(aiClient.profile(any())).thenReturn(ai("READY", 1, List.of(wish.getIsbn13())));

		mvc.perform(get(DNA).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.readCount").value(1))
			.andExpect(jsonPath("$.books.length()").value(2))
			.andExpect(jsonPath("$.books[0].isbn13").value(read.getIsbn13()))
			.andExpect(jsonPath("$.books[0].status").value("READ"))
			.andExpect(jsonPath("$.books[0].authors[0]").value("헤르만 헤세"))
			.andExpect(jsonPath("$.books[0].analyzed").value(true))
			.andExpect(jsonPath("$.books[1].isbn13").value(wish.getIsbn13()))
			.andExpect(jsonPath("$.books[1].analyzed").value(false))
			.andExpect(jsonPath("$.profile.status").value("READY"))
			.andExpect(jsonPath("$.profile.axes[0].code").value("FICTION"))
			.andExpect(jsonPath("$.dnaVersion").value("book-dna-v1"))
			.andExpect(jsonPath("$.generatedAt").isString());

		mvc.perform(get(DNA).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.profile.status").value("READY"))
			.andExpect(jsonPath("$.books[1].analyzed").value(false));

		verify(aiClient, times(1)).profile(any());
		assertThat(jdbc.queryForObject("select count(*) from user_dna_profiles where user_id = ?", Integer.class, user.getId()))
			.isEqualTo(1);
	}

	@Test
	@DisplayName("AI 장애: 저장된 것이 없으면 503 DNA_UNAVAILABLE, 있으면(서재가 바뀌었어도) 200 으로 마지막 프로필 + 현재 서재 목록")
	void aiOutageFallsBackToStoredProfile() throws Exception {
		// 재스텁은 doThrow/doReturn — 이미 thenThrow 로 묶인 mock 에 when(mock.profile()) 을 쓰면 그 호출 자체가 예외를 던진다
		doThrow(new BusinessException(ErrorCode.DNA_UNAVAILABLE)).when(aiClient).profile(any());
		mvc.perform(get(DNA).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.code").value("DNA_UNAVAILABLE"));

		doReturn(ai("READY", 1, List.of())).when(aiClient).profile(any());
		mvc.perform(get(DNA).header(HttpHeaders.AUTHORIZATION, bearer)).andExpect(status().isOk());

		// 서재가 바뀌어(지문 변경) 다시 계산해야 하는데 AI 가 죽었다 → 저장된 프로필로 답하고 책 목록은 현재 서재 3권
		libraryRepository.save(LibraryItem.serviceEntry(user, book("코스모스", "칼 세이건"), ShelfStatus.READ, LocalDate.of(2026, 9, 15)));
		doThrow(new BusinessException(ErrorCode.DNA_UNAVAILABLE)).when(aiClient).profile(any());
		mvc.perform(get(DNA).header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.profile.status").value("READY"))
			.andExpect(jsonPath("$.readCount").value(2))
			.andExpect(jsonPath("$.books.length()").value(3))
			.andExpect(jsonPath("$.books[0].title").value("코스모스"));   // READ 중 완독일이 가장 최근
	}

	@Test
	@DisplayName("토큰 없음 → 401")
	void noToken401() throws Exception {
		mvc.perform(get(DNA)).andExpect(status().isUnauthorized());
	}

	// ── 도우미 ──

	private Book book(String title, String author) {
		long id = jdbc.queryForObject("insert into books (isbn13, title, author) values (?, ?, ?) returning id",
			Long.class, uniqueIsbn(), title, author);
		books.add(id);
		return bookRepository.findById(id).orElseThrow();
	}

	private static String uniqueIsbn() {
		return "979" + String.format("%010d", System.nanoTime() % 10_000_000_000L);
	}

	private static AiBookDnaResponse ai(String status, int basedOn, List<String> unresolved) {
		return new AiBookDnaResponse("dna-req", "book-dna-v1", "embedding-v1", "index-v1", "tags-v1",
			new AiBookDnaResponse.Profile(status, basedOn,
				List.of(new AiBookDnaResponse.Score("FICTION", "소설", 100)), List.of(), List.of(), null,
				new AiBookDnaResponse.Evidence(basedOn, basedOn, List.of("FICTION"), List.of("FIC"))),
			unresolved);
	}
}
