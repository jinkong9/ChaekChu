package com.ssafy.b102.event.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.event.dto.EventRequest;
import com.ssafy.b102.event.service.EventService;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * API_SPEC §7 — 행동 이벤트 수집. 저장된 추천 스냅샷과 이어 붙여 개인화의 재료가 된다.
 */
@Tag(name = "이벤트", description = """
	화면에서 일어난 행동을 한 건씩 받는다. 쌓인 기록은 두 가지에 쓴다 —
	개인화 입력(`seedIsbns` 보강 · `excludeIsbns` · 태그 가중치)과 추천 품질 측정(덱 CTR · 이유 유형별 클릭률).""")
@RestController
@RequestMapping(ApiPaths.V1 + "/events")
public class EventController {

	private final EventService eventService;

	public EventController(EventService eventService) {
		this.eventService = eventService;
	}

	@Operation(summary = "행동 이벤트 기록", description = """
		**언제나 202 다.** 본문이 비었든, 종류를 모르든, 없는 책이든 오류를 내지 않는다 — 이벤트가 화면을 막으면 안 된다(계약 §4.5).
		조건을 못 채운 이벤트는 조용히 버린다. 즉 202 는 「받았다」이지 「저장했다」가 아니다.

		종류별로 없으면 버리는 값:
		`IMPRESSION`·`REASON_VIEW` 는 `recommendationId`, `CLICK`·`BOOK_VIEW`·`WISH`·`DISMISS`·`REASON_VIEW` 는 `bookId`,
		`SEARCH` 는 `query`. `bookId` 는 카탈로그에 있어야 한다(내부 id 또는 ISBN13).

		**`clientEventId` 를 꼭 채워 보내길 권한다.** `(userId, clientEventId)` 로 중복을 제거한다 —
		React StrictMode 이중 마운트와 뒤로가기 재진입 때문에 같은 노출이 두 번 날아온다.

		**`position` 은 `rank` 와 다르다.** `rank` 는 서버가 매긴 순위이고 `position` 은 화면에서 실제로 보인 자리다.
		추천 화면이 덱을 태그 겹침으로 재정렬한 뒤 앞 5장만 펴므로, 두 값이 같다고 가정하면 위치 편향 보정이 틀어진다.
		카드 단위 `IMPRESSION`(bookId + position)을 함께 보내 주면 「보여줬는데 안 눌렀다」를 계산할 수 있다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "202", description = "받았다. 본문 없음. 저장 여부는 알려주지 않는다"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED — 비회원 이벤트는 받지 않는다",
			content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@PostMapping
	@ResponseStatus(HttpStatus.ACCEPTED)
	public void record(@CurrentUserId Long userId, @RequestBody(required = false) EventRequest request) {
		eventService.record(userId, request);
	}
}
