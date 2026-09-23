package com.ssafy.b102.recommendation.dto;

import java.util.List;
import java.util.UUID;

import com.ssafy.b102.book.dto.BookSummaryResponse;

/**
 * 선택 중에는 무작위 choiceId와 소개문만 제공한다. 우승이 정해진 뒤에만 canonical 도서 정보를 포함한다.
 * roundSize 는 처음 편성된 인원(16)으로 고정 — 지금 라운드 인원은 roundSize >> (roundNumber - 1) (프론트 api/dna.ts 와 같은 정의).
 */
public record WorldCupSessionResponse(
	UUID sessionId,
	String status,
	/** 편성 인원. 항상 16, COMPLETED 여도 그대로 */
	int roundSize,
	/** 1=16강 · 2=8강 · 3=준결승 · 4=결승 */
	int roundNumber,
	/** 이 라운드의 몇 번째 대진(1부터). COMPLETED 면 0 */
	int matchNumber,
	/** 이 라운드의 대진 수 8·4·2·1. COMPLETED 면 0 */
	int matchesInRound,
	List<Choice> choices,
	BookSummaryResponse champion
) {
	public record Choice(String choiceId, String synopsis) {
	}
}
