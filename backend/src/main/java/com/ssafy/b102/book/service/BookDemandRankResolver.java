package com.ssafy.b102.book.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

import com.ssafy.b102.book.repository.BookDetailRepository;

/**
 * 누적 대출 수 → 「전국 대출 순위 상위 N%」 표시 문자열.
 *
 * 책 하나의 정확한 등수를 구하려면 275만 행을 세야 한다. 화면에 필요한 것은 등수가 아니라 「상위 몇 %」 한 줄이므로
 * 기준월마다 경계값 5개(1·3·5·10·25%)만 구해 캐시하고, 책의 loan_cum 을 그 경계와 비교한다.
 * 경계값 계산은 인덱스 순서 훑기라 5개 합쳐 EC2 에서 수 초 — 기동 직후 백그라운드로 한 번 데우고, 그 전에 들어온 요청은 순위 항목만 생략한다.
 *
 * 상위 25% 밖이면 null 을 준다. 「상위 80%」는 화면에 쓸모가 없고, 지표를 빼면 프론트가 그 줄을 지운다(API_SPEC §4.4).
 */
@Component
public class BookDemandRankResolver {

	static final int[] PERCENTS = {1, 3, 5, 10, 25};

	private static final Logger log = LoggerFactory.getLogger(BookDemandRankResolver.class);

	/** as_of_month → 경계값. PERCENTS 와 같은 순서, 원소는 그 지점의 loan_cum. 계산 실패한 달은 담지 않는다. */
	private final Map<String, List<Long>> thresholds = new ConcurrentHashMap<>();

	private final BookDetailRepository repository;

	public BookDemandRankResolver(BookDetailRepository repository) {
		this.repository = repository;
	}

	/** "상위 3%" 또는 null(상위 25% 밖·자료 없음·아직 안 데워짐). */
	public String topPercentLabel(String asOfMonth, Long loanCum) {
		if (asOfMonth == null || loanCum == null) {
			return null;
		}
		List<Long> bounds = thresholds.computeIfAbsent(asOfMonth, this::compute);
		for (int i = 0; i < bounds.size(); i++) {
			if (loanCum >= bounds.get(i)) {
				return "상위 " + PERCENTS[i] + "%";
			}
		}
		return null;
	}

	/** 기준월의 경계값을 미리 계산해 둔다. 실패는 로그만 남긴다 — 순위는 없어도 다른 지표는 나간다. */
	public void warmUp(String asOfMonth) {
		if (asOfMonth != null) {
			thresholds.computeIfAbsent(asOfMonth, this::compute);
		}
	}

	private List<Long> compute(String asOfMonth) {
		try {
			long total = repository.countDemand(asOfMonth);
			if (total <= 0) {
				return List.of();
			}
			List<Long> bounds = new ArrayList<>(PERCENTS.length);
			for (int percent : PERCENTS) {
				long offset = Math.max(0, Math.round(total * percent / 100.0) - 1);
				Long value = repository.loanCumAtOffset(asOfMonth, offset).orElse(null);
				if (value == null) {
					break;   // 그 아래 백분위도 못 구한다 — 여기까지만 쓴다
				}
				bounds.add(value);
			}
			log.info("대출 순위 경계값 계산 {} (행 {}) → {}", asOfMonth, total, bounds);
			return List.copyOf(bounds);
		}
		catch (DataAccessException e) {
			log.warn("대출 순위 경계값 계산 실패 {} — 순위 지표를 생략한다: {}", asOfMonth, e.toString());
			return List.of();
		}
	}
}
