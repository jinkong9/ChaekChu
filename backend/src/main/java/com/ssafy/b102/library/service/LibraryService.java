package com.ssafy.b102.library.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.dto.LibraryAddRequest;
import com.ssafy.b102.library.dto.LibraryItemResponse;
import com.ssafy.b102.library.dto.LibraryListResponse;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.service.UserService;

/** 서재 — API_SPEC §6. 본인 행만 다룬다(userId 는 JWT 에서). */
@Service
public class LibraryService {

	/**
	 * 완독일「오늘」의 기준 시간대(09-10 확정). Clock 빈은 UTC 라 그대로 쓰면 한국 새벽(00~09시)에 READ 로 바꿀 때 전날이 들어간다.
	 * finished_at 은 DATE 라 저장 뒤에는 시간대 변환이 없다.
	 */
	static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	private final LibraryItemRepository libraryItemRepository;
	private final BookRepository bookRepository;
	private final UserService userService;
	private final Clock clock;

	public LibraryService(LibraryItemRepository libraryItemRepository, BookRepository bookRepository,
		UserService userService, Clock clock) {
		this.libraryItemRepository = libraryItemRepository;
		this.bookRepository = bookRepository;
		this.userService = userService;
		this.clock = clock;
	}

	/** §6.1 — status 가 null 이면 전체. updatedAt 내림차순, 페이지 없음. 서재가 비었으면 빈 목록. */
	@Transactional(readOnly = true)
	public LibraryListResponse getMine(Long userId, ShelfStatus status) {
		List<LibraryItem> items = status == null
			? libraryItemRepository.findByUser_IdOrderByUpdatedAtDesc(userId)
			: libraryItemRepository.findByUser_IdAndStatusOrderByUpdatedAtDesc(userId, status);
		return new LibraryListResponse(items.stream().map(LibraryItemResponse::from).toList());
	}

	/**
	 * §6.2 — 담기. 순서: status 검증(400) → 책 존재(404) → 이미 있음(409 + libraryItemId) → 저장.
	 * READ 면 finished_at = 오늘(Asia/Seoul), WISH 면 null. source=SERVICE. 별점·감상은 받지 않는다(PATCH).
	 */
	@Transactional
	public LibraryItemResponse add(Long userId, LibraryAddRequest req) {
		ShelfStatus status = parseStatus(req.status());
		Long bookId = parseBookId(req.bookId());
		Book book = bookRepository.findById(bookId)
			.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", String.valueOf(bookId))));

		libraryItemRepository.findByUserIdAndBookId(userId, bookId).ifPresent(existing -> {
			throw new BusinessException(ErrorCode.LIBRARY_ITEM_EXISTS, Map.of("libraryItemId", String.valueOf(existing.getId())));
		});

		User user = userService.getUser(userId);
		LocalDate finishedAt = status == ShelfStatus.READ ? today() : null;
		try {
			LibraryItem saved = libraryItemRepository.saveAndFlush(LibraryItem.serviceEntry(user, book, status, finishedAt));
			return LibraryItemResponse.from(saved);
		}
		catch (DataIntegrityViolationException e) {
			// 같은 책을 거의 동시에 두 번 담은 경합(uq_ul_user_book). 트랜잭션이 이미 깨져 상대 행의 id 는 여기서 못 읽는다 — 프론트는 GET /library/me 로 찾는다.
			throw new BusinessException(ErrorCode.LIBRARY_ITEM_EXISTS);
		}
	}

	private LocalDate today() {
		return LocalDate.now(clock.withZone(SEOUL));
	}

	/** WISH/READ 만. 대소문자·공백은 관대하게(온보딩 gender 와 같은 태도). 그 외(READING 등)는 400 fields[status]. */
	private static ShelfStatus parseStatus(String raw) {
		try {
			return ShelfStatus.valueOf(raw.strip().toUpperCase());
		}
		catch (IllegalArgumentException e) {
			throw new BusinessException(ErrorCode.VALIDATION_FAILED,
				Map.of("fields", List.of(Map.of("field", "status", "reason", "status 는 WISH 또는 READ 입니다."))));
		}
	}

	/** bookId 는 내부 id 문자열. 숫자가 아니면 없는 책과 같이 404(온보딩과 동일). */
	private static Long parseBookId(String raw) {
		try {
			return Long.valueOf(raw.strip());
		}
		catch (NumberFormatException e) {
			throw new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", raw));
		}
	}
}
