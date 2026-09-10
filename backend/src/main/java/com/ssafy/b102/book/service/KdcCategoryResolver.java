package com.ssafy.b102.book.service;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.ssafy.b102.book.entity.KdcMainClass;

/**
 * books.category_code(KDC, 예 "813.62") → API BookSummary.category 분류 경로("문학 > 한국문학"). API_SPEC §1.5.
 *
 * V2 kdc_codes(depth 1 대분류 10 · 2 중분류 100 · 3 소분류 839)를 기동 시 한 번 메모리에 올린다(949행, 수십 KB).
 * 경로는 명세대로 2단계까지 — 프론트 서재 선반·DNA 장르 키가 2단계를 쓴다. 대·중분류 라벨이 같으면("8 문학"/"80 문학", "0 총류"/"00 총류") 한 번만 쓴다.
 * kdc_codes 가 비어 있거나(적재 전) 읽을 수 없으면 KdcMainClass 대분류 1단계로 폴백한다 — 검색이 분류 사전 때문에 멈추지 않게.
 * 사전은 배포마다 다시 읽고, 적재 뒤 바로 반영하려면 refresh() 를 부른다.
 */
@Component
public class KdcCategoryResolver {

	private static final Logger log = LoggerFactory.getLogger(KdcCategoryResolver.class);
	private static final Pattern LEADING_DIGITS = Pattern.compile("^\\s*(\\d+)");
	static final String SEPARATOR = " > ";

	private final JdbcTemplate jdbc;
	private volatile Map<String, String> labels;   // code("8","81") → label. null = 아직 안 읽음

	public KdcCategoryResolver(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 테스트·오프라인용 — DB 없이 라벨 표를 직접 준다. */
	public static KdcCategoryResolver fromLabels(Map<String, String> codeToLabel) {
		KdcCategoryResolver r = new KdcCategoryResolver(null);
		r.labels = Map.copyOf(codeToLabel);
		return r;
	}

	/** "813.62" → "문학 > 한국문학". 코드가 없거나 숫자로 시작하지 않으면 null(분류 모름). */
	public String pathOf(String categoryCode) {
		if (categoryCode == null) {
			return null;
		}
		Matcher m = LEADING_DIGITS.matcher(categoryCode);
		if (!m.find()) {
			return null;
		}
		String digits = m.group(1);
		Map<String, String> table = table();
		String main = table.get(digits.substring(0, 1));
		if (main == null) {
			main = KdcMainClass.labelOf(digits);   // 사전에 없어도 대분류 10개는 안다
		}
		if (main == null) {
			return null;
		}
		String sub = digits.length() >= 2 ? table.get(digits.substring(0, 2)) : null;
		if (sub == null || sub.equals(main)) {
			return main;
		}
		return main + SEPARATOR + sub;
	}

	/** kdc_codes 를 다시 읽는다. 적재 배치 뒤에 부른다. 실패하면 이전 표를 유지한다. */
	public synchronized void refresh() {
		if (jdbc == null) {
			return;
		}
		try {
			Map<String, String> loaded = new HashMap<>();
			jdbc.query("select code, label from kdc_codes where depth <= 2", rs -> {
				loaded.put(rs.getString("code").trim(), rs.getString("label").trim());
			});
			labels = Map.copyOf(loaded);
			log.info("KDC 분류 사전 로드: {}건 (대·중분류)", loaded.size());
		} catch (DataAccessException e) {
			// V2 미적용·권한 문제 등. 대분류 폴백으로 계속 간다.
			if (labels == null) {
				labels = Map.of();
			}
			log.warn("kdc_codes 를 읽지 못했습니다 — category 는 대분류 1단계로 폴백합니다: {}", e.getMessage());
		}
	}

	private Map<String, String> table() {
		Map<String, String> t = labels;
		if (t == null) {
			refresh();
			t = labels;
		}
		return t;
	}
}
