package com.ssafy.b102.recommendation.dto;

import java.util.List;
import java.util.UUID;

import com.ssafy.b102.book.dto.BookSummaryResponse;

/** 선택 중에는 무작위 choiceId와 소개문만 제공한다. 우승이 정해진 뒤에만 canonical 도서 정보를 포함한다. */
public record WorldCupSessionResponse(
	UUID sessionId,
	String status,
	int roundSize,
	int roundNumber,
	int matchNumber,
	int matchesInRound,
	List<Choice> choices,
	BookSummaryResponse champion
) {
	public record Choice(String choiceId, String synopsis) {
	}
}
