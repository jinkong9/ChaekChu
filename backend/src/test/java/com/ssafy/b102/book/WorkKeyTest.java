package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.ssafy.b102.book.service.WorkKey;

/**
 * 같은 작품인지 가리는 키. 「비슷한 책」에 기준 책의 다른 판본이 끼는 것을 막는다(API_SPEC §4.5).
 *
 * 접기에 실패하는 쪽보다 <b>잘못 접는 쪽이 더 나쁘다</b> — 중복은 한 번 더 보이고 끝이지만,
 * 잘못 접으면 다른 책이 목록에서 사라진다. 그래서 시리즈가 뭉개지지 않는지를 함께 고정한다.
 */
class WorkKeyTest {

	@Test
	@DisplayName("판본·출판사·옮긴이가 달라도 제목과 대표 저자가 같으면 한 작품이다")
	void sameWorkAcrossEditions() {
		String base = WorkKey.of("긴긴밤", "루리", "9788954677158");

		assertThat(WorkKey.of("긴긴밤", "루리", "9788954684033")).isEqualTo(base);          // 실제 사례
		assertThat(WorkKey.of("긴 긴 밤", "루리 글·그림", "9790000000001")).isEqualTo(base);  // 띄어쓰기·역할어
		assertThat(WorkKey.of("긴긴밤=Long night", "루리", "9790000000002")).isEqualTo(base); // 병기 제목
		assertThat(WorkKey.of("(제21회 문학동네어린이문학상)긴긴밤", "루리", "9790000000003")).isEqualTo(base);
	}

	@Test
	@DisplayName("옮긴이가 다른 번역본도 한 작품이다 — 대표 저자 한 명만 본다")
	void sameWorkAcrossTranslators() {
		assertThat(WorkKey.of("작별하지 않는다", "한강 지음 ;김유경 옮김", "9790000000004"))
			.isEqualTo(WorkKey.of("작별하지 않는다", "한강", "9790000000005"));
	}

	@Test
	@DisplayName("시리즈는 뭉개지 않는다 — 부제(:)로 자르지 않는 이유")
	void seriesStaysSeparate() {
		assertThat(WorkKey.of("해리 포터: 마법사의 돌", "조앤 K. 롤링", "9790000000006"))
			.isNotEqualTo(WorkKey.of("해리 포터: 비밀의 방", "조앤 K. 롤링", "9790000000007"));
	}

	@Test
	@DisplayName("제목이 같아도 저자가 다르면 다른 작품이다")
	void differentAuthorIsDifferentWork() {
		assertThat(WorkKey.of("밤", "김승옥", "9790000000008"))
			.isNotEqualTo(WorkKey.of("밤", "엘리 위젤", "9790000000009"));
	}

	@Test
	@DisplayName("제목이 비면 ISBN 으로 떨어져 절대 겹치지 않는다")
	void emptyTitleFallsBackToIsbn() {
		assertThat(WorkKey.of(null, "저자", "9790000000010"))
			.isNotEqualTo(WorkKey.of("", "저자", "9790000000011"));
	}
}
