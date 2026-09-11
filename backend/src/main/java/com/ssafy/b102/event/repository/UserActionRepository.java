package com.ssafy.b102.event.repository;

import java.sql.Timestamp;
import java.time.Instant;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * 행동 이벤트 쓰기 — V1 user_actions(V3 로 display_position · session_id · payload 추가).
 *
 * 트랜잭션을 열지 않는다. 요청당 INSERT 한 문장이라 열 이유가 없고, 열어 두면 실패를 삼켜도
 * rollback-only 로 표시된 트랜잭션이 커밋 시점에 다시 터진다 — 이벤트가 화면을 막으면 안 된다(계약 §4.5).
 */
@Repository
public class UserActionRepository {

	private final JdbcClient jdbc;

	public UserActionRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/**
	 * 한 건 저장. 같은 {@code (user_id, client_event_id)} 가 이미 있으면 0 을 돌려주고 아무것도 하지 않는다(uq_ua_client).
	 * clientEventId 가 null 이면 유니크 대상이 아니라 항상 들어간다 — 중복 제거는 프론트가 키를 줄 때만 동작한다.
	 */
	public int insert(long userId, Long bookId, Long recommendationId, String eventType, Integer rank,
		Integer displayPosition, String context, String sessionId, String payloadJson, String clientEventId,
		Instant occurredAt) {
		return jdbc.sql("""
				insert into user_actions
				    (user_id, book_id, recommendation_id, event_type, rank, display_position,
				     context, session_id, payload, client_event_id, occurred_at)
				values
				    (:userId, :bookId, :recommendationId, :eventType, :rank, :displayPosition,
				     :context, :sessionId, cast(:payload as jsonb), :clientEventId, :occurredAt)
				on conflict (user_id, client_event_id) do nothing""")
			.param("userId", userId)
			.param("bookId", bookId)
			.param("recommendationId", recommendationId)
			.param("eventType", eventType)
			.param("rank", rank)
			.param("displayPosition", displayPosition)
			.param("context", context)
			.param("sessionId", sessionId)
			.param("payload", payloadJson)
			.param("clientEventId", clientEventId)
			.param("occurredAt", Timestamp.from(occurredAt))
			.update();
	}
}
