package com.ssafy.b102.library.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
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
import com.ssafy.b102.library.dto.LibraryPatchRequest;
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
	/** review_text VARCHAR(300) · 계약 §4.3. */
	static final int REVIEW_MAX = 300;

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
		ShelfStatus status = parseStatus(req.status())
			.orElseThrow(() -> validationFailed(List.of(field("status", "status 는 WISH 또는 READ 입니다."))));
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

	/**
	 * §6.3 — 부분 갱신. 보낸 필드만 바꾼다.
	 * status: WISH 로 바꾸면 완독일 null · WISH→READ 면 완독일 = 보낸 값(없으면 Asia/Seoul 오늘) · 이미 READ 인데 READ 를 다시 보내면 유지(멱등).
	 * finishedDate: status 없이 보내면 READ 항목에 한해 반영(null 이면 지움), WISH 항목은 무시.
	 * rating: 1~5 또는 null(삭제). reviewText: strip, 빈 값→null(삭제), 300자 초과 400.
	 * 없는 항목 404, 타인 항목 403. 검증 위반은 모아서 한 번에 400(fields[]).
	 */
	@Transactional
	public LibraryItemResponse patch(Long userId, String rawItemId, LibraryPatchRequest req) {
		LibraryItem item = ownedItem(userId, rawItemId);

		List<Map<String, String>> fields = new ArrayList<>();
		ShelfStatus newStatus = null;
		if (req.getStatus() != null) {
			newStatus = parseStatus(req.getStatus()).orElse(null);
			if (newStatus == null) {
				fields.add(field("status", "status 는 WISH 또는 READ 입니다."));
			}
		}
		if (req.isRatingSent() && req.getRating() != null && (req.getRating() < 1 || req.getRating() > 5)) {
			fields.add(field("rating", "별점은 1~5 입니다."));
		}
		String review = null;
		if (req.isReviewTextSent()) {
			review = normalizeReview(req.getReviewText());
			if (review != null && review.length() > REVIEW_MAX) {
				fields.add(field("reviewText", "감상은 " + REVIEW_MAX + "자 이내입니다."));
			}
		}
		LocalDate finishedDate = null;
		if (req.isFinishedDateSent() && req.getFinishedDate() != null) {
			try {
				finishedDate = LocalDate.parse(req.getFinishedDate().strip());
			}
			catch (DateTimeParseException e) {
				fields.add(field("finishedDate", "완독일은 yyyy-MM-dd 형식입니다."));
			}
		}
		if (!fields.isEmpty()) {
			throw validationFailed(fields);
		}

		if (newStatus == ShelfStatus.WISH) {
			item.markWish();
		}
		else if (newStatus == ShelfStatus.READ && item.getStatus() != ShelfStatus.READ) {
			item.markRead(req.isFinishedDateSent() ? finishedDate : today());
		}
		else if (req.isFinishedDateSent()) {
			item.updateFinishedAt(finishedDate);   // READ 항목에 한해 — 엔티티가 WISH 면 무시한다
		}
		if (req.isRatingSent()) {
			item.updateRating(req.getRating());
		}
		if (req.isReviewTextSent()) {
			item.updateReviewText(review);
		}

		libraryItemRepository.flush();   // @UpdateTimestamp 를 응답에 반영
		return LibraryItemResponse.from(item);
	}

	/** §6.4 — 서재에서 빼기(찜 해제 포함). 없는 항목 404, 타인 항목 403. */
	@Transactional
	public void delete(Long userId, String rawItemId) {
		libraryItemRepository.delete(ownedItem(userId, rawItemId));
		libraryItemRepository.flush();   // 204 를 돌려주기 전에 실제로 지운다(제약 위반이면 여기서 터진다)
	}

	/** libraryItemId 는 불투명 문자열. 숫자가 아니거나 없으면 404, 있는데 남의 것이면 403. */
	private LibraryItem ownedItem(Long userId, String rawItemId) {
		Long itemId;
		try {
			itemId = Long.valueOf(rawItemId.strip());
		}
		catch (NumberFormatException e) {
			throw new BusinessException(ErrorCode.LIBRARY_ITEM_NOT_FOUND, Map.of("libraryItemId", rawItemId));
		}
		LibraryItem item = libraryItemRepository.findById(itemId)
			.orElseThrow(() -> new BusinessException(ErrorCode.LIBRARY_ITEM_NOT_FOUND, Map.of("libraryItemId", rawItemId)));
		if (!item.getUser().getId().equals(userId)) {   // LAZY 프록시의 getId 는 초기화 없이 읽힌다
			throw new BusinessException(ErrorCode.FORBIDDEN, Map.of("libraryItemId", rawItemId));
		}
		return item;
	}

	private LocalDate today() {
		return LocalDate.now(clock.withZone(SEOUL));
	}

	/** 앞뒤 공백 제거, 빈 값이면 null(삭제). CHECK ck_ul_review(공백만 금지)와 맞춘다. */
	private static String normalizeReview(String raw) {
		if (raw == null) {
			return null;
		}
		String stripped = raw.strip();
		return stripped.isEmpty() ? null : stripped;
	}

	/** WISH/READ 만. 대소문자·공백은 관대하게(온보딩 gender 와 같은 태도). 그 외(READING 등)는 empty. */
	private static java.util.Optional<ShelfStatus> parseStatus(String raw) {
		try {
			return java.util.Optional.of(ShelfStatus.valueOf(raw.strip().toUpperCase()));
		}
		catch (IllegalArgumentException e) {
			return java.util.Optional.empty();
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

	private static BusinessException validationFailed(List<Map<String, String>> fields) {
		return new BusinessException(ErrorCode.VALIDATION_FAILED, Map.of("fields", fields));
	}

	private static Map<String, String> field(String field, String reason) {
		return Map.of("field", field, "reason", reason);
	}
}
