package com.ssafy.b102.recommendation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.recommendation.dto.RecommendationResponse;
import com.ssafy.b102.recommendation.repository.RecommendationSnapshotRepository;
import com.ssafy.b102.recommendation.service.RecommendationSnapshotService;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * 추천 스냅샷 저장 — 내보낸 덱을 recommendations · recommendation_items 에 남긴다.
 *
 * <b>{@code @Transactional} 을 쓰지 않는다.</b> 저장이 REQUIRES_NEW 라(부르는 쪽이 readOnly 트랜잭션이다)
 * 테스트 트랜잭션이 롤백해도 행이 남는다. 그래서 만든 사용자를 지워 정리한다 — 덱·항목은 FK CASCADE 로 함께 사라진다.
 */
@SpringBootTest
@ActiveProfiles("test")
class RecommendationSnapshotTest {

	@Autowired RecommendationSnapshotService snapshots;
	@Autowired RecommendationSnapshotRepository repository;
	@Autowired UserRepository userRepository;
	@Autowired JdbcTemplate jdbc;

	private Long userId;
	private final List<Long> books = new ArrayList<>();

	@BeforeEach
	void setUp() {
		userId = userRepository.save(User.fromOAuth(OAuthProvider.GOOGLE, "snapshot-" + System.nanoTime())).getId();
	}

	@AfterEach
	void tearDown() {
		jdbc.update("delete from users where id = ?", userId);     // recommendations·items·user_actions 는 CASCADE
		books.forEach(id -> jdbc.update("delete from books where id = ?", id));
	}

	@Test
	@DisplayName("덱과 도서 목록이 저장되고 화면에 나간 recommendationId 로 되찾을 수 있다")
	void savesDeckAndItems() {
		long first = book("첫 번째 책");
		long second = book("두 번째 책");
		RecommendationResponse response = deck("rec_snapshot_1", item(first, 1, 91.2, "TAG_MATCH"),
			item(second, 2, 80.0, "CO_LOAN"));

		snapshots.save(userId, response);

		Long deckId = repository.findOwnedIdByPublicId("rec_snapshot_1", userId).orElseThrow();
		Map<String, Object> deck = jdbc.queryForMap("select * from recommendations where id = ?", deckId);
		assertThat(deck.get("user_id")).isEqualTo(userId);
		assertThat(deck.get("mode")).isEqualTo("PERSONALIZED");
		assertThat(deck.get("fallback")).isEqualTo(false);
		assertThat(deck.get("feature_version")).isEqualTo("hybrid-v1");
		assertThat(deck.get("index_version")).isEqualTo("books-v3");
		assertThat(deck.get("weights").toString()).contains("semantic");
		assertThat(deck.get("input_tags").toString()).contains("#소설");

		List<Map<String, Object>> items = jdbc.queryForList(
			"select * from recommendation_items where recommendation_id = ? order by rank", deckId);
		assertThat(items).hasSize(2);
		assertThat(items.get(0).get("book_id")).isEqualTo(first);
		assertThat(((Number)items.get(0).get("score")).doubleValue()).isEqualTo(91.2);
		assertThat(items.get(0).get("reason_type")).isEqualTo("TAG_MATCH");
		assertThat(items.get(0).get("feature_scores").toString()).contains("semantic");
		assertThat(items.get(1).get("reason_type")).isEqualTo("CO_LOAN");
	}

	@Test
	@DisplayName("AI 계약이 주는 이유 유형이 전부 들어간다 — V1 CHECK 목록에는 하나도 없던 값들이다")
	void acceptsEveryAiReasonType() {
		List<String> aiReasons = List.of("TAG_MATCH", "SEMANTIC", "CO_LOAN", "TRENDING", "STEADY",
			"MANIA_REC", "READER_REC", "SEGMENT_POPULAR");
		List<RecommendationResponse.Item> items = new ArrayList<>();
		for (int i = 0; i < aiReasons.size(); i++) {
			items.add(item(book("이유 " + aiReasons.get(i)), i + 1, 50.0, aiReasons.get(i)));
		}

		snapshots.save(userId, deck("rec_snapshot_reasons", items.toArray(RecommendationResponse.Item[]::new)));

		Long deckId = repository.findOwnedIdByPublicId("rec_snapshot_reasons", userId).orElseThrow();
		assertThat(jdbc.queryForList("select reason_type from recommendation_items where recommendation_id = ?",
			String.class, deckId)).containsExactlyInAnyOrderElementsOf(aiReasons);
	}

	@Test
	@DisplayName("같은 책·같은 순위가 겹치면 그 항목만 버린다 — 스냅샷 때문에 추천이 실패하면 안 된다")
	void skipsDuplicateItems() {
		long only = book("하나뿐인 책");
		RecommendationResponse response = deck("rec_snapshot_dup",
			item(only, 1, 90.0, "SEMANTIC"),
			item(only, 2, 80.0, "SEMANTIC"),       // 같은 책
			item(book("다른 책"), 1, 70.0, "SEMANTIC"));   // 같은 순위

		snapshots.save(userId, response);

		Long deckId = repository.findOwnedIdByPublicId("rec_snapshot_dup", userId).orElseThrow();
		assertThat(jdbc.queryForObject("select count(*) from recommendation_items where recommendation_id = ?",
			Integer.class, deckId)).isEqualTo(1);
	}

	@Test
	@DisplayName("0~100 밖의 점수는 잘라 넣는다 — 경계값 때문에 덱 전체를 잃지 않는다")
	void clampsScore() {
		RecommendationResponse response = deck("rec_snapshot_score",
			item(book("점수 초과"), 1, 140.0, "TRENDING"), item(book("점수 미만"), 2, -3.0, "TRENDING"));

		snapshots.save(userId, response);

		Long deckId = repository.findOwnedIdByPublicId("rec_snapshot_score", userId).orElseThrow();
		assertThat(jdbc.queryForList("select score from recommendation_items where recommendation_id = ? order by rank",
			Double.class, deckId)).containsExactly(100.0, 0.0);
	}

	// ── 도우미 ──

	private RecommendationResponse deck(String publicId, RecommendationResponse.Item... items) {
		return new RecommendationResponse(publicId, Instant.parse("2026-09-11T00:00:00Z"), "PERSONALIZED", false, 3,
			Map.of("semantic", 0.45, "tagMatch", 0.25), List.of("#소설"), "hybrid-v1", "books-v3", List.of(items));
	}

	private RecommendationResponse.Item item(long bookId, int rank, double score, String reasonType) {
		BookSummaryResponse summary = new BookSummaryResponse(String.valueOf(bookId), null, "제목", List.of("한강"),
			null, null, null, null, null, null);
		return new RecommendationResponse.Item(summary, rank, score,
			List.of(new RecommendationResponse.FeatureScore("semantic", 0.8)), List.of("#소설"),
			reasonType, "테스트 이유");
	}

	private long book(String title) {
		long id = jdbc.queryForObject("insert into books (isbn13, title) values (?, ?) returning id",
			Long.class, uniqueIsbn(), title);
		books.add(id);
		return id;
	}

	/** 한 실행 안에서 절대 겹치지 않게 — nanoTime 만으로는 연속 호출이 같은 값을 낼 수 있다. */
	private static final java.util.concurrent.atomic.AtomicInteger SEQ = new java.util.concurrent.atomic.AtomicInteger();

	private static String uniqueIsbn() {
		long tail = Math.floorMod(System.nanoTime() / 1000 + SEQ.incrementAndGet(), 10_000_000_000L);
		return "978" + String.format("%010d", tail);
	}
}
