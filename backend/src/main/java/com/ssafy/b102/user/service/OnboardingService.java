package com.ssafy.b102.user.service;

import java.time.Clock;
import java.time.Year;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.repository.LibraryItemRepository;
import com.ssafy.b102.user.dto.PreferencesRequest;
import com.ssafy.b102.user.dto.ProfileRequest;
import com.ssafy.b102.user.entity.Gender;
import com.ssafy.b102.user.entity.Tag;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.entity.UserInterest;
import com.ssafy.b102.user.repository.TagRepository;
import com.ssafy.b102.user.repository.UserInterestRepository;

/** 온보딩 0단계(프로필)·2단계(취향) — API_SPEC §3.2·§3.3. */
@Service
public class OnboardingService {

	static final int NICKNAME_MIN = 2;
	static final int NICKNAME_MAX = 20;
	static final int BIRTH_YEAR_MIN = 1900;
	static final int MAX_GENRES = 5;
	static final String GENRE_KIND = "GENRE";

	private final UserService userService;
	private final TagRepository tagRepository;
	private final UserInterestRepository userInterestRepository;
	private final BookRepository bookRepository;
	private final LibraryItemRepository libraryItemRepository;
	private final Clock clock;

	public OnboardingService(UserService userService, TagRepository tagRepository,
		UserInterestRepository userInterestRepository, BookRepository bookRepository,
		LibraryItemRepository libraryItemRepository, Clock clock) {
		this.userService = userService;
		this.tagRepository = tagRepository;
		this.userInterestRepository = userInterestRepository;
		this.bookRepository = bookRepository;
		this.libraryItemRepository = libraryItemRepository;
		this.clock = clock;
	}

	/** 닉네임(공백 제거 2~20자) · 출생연도(null 또는 1900~올해) · 성별(F/M/null). 멱등 덮어쓰기. 온보딩 상태는 바꾸지 않는다. */
	@Transactional
	public void saveProfile(Long userId, ProfileRequest req) {
		List<Map<String, String>> fields = new ArrayList<>();

		String nickname = req.nickname() == null ? "" : req.nickname().strip();
		if (nickname.length() < NICKNAME_MIN || nickname.length() > NICKNAME_MAX) {
			fields.add(field("nickname", "닉네임은 공백을 제외하고 " + NICKNAME_MIN + "~" + NICKNAME_MAX + "자여야 합니다."));
		}

		Integer birthYear = req.birthYear();
		int thisYear = Year.now(clock).getValue();
		if (birthYear != null && (birthYear < BIRTH_YEAR_MIN || birthYear > thisYear)) {
			fields.add(field("birthYear", "출생연도는 " + BIRTH_YEAR_MIN + "~" + thisYear + " 사이이거나 비워야 합니다(0·빈 값은 null 로)."));
		}

		Gender gender = null;
		String rawGender = req.gender() == null ? "" : req.gender().strip();
		if (!rawGender.isEmpty()) {
			try {
				gender = Gender.valueOf(rawGender.toUpperCase(Locale.ROOT));
			}
			catch (IllegalArgumentException e) {
				fields.add(field("gender", "성별은 F, M 또는 null 이어야 합니다."));
			}
		}

		if (!fields.isEmpty()) {
			throw new BusinessException(ErrorCode.VALIDATION_FAILED, Map.of("fields", fields));
		}

		User user = userService.getUser(userId);
		user.updateProfile(nickname, birthYear, gender);
	}

	/**
	 * 관심 장르 → user_interests 전체 교체, 고른 책 → user_library(READ · finished_at NULL · ONBOARDING) upsert(있으면 평점만),
	 * 마지막에 onboarding_status=COMPLETED. 빈 요청(건너뛰기)도 COMPLETED.
	 * 책 존재 확인을 먼저 해서 404 면 아무것도 저장하지 않는다(트랜잭션).
	 */
	@Transactional
	public void savePreferences(Long userId, PreferencesRequest req) {
		User user = userService.getUser(userId);

		// 1) 책 검증 — bookId 는 내부 id 문자열. 숫자가 아니거나 없으면 404 BOOK_NOT_FOUND
		Map<Long, Integer> ratingByBookId = new LinkedHashMap<>();
		for (PreferencesRequest.BookPick pick : req.books()) {
			ratingByBookId.put(parseBookId(pick.bookId()), pick.rating());   // 같은 책이 두 번 오면 뒤의 별점
		}
		Map<Long, Book> books = new LinkedHashMap<>();
		for (Long bookId : ratingByBookId.keySet()) {
			Book book = bookRepository.findById(bookId)
				.orElseThrow(() -> new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", String.valueOf(bookId))));
			books.put(bookId, book);
		}

		// 2) 장르 → 태그. 라벨('소설'/'#소설')·코드('FICTION') 모두 허용, 사전에 없는 값은 무시, 순서 유지·중복 제거
		List<Tag> tags = resolveGenres(req.genres());
		userInterestRepository.deleteByUserId(userId);
		List<UserInterest> interests = new ArrayList<>();
		for (Tag tag : tags) {
			interests.add(UserInterest.of(user, tag));
		}
		userInterestRepository.saveAll(interests);

		// 3) seed 책 upsert
		for (Map.Entry<Long, Book> e : books.entrySet()) {
			int rating = ratingByBookId.get(e.getKey());
			libraryItemRepository.findByUserIdAndBookId(userId, e.getKey())
				.ifPresentOrElse(
					existing -> existing.updateRating(rating),
					() -> libraryItemRepository.save(LibraryItem.onboardingSeed(user, e.getValue(), rating)));
		}

		// 4) 완료
		user.completeOnboarding();
	}

	private List<Tag> resolveGenres(List<String> genres) {
		if (genres.isEmpty()) {
			return List.of();
		}
		List<Tag> dictionary = tagRepository.findByKind(GENRE_KIND);
		Set<String> seen = new LinkedHashSet<>();
		List<Tag> resolved = new ArrayList<>();
		for (String raw : genres) {
			if (raw == null) {
				continue;
			}
			String key = normalize(raw);
			for (Tag tag : dictionary) {
				if (key.equals(normalize(tag.getLabel())) || key.equalsIgnoreCase(tag.getCode())) {
					if (seen.add(tag.getCode())) {
						resolved.add(tag);
					}
					break;
				}
			}
		}
		return resolved;
	}

	/** '#소설 ' → '소설'. 중점(·)·공백 차이는 그대로 비교한다(라벨 표가 양쪽 기준). */
	private static String normalize(String s) {
		String t = s.strip();
		if (t.startsWith("#")) {
			t = t.substring(1).strip();
		}
		return t;
	}

	private static Long parseBookId(String raw) {
		try {
			return Long.valueOf(raw.strip());
		}
		catch (NumberFormatException e) {
			throw new BusinessException(ErrorCode.BOOK_NOT_FOUND, Map.of("bookId", raw));
		}
	}

	private static Map<String, String> field(String field, String reason) {
		Map<String, String> m = new LinkedHashMap<>();
		m.put("field", field);
		m.put("reason", reason);
		return m;
	}
}
