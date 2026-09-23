package com.ssafy.b102.recommendation.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.recommendation.dto.WorldCupPickRequest;
import com.ssafy.b102.recommendation.dto.WorldCupSessionResponse;
import com.ssafy.b102.recommendation.repository.BookWorldCupRepository;
import com.ssafy.b102.recommendation.repository.BookWorldCupRepository.Candidate;
import com.ssafy.b102.recommendation.repository.BookWorldCupRepository.SessionRow;

/**
 * Server-side bracket: public matchup data never contains canonical identity before the champion is decided.
 *
 * 응답 필드의 뜻(프론트 api/dna.ts · MSW handlers 와 같은 정의, 09-23 고정):
 *   roundSize      = 처음 편성된 인원(항상 16). 라운드가 바뀌어도 변하지 않는다. 지금 라운드 인원은 roundSize >> (roundNumber - 1)
 *   roundNumber    = 1(16강) · 2(8강) · 3(준결승) · 4(결승)
 *   matchNumber    = 이 라운드에서 몇 번째 대진인가(1부터) · matchesInRound = 이 라운드의 대진 수(8·4·2·1)
 *   COMPLETED 이면 roundSize 는 그대로 16, matchNumber·matchesInRound 는 0, choices 는 빈 배열, champion 만 채운다.
 * 예전에는 라운드마다 roundSize 를 현재 인원으로 갱신해 프론트가 「8강」을 「준결승」으로, 우승 화면의 선택 횟수를 -1 로 그렸다.
 */
@Service
public class BookWorldCupService {
	static final int BRACKET_SIZE = 16;
	private static final Duration SESSION_TTL = Duration.ofHours(24);
	private static final TypeReference<List<Participant>> PARTICIPANTS = new TypeReference<>() { };

	private final BookWorldCupRepository repository;
	private final BookRepository bookRepository;
	private final BookSummaryMapper summaryMapper;
	private final ObjectMapper objectMapper;
	private final Clock clock;

	public BookWorldCupService(BookWorldCupRepository repository, BookRepository bookRepository,
		BookSummaryMapper summaryMapper, ObjectMapper objectMapper, Clock clock) {
		this.repository = repository;
		this.bookRepository = bookRepository;
		this.summaryMapper = summaryMapper;
		this.objectMapper = objectMapper;
		this.clock = clock;
	}

	@Transactional
	public WorldCupSessionResponse create(long userId) {
		Instant now = Instant.now(clock);
		repository.deleteExpiredSessions(now);
		List<Candidate> candidates = repository.sampleCandidates(BRACKET_SIZE);
		if (candidates.size() < BRACKET_SIZE) {
			throw new BusinessException(ErrorCode.WORLD_CUP_UNAVAILABLE);
		}
		List<Participant> participants = candidates.stream()
			.map(candidate -> new Participant(UUID.randomUUID().toString(), candidate.isbn13())).toList();
		UUID sessionId = UUID.randomUUID();
		Instant expiresAt = now.plus(SESSION_TTL);
		repository.insertSession(sessionId, userId, BRACKET_SIZE, write(participants), expiresAt);
		return response(sessionId, "IN_PROGRESS", BRACKET_SIZE, 1, 0, participants, null);
	}

	@Transactional
	public WorldCupSessionResponse pick(long userId, UUID sessionId, WorldCupPickRequest request) {
		SessionRow row = repository.findOwnedForUpdate(sessionId, userId)
			.orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND));
		Instant now = Instant.now(clock);
		if (row.expiresAt().isBefore(now) || !"IN_PROGRESS".equals(row.status())) {
			throw new BusinessException(ErrorCode.NOT_FOUND);
		}
		List<Participant> participants = read(row.participantsJson());
		List<Participant> winners = new ArrayList<>(read(row.winnersJson()));
		int first = row.matchIndex() * 2;
		if (first + 1 >= participants.size()) {
			throw new BusinessException(ErrorCode.NOT_FOUND);
		}
		Participant left = participants.get(first);
		Participant right = participants.get(first + 1);
		Participant picked = request.choiceId().equals(left.choiceId()) ? left
			: request.choiceId().equals(right.choiceId()) ? right : null;
		if (picked == null) {
			throw new BusinessException(ErrorCode.VALIDATION_FAILED);
		}
		winners.add(picked);
		String status = "IN_PROGRESS";
		int roundSize = row.roundSize();   // 편성 인원(16) — 라운드가 바뀌어도 유지한다
		int roundNumber = row.roundNumber();
		int matchIndex = row.matchIndex();
		List<Participant> nextParticipants = participants;
		List<Participant> nextWinners = winners;
		String championIsbn13 = null;
		if (matchIndex + 1 < participants.size() / 2) {
			matchIndex++;
		} else if (winners.size() == 1) {
			status = "COMPLETED";
			championIsbn13 = winners.getFirst().isbn13();
			nextWinners = List.of();
		} else {
			nextParticipants = List.copyOf(winners);
			nextWinners = List.of();
			roundNumber++;
			matchIndex = 0;
		}
		repository.updateSession(sessionId, status, roundSize, roundNumber, matchIndex,
			write(nextParticipants), write(nextWinners), championIsbn13);
		return response(sessionId, status, roundSize, roundNumber, matchIndex, nextParticipants, championIsbn13);
	}

	private WorldCupSessionResponse response(UUID id, String status, int roundSize, int roundNumber, int matchIndex,
		List<Participant> participants, String championIsbn13) {
		if ("COMPLETED".equals(status)) {
			Book champion = bookRepository.findByIsbn13(championIsbn13)
				.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND));
			// roundSize 는 편성 인원 그대로 — 프론트가 「(roundSize - 1)번의 선택」으로 쓴다
			return new WorldCupSessionResponse(id, status, roundSize, roundNumber, 0, 0, List.of(), summaryMapper.from(champion));
		}
		int first = matchIndex * 2;
		List<WorldCupSessionResponse.Choice> choices = List.of(choice(participants.get(first)), choice(participants.get(first + 1)));
		return new WorldCupSessionResponse(id, status, roundSize, roundNumber, matchIndex + 1,
			participants.size() / 2, choices, null);   // 대진 수는 이 라운드 인원에서 — roundSize/2 는 16강에서만 맞았다
	}

	private WorldCupSessionResponse.Choice choice(Participant participant) {
		String synopsis = repository.findSynopsis(participant.isbn13())
			.orElseThrow(() -> new BusinessException(ErrorCode.WORLD_CUP_UNAVAILABLE));
		return new WorldCupSessionResponse.Choice(participant.choiceId(), synopsis);
	}

	private List<Participant> read(String json) {
		try {
			return objectMapper.readValue(json, PARTICIPANTS);
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("월드컵 세션 상태가 손상되었습니다", e);
		}
	}

	private String write(List<Participant> value) {
		try {
			return objectMapper.writeValueAsString(value);
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("월드컵 세션 상태를 저장할 수 없습니다", e);
		}
	}

	public record Participant(String choiceId, String isbn13) { }
}
