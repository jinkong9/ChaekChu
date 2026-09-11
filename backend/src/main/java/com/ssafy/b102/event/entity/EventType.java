package com.ssafy.b102.event.entity;

import java.util.Optional;

/**
 * 행동 이벤트 종류(API_SPEC §7.1, DDL ck_ua_type).
 *
 * 타입마다 「이것이 없으면 아무 뜻도 없는 값」이 다르다 — 그 조건을 여기 붙여 둔다.
 * 조건을 못 채운 이벤트는 저장하지 않고 버린다(응답은 그래도 202). 반쪽짜리 행이 쌓이면 분모·분자가 모두 틀어진다.
 */
public enum EventType {

	/** 추천 덱 노출. 덱 단위(recommendationId 만) 와 카드 단위(+bookId·position) 둘 다 받는다. */
	IMPRESSION(true, false),

	/** 추천·홈에서 도서 상세로 진입. */
	CLICK(false, true),

	/** 추천 이유 펼침. */
	REASON_VIEW(true, true),

	/** 도서 상세 열람. payload.dwellMs 로 체류 시간을 함께 받는다. */
	BOOK_VIEW(false, true),

	/** 찜 등록. 개인화의 정본은 user_library 이고 이 이벤트는 「어느 화면에서 담았나」를 센다. */
	WISH(false, true),

	/** 카드를 넘기거나 다른 책으로 바꿔 꺼냄 = 유일한 부정 신호. exclude 후보의 원천. */
	DISMISS(false, true),

	/** 검색 실행. payload.query 에 질의어. 가장 강한 의도 신호라 책과 무관하게 남긴다. */
	SEARCH(false, false);

	private final boolean recommendationRequired;
	private final boolean bookRequired;

	EventType(boolean recommendationRequired, boolean bookRequired) {
		this.recommendationRequired = recommendationRequired;
		this.bookRequired = bookRequired;
	}

	public boolean isRecommendationRequired() {
		return recommendationRequired;
	}

	public boolean isBookRequired() {
		return bookRequired;
	}

	/** 모르는 값이면 비어 있다 — 프론트가 새 타입을 먼저 보내도 서버가 500 을 내지 않게. */
	public static Optional<EventType> parse(String raw) {
		if (raw == null) {
			return Optional.empty();
		}
		try {
			return Optional.of(valueOf(raw.strip().toUpperCase()));
		}
		catch (IllegalArgumentException e) {
			return Optional.empty();
		}
	}
}
