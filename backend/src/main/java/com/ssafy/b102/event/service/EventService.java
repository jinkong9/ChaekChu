package com.ssafy.b102.event.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.book.service.BookIdentifiers;
import com.ssafy.b102.event.dto.EventRequest;
import com.ssafy.b102.event.entity.EventType;
import com.ssafy.b102.event.repository.UserActionRepository;
import com.ssafy.b102.recommendation.repository.RecommendationSnapshotRepository;

/**
 * 행동 이벤트 수집(API_SPEC §7).
 *
 * 규칙 하나: <b>절대 던지지 않는다.</b> 이벤트는 화면을 막으면 안 되므로(계약 §4.5) 컨트롤러는 무조건 202 를 준다.
 * 대신 조건을 못 채운 이벤트는 저장하지 않는다 — 200 을 주고 반쪽짜리 행을 쌓으면 나중에 CTR 분모가 조용히 틀어진다.
 * 무엇을 왜 버렸는지는 debug 로그에 남긴다.
 *
 * 정규화 기준은 컬럼 폭이다. 길면 자르고(자르면 최소한 그 이벤트는 산다), 범위를 벗어난 숫자는 null 로 떨군다.
 */
@Service
public class EventService {

	/** 컬럼 폭(V1·V3). 넘치면 자른다 — 이벤트 한 건 때문에 22001 로 실패시키지 않는다. */
	private static final int CONTEXT_MAX = 20;
	private static final int SESSION_MAX = 36;
	private static final int CLIENT_EVENT_MAX = 64;
	/** payload 는 JSONB 라 제한이 없지만, 질의어는 분석에 쓸 만큼만 남긴다. */
	private static final int QUERY_MAX = 200;
	private static final int RANK_MAX = Short.MAX_VALUE;
	/** 하루를 넘는 체류 시간은 탭을 열어 둔 것이지 읽은 것이 아니다. */
	private static final Duration DWELL_MAX = Duration.ofDays(1);
	/** 클라이언트 시계가 앞설 수 있다. 이 이상 미래면 서버 시각으로 바꾼다. */
	private static final Duration CLOCK_SKEW_MAX = Duration.ofMinutes(5);

	private static final Logger log = LoggerFactory.getLogger(EventService.class);

	private final UserActionRepository userActions;
	private final BookRepository bookRepository;
	private final RecommendationSnapshotRepository snapshots;
	private final ObjectMapper objectMapper;
	private final Clock clock;

	public EventService(UserActionRepository userActions, BookRepository bookRepository,
		RecommendationSnapshotRepository snapshots, ObjectMapper objectMapper, Clock clock) {
		this.userActions = userActions;
		this.bookRepository = bookRepository;
		this.snapshots = snapshots;
		this.objectMapper = objectMapper;
		this.clock = clock;
	}

	public void record(Long userId, EventRequest request) {
		if (request == null) {
			return;
		}
		Optional<EventType> parsed = EventType.parse(request.eventType());
		if (parsed.isEmpty()) {
			log.debug("알 수 없는 이벤트 종류라 버린다: {}", request.eventType());
			return;
		}
		EventType type = parsed.get();

		Long bookId = resolveBook(request.bookId());
		if (type.isBookRequired() && bookId == null) {
			log.debug("{} 인데 도서를 찾을 수 없어 버린다: {}", type, request.bookId());
			return;
		}
		String publicRecommendationId = trimToNull(request.recommendationId());
		if (type.isRecommendationRequired() && publicRecommendationId == null) {
			log.debug("{} 인데 recommendationId 가 없어 버린다", type);
			return;
		}
		String query = truncate(trimToNull(request.query()), QUERY_MAX);
		if (type == EventType.SEARCH && query == null) {
			log.debug("SEARCH 인데 질의어가 없어 버린다");
			return;
		}

		// 본인 덱이 저장돼 있을 때만 잇는다. 없으면 null — 책 단위 신호는 살아 있으니 덱 연결만 포기하는 편이 이벤트를 버리는 것보다 낫다.
		Long recommendationId = publicRecommendationId == null ? null
			: snapshots.findOwnedIdByPublicId(publicRecommendationId, userId).orElse(null);
		if (publicRecommendationId != null && recommendationId == null) {
			log.debug("본인 덱을 찾을 수 없어 recommendationId 를 비운다: {}", publicRecommendationId);
		}

		try {
			int inserted = userActions.insert(userId, bookId, recommendationId, type.name(),
				boundedRank(request.rank()), boundedRank(request.position()),
				truncate(upper(request.context()), CONTEXT_MAX),
				truncate(trimToNull(request.sessionId()), SESSION_MAX),
				payload(query, request.resultCount(), request.dwellMs()),
				truncate(trimToNull(request.clientEventId()), CLIENT_EVENT_MAX),
				occurredAt(request.occurredAt()));
			if (inserted == 0) {
				log.debug("이미 받은 이벤트라 버린다: {} {}", type, request.clientEventId());
			}
		}
		catch (DataAccessException e) {
			log.warn("이벤트 저장 실패 {} — 요청은 성공으로 응답한다: {}", type, e.toString());
		}
	}

	/** 내부 id 든 ISBN13 이든 카탈로그에 있는 책만. 없으면 null — 없는 책의 행동은 분석에 쓸 수 없다. */
	private Long resolveBook(String raw) {
		String id = BookIdentifiers.normalize(raw);
		if (id.isEmpty()) {
			return null;
		}
		if (BookIdentifiers.isIsbn13(id)) {
			return bookRepository.findIdByIsbn13(id).orElse(null);
		}
		Long internalId = BookIdentifiers.asInternalId(id);
		return internalId != null && bookRepository.existsById(internalId) ? internalId : null;
	}

	/** 타입마다 다른 값은 전부 여기로. 빈 값은 키 자체를 넣지 않는다 — 나중에 `payload ? 'query'` 로 거르기 위해서다. */
	private String payload(String query, Integer resultCount, Long dwellMs) {
		Map<String, Object> payload = new LinkedHashMap<>();
		if (query != null) {
			payload.put("query", query);
		}
		if (resultCount != null && resultCount >= 0) {
			payload.put("resultCount", resultCount);
		}
		if (dwellMs != null && dwellMs > 0 && dwellMs <= DWELL_MAX.toMillis()) {
			payload.put("dwellMs", dwellMs);
		}
		if (payload.isEmpty()) {
			return "{}";
		}
		try {
			return objectMapper.writeValueAsString(payload);
		}
		catch (JsonProcessingException e) {
			log.warn("이벤트 payload 직렬화 실패 — 빈 값으로 저장한다: {}", e.toString());
			return "{}";
		}
	}

	/** 클라이언트 시각을 믿되 앞선 시계만 고친다. 늦게 도착한 이벤트(과거 시각)는 그대로 둬야 순서가 살아 있다. */
	private Instant occurredAt(Instant occurredAt) {
		Instant now = Instant.now(clock);
		if (occurredAt == null || occurredAt.isAfter(now.plus(CLOCK_SKEW_MAX))) {
			return now;
		}
		return occurredAt;
	}

	private static Integer boundedRank(Integer value) {
		return value == null || value < 1 || value > RANK_MAX ? null : value;
	}

	private static String upper(String value) {
		String trimmed = trimToNull(value);
		return trimmed == null ? null : trimmed.toUpperCase();
	}

	private static String trimToNull(String value) {
		if (value == null) {
			return null;
		}
		String trimmed = value.strip();
		return trimmed.isEmpty() ? null : trimmed;
	}

	private static String truncate(String value, int max) {
		return value == null || value.length() <= max ? value : value.substring(0, max);
	}
}
