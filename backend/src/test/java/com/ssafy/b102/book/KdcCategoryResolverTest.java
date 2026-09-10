package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.ssafy.b102.book.service.KdcCategoryResolver;

/** category_code → 2단계 경로 규칙. DB 없이 라벨 표를 직접 준다. */
class KdcCategoryResolverTest {

	private final KdcCategoryResolver r = KdcCategoryResolver.fromLabels(Map.of(
		"8", "문학", "80", "문학", "81", "한국문학", "84", "영미문학",   // KDC: 81 한국 · 82 중국 · 83 일본 · 84 영미 · 85 독일 · 86 프랑스
		"3", "사회과학", "32", "경제학",
		"0", "총류", "00", "총류"));

	@Test
	@DisplayName("대분류 > 중분류 — '813.62' → '문학 > 한국문학', '325' → '사회과학 > 경제학'")
	void two_levels() {
		assertThat(r.pathOf("813.62")).isEqualTo("문학 > 한국문학");
		assertThat(r.pathOf("325")).isEqualTo("사회과학 > 경제학");
		assertThat(r.pathOf("843")).isEqualTo("문학 > 영미문학");
	}

	@Test
	@DisplayName("대·중분류 라벨이 같으면 한 번만 — '808' 전집·총서 → '문학', '005' → '총류'")
	void collapse_duplicate_labels() {
		assertThat(r.pathOf("808")).isEqualTo("문학");
		assertThat(r.pathOf("005")).isEqualTo("총류");
	}

	@Test
	@DisplayName("중분류가 사전에 없으면 대분류만 — '86x' 는 표에 없다")
	void missing_sub_falls_back_to_main() {
		assertThat(r.pathOf("863")).isEqualTo("문학");
	}

	@Test
	@DisplayName("사전에 대분류도 없으면 KdcMainClass 로 — '9' 는 표에 없지만 역사")
	void missing_main_falls_back_to_enum() {
		assertThat(r.pathOf("911.05")).isEqualTo("역사");
	}

	@Test
	@DisplayName("한 자리 코드·공백 — '8' → '문학', ' 81 ' → '문학 > 한국문학'")
	void short_and_padded_codes() {
		assertThat(r.pathOf("8")).isEqualTo("문학");
		assertThat(r.pathOf(" 81 ")).isEqualTo("문학 > 한국문학");
	}

	@Test
	@DisplayName("null·빈 값·숫자로 시작하지 않는 코드는 null")
	void unknown_is_null() {
		assertThat(r.pathOf(null)).isNull();
		assertThat(r.pathOf("")).isNull();
		assertThat(r.pathOf("   ")).isNull();
		assertThat(r.pathOf("KDC-813")).isNull();
	}

	@Test
	@DisplayName("표가 비어 있으면(적재 전) 대분류 1단계 폴백만 — 검색이 멈추지 않는다")
	void empty_table_uses_main_class_only() {
		KdcCategoryResolver empty = KdcCategoryResolver.fromLabels(Map.of());
		assertThat(empty.pathOf("813.62")).isEqualTo("문학");
		assertThat(empty.pathOf("325")).isEqualTo("사회과학");
	}
}
