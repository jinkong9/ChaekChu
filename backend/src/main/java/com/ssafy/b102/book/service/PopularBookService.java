package com.ssafy.b102.book.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.Year;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.BookSummaryMapper;
import com.ssafy.b102.book.dto.BookSummaryResponse;
import com.ssafy.b102.book.dto.PopularBooksResponse;
import com.ssafy.b102.book.dto.PopularSegmentsResponse;
import com.ssafy.b102.book.repository.PopularBookRepository;
import com.ssafy.b102.book.repository.PopularBookRepository.PopularRow;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.service.UserService;

/**
 * API_SPEC §4.2·§4.3 — book_loaned_top20(정보나루 loanItemSrch, 직전 3개월, 월 1회 적재) 위의 읽기 전용 서비스.
 *
 * 세그먼트 결정(§4.2, 프론트 mock 과 동일한 3단 규칙):
 *   1) 출생연도·성별 모두 있음 → 그 세그먼트 순위 그대로
 *   2) 출생연도만 → 같은 연령대 F·M 을 책 단위로 loan_count 합산 후 재정렬
 *   3) 그 외 → 기준월의 전 세그먼트 합산
 * 연령대 = (올해 − birthYear) 를 10 단위로 내림, 10~60 으로 클램프(60 = 60대 이상). 원천 DB 가 60대를 따로 갖고 있어 그대로 쓴다.
 */
@Service
public class PopularBookService {

	public static final int DEFAULT_SIZE = 12;
	public static final int MAX_SIZE = 40;
	public static final int SEGMENT_TOP = 20;

	static final List<String> AGE_GROUPS = List.of("10", "20", "30", "40", "50", "60");
	static final List<String> GENDERS = List.of("M", "F");
	private static final int WINDOW_MONTHS = 3;   // fetch_segment_popular.py 기본 창: 기준월 포함 직전 3개월

	private final PopularBookRepository repository;
	private final UserService userService;
	private final Clock clock;

	public PopularBookService(PopularBookRepository repository, UserService userService, Clock clock) {
		this.repository = repository;
		this.userService = userService;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public PopularBooksResponse popularFor(Long userId, int size) {
		User user = userService.getUser(userId);
		String age = ageGroupOf(user.getBirthYear() == null ? null : user.getBirthYear().intValue());
		String gender = user.getGender() == null ? null : user.getGender().code();

		Optional<String> period = repository.latestPeriod();
		PopularBooksResponse.SegmentInfo segment = age == null ? null
			: new PopularBooksResponse.SegmentInfo(age, gender, segmentLabel(age, gender));
		if (period.isEmpty()) {
			return new PopularBooksResponse(segment, List.of());
		}

		List<PopularRow> rows;
		if (age != null && gender != null) {
			rows = repository.findSegment(period.get(), age, gender, size);
		}
		else if (age != null) {
			rows = repository.findAggregated(period.get(), List.of(age), size);
		}
		else {
			rows = repository.findAggregated(period.get(), List.of(), size);
		}
		return new PopularBooksResponse(segment, rows.stream().map(PopularBookService::toSummary).toList());
	}

	@Transactional(readOnly = true)
	public PopularSegmentsResponse segments() {
		Optional<String> period = repository.latestPeriod();
		if (period.isEmpty()) {
			return new PopularSegmentsResponse(null, null, List.of());
		}
		YearMonth month = YearMonth.parse(period.get(), DateTimeFormatter.ofPattern("yyyyMM"));
		LocalDate start = month.minusMonths(WINDOW_MONTHS - 1).atDay(1);
		LocalDate end = month.atEndOfMonth();
		String generatedAt = month.plusMonths(1).atDay(1).atStartOfDay().atOffset(ZoneOffset.UTC)
			.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);

		Map<String, List<PopularSegmentsResponse.Item>> bySegment = new LinkedHashMap<>();
		for (String age : AGE_GROUPS) {
			for (String gender : GENDERS) {
				bySegment.put(age + "_" + gender, new ArrayList<>());
			}
		}
		for (PopularRow row : repository.findAllSegments(period.get(), SEGMENT_TOP)) {
			List<PopularSegmentsResponse.Item> items = bySegment.get(row.ageGroup() + "_" + row.gender());
			if (items != null) {
				items.add(new PopularSegmentsResponse.Item(row.ranking(), row.loanCount(), toSummary(row), row.coverUrl()));
			}
		}
		List<PopularSegmentsResponse.Segment> segments = new ArrayList<>();
		bySegment.forEach((id, items) -> {
			if (items.isEmpty()) {
				return;     // 기준월에 행이 없는 세그먼트는 내보내지 않는다
			}
			String[] parts = id.split("_");
			segments.add(new PopularSegmentsResponse.Segment(id, segmentLabel(parts[0], parts[1]), parts[0], parts[1], items));
		});
		return new PopularSegmentsResponse(generatedAt,
			new PopularSegmentsResponse.Period(start.toString(), end.toString()), segments);
	}

	/** 출생연도 → 연령대 문자열. 모르면 null. */
	String ageGroupOf(Integer birthYear) {
		if (birthYear == null) {
			return null;
		}
		int age = Year.now(clock).getValue() - birthYear;
		int decade = Math.max(10, Math.min(60, (age / 10) * 10));
		return String.valueOf(decade);
	}

	static String segmentLabel(String age, String gender) {
		String ageLabel = "60".equals(age) ? "60대 이상" : age + "대";
		if (gender == null) {
			return ageLabel;
		}
		return ageLabel + " " + ("F".equals(gender) ? "여성" : "남성");
	}

	private static BookSummaryResponse toSummary(PopularRow r) {
		return BookSummaryMapper.of(r.bookId(), r.isbn13(), r.title(), r.author(), r.publisher(), r.pubYear(),
			r.categoryCode(), r.coverUrl());
	}
}
