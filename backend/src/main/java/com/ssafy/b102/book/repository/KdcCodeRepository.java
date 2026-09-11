package com.ssafy.b102.book.repository;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.ssafy.b102.book.dto.KdcCodeResponse;

/**
 * V2 kdc_codes 읽기 — 분류 사전(API_SPEC §4.7).
 *
 * 949행(대 10 · 중 100 · 소 839)짜리 고정 표라 메모리 캐시를 두지 않는다. 프론트는 앱 시작에 한 번(depth=1, 10행)과
 * 토큰을 펼칠 때(parent=8, 10행)만 부르고, 응답에 하루치 Cache-Control 이 붙어 브라우저가 다시 묻지도 않는다.
 * 검색 결과마다 라벨을 붙이는 KdcCategoryResolver 는 그쪽이 호출 빈도가 높아 따로 메모리에 올린다.
 */
@Repository
public class KdcCodeRepository {

	private static final String SELECT = "select code, label, parent_code, depth from kdc_codes";
	private static final RowMapper<KdcCodeResponse> ROW_MAPPER = (rs, n) -> new KdcCodeResponse(
		rs.getString("code").trim(),
		rs.getString("label").trim(),
		rs.getInt("depth"),
		rs.getString("parent_code") == null ? null : rs.getString("parent_code").trim());

	private final JdbcTemplate jdbc;

	public KdcCodeRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 전체 949행. code 오름차순 — 문자열 정렬이라 "8" < "80" < "813" < "89" 순이다. */
	public List<KdcCodeResponse> findAll() {
		return jdbc.query(SELECT + " order by code", ROW_MAPPER);
	}

	/** 한 단계만. depth 1 은 대분류 10개. */
	public List<KdcCodeResponse> findByDepth(int depth) {
		return jdbc.query(SELECT + " where depth = ? order by code", ROW_MAPPER, depth);
	}

	/** 그 코드의 자식들. parent="8" → 중분류 80~89. 최하위(소분류)면 빈 목록. */
	public List<KdcCodeResponse> findByParent(String parentCode) {
		return jdbc.query(SELECT + " where parent_code = ? order by code", ROW_MAPPER, parentCode);
	}
}
