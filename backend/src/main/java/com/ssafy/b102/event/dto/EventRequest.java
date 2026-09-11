package com.ssafy.b102.event.dto;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * POST /events 요청 본문(API_SPEC §7.1).
 *
 * 필드는 모두 선택이다 — Bean Validation 을 걸지 않는다. 검증 실패도 202 로 받아 버려야 하는데(계약 §4.5),
 * {@code @Valid} 를 붙이면 400 이 나가 화면을 막는다. 필수 조건은 EventType 이 들고 있고 EventService 가 본다.
 */
@Schema(description = "행동 이벤트 한 건. 실패해도 화면을 막지 않는 fire-and-forget 이다")
public record EventRequest(

	@Schema(description = "이벤트 종류", example = "CLICK",
		allowableValues = {"IMPRESSION", "CLICK", "REASON_VIEW", "BOOK_VIEW", "WISH", "DISMISS", "SEARCH"})
	String eventType,

	@Schema(description = "대상 도서. 내부 id 또는 13자리 ISBN13. 카탈로그에 없으면 그 이벤트는 버린다", example = "88123")
	String bookId,

	@Schema(description = "추천 응답의 recommendationId 그대로. 저장된 덱과 이어 붙여 「보여줬는데 안 눌렀다」를 계산한다",
		example = "rec_3f9c1a20b7d84e55")
	String recommendationId,

	@Schema(description = "서버가 매긴 추천 순위. 응답 items[].rank 그대로", example = "3")
	Integer rank,

	@Schema(description = """
		화면에서 실제로 보인 자리(1부터). `rank` 와 다르다 — 추천 화면은 덱을 태그 겹침으로 재정렬한 뒤 앞 5장만 편다.
		위치 편향을 보정하려면 서버 순위가 아니라 이 값이 필요하다""", example = "1")
	Integer position,

	@Schema(description = "이벤트가 난 화면", example = "RECOMMEND",
		allowableValues = {"RECOMMEND", "HOME", "SEARCH", "DETAIL", "LIBRARY", "ONBOARDING"})
	String context,

	@Schema(description = "한 번의 방문을 묶는 클라이언트 생성 키(UUID). 검색 → 상세 → 찜 처럼 이어진 행동을 볼 수 있다")
	String sessionId,

	@Schema(description = "SEARCH 의 질의어. payload.query 에 들어간다", example = "한강")
	String query,

	@Schema(description = "SEARCH 의 결과 건수. payload.resultCount", example = "42")
	Integer resultCount,

	@Schema(description = "BOOK_VIEW 의 체류 시간(ms). payload.dwellMs — 실수 클릭과 정독을 가른다", example = "4200")
	Long dwellMs,

	@Schema(description = "클라이언트 발생 시각(ISO-8601). 없거나 미래면 서버 수신 시각으로 대체한다",
		example = "2026-09-11T03:12:44.120Z")
	Instant occurredAt,

	@Schema(description = """
		재전송 중복 방지 키(UUID 권장). `(userId, clientEventId)` 가 같은 두 번째 요청은 조용히 버린다.
		StrictMode 이중 마운트·뒤로가기 재진입으로 같은 노출이 두 번 날아오므로 **항상 채워 보내는 것을 권한다**""")
	String clientEventId
) {
}
