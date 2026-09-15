package com.ssafy.b102.recommendation.service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.recommendation.client.AiBookDnaClient;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.dto.BookDnaResponse;
import com.ssafy.b102.user.repository.UserInterestRepository;
import com.ssafy.b102.user.service.UserService;

@Service
public class BookDnaService {

	private static final int MAX_BOOKS = 200;

	private final AiBookDnaClient aiClient;
	private final UserService userService;
	private final UserInterestRepository interestRepository;
	private final LibraryItemRepository libraryRepository;
	private final BookSummaryMapper summaryMapper;
	private final Clock clock;

	public BookDnaService(AiBookDnaClient aiClient, UserService userService,
		UserInterestRepository interestRepository, LibraryItemRepository libraryRepository,
		BookSummaryMapper summaryMapper, Clock clock) {
		this.aiClient = aiClient;
		this.userService = userService;
		this.interestRepository = interestRepository;
		this.libraryRepository = libraryRepository;
		this.summaryMapper = summaryMapper;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public BookDnaResponse getMine(Long userId) {
		userService.getUser(userId);
		List<LibraryItem> books = libraryRepository.findByUser_IdOrderByUpdatedAtDesc(userId).stream()
			.limit(MAX_BOOKS)
			.toList();
		List<String> declaredTags = AiTagCodeMapper.toPublicCodes(interestRepository.findTagCodesByUserId(userId));
		List<AiBookDnaRequest.Book> seeds = books.stream()
			.map(item -> new AiBookDnaRequest.Book(
				item.getBook().getIsbn13(), item.getStatus().name(),
				item.getRating() == null ? null : item.getRating().intValue(), item.getFinishedAt()))
			.toList();
		AiBookDnaRequest request = new AiBookDnaRequest(
			"dna-" + userId + "-" + UUID.randomUUID(), String.valueOf(userId), declaredTags, seeds);
		AiBookDnaResponse ai = aiClient.profile(request);
		return new BookDnaResponse(
			Instant.now(clock), ai.dnaVersion(), ai.modelVersion(), ai.indexVersion(), ai.tagVersion(),
			declaredTags, (int) books.stream().filter(item -> item.getStatus().name().equals("READ")).count(),
			books.stream().map(this::toBook).toList(), toProfile(ai.profile()));
	}

	private BookDnaResponse.Book toBook(LibraryItem item) {
		BookSummaryResponse summary = summaryMapper.from(item.getBook());
		return new BookDnaResponse.Book(summary.bookId(), summary.isbn13(), summary.title(), summary.authors(),
			summary.publisher(), summary.publicationYear(), summary.coverUrl(), summary.pageCount(), summary.category(),
			summary.classNo(), item.getStatus().name(), item.getRating() == null ? null : item.getRating().intValue(),
			item.getFinishedAt());
	}

	private static BookDnaResponse.Profile toProfile(AiBookDnaResponse.Profile profile) {
		if (profile == null) {
			return new BookDnaResponse.Profile("INSUFFICIENT_DATA", 0, List.of(), List.of(), List.of(), null,
				new BookDnaResponse.Evidence(0, 0, List.of(), List.of()));
		}
		return new BookDnaResponse.Profile(profile.status(), profile.basedOnCount(),
			profile.axes().stream().map(BookDnaService::toScore).toList(),
			profile.metrics().stream().map(BookDnaService::toScore).toList(),
			profile.keywords().stream().map(BookDnaService::toScore).toList(), toType(profile.type()),
			toEvidence(profile.evidence()));
	}

	private static BookDnaResponse.Score toScore(AiBookDnaResponse.Score score) {
		return new BookDnaResponse.Score(score.code(), score.label(), score.score());
	}

	private static BookDnaResponse.Type toType(AiBookDnaResponse.Type type) {
		return type == null ? null : new BookDnaResponse.Type(type.code(), type.name(), type.phrase(), type.summary());
	}

	private static BookDnaResponse.Evidence toEvidence(AiBookDnaResponse.Evidence evidence) {
		return evidence == null
			? new BookDnaResponse.Evidence(0, 0, List.of(), List.of())
			: new BookDnaResponse.Evidence(evidence.readBookCount(), evidence.ratedBookCount(), evidence.topGenres(), evidence.topTags());
	}
}
