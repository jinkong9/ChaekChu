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
 * 숫자가 붙은 사례는 추천 후보 440,757권을 실제 코드로 돌려 잰 것이다(09-16).
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
	@DisplayName("시리즈는 뭉개지 않는다 — 부제(:)로 자르지 않는다")
	void seriesStaysSeparateBySubtitle() {
		assertThat(WorkKey.of("해리 포터: 마법사의 돌", "조앤 K. 롤링", "9790000000006"))
			.isNotEqualTo(WorkKey.of("해리 포터: 비밀의 방", "조앤 K. 롤링", "9790000000007"));
	}

	@Test
	@DisplayName("권차·시즌이 병기 제목(=) 뒤에 있어도 갈라진다 — 실측 7,747 묶음이 여기서 뭉쳤다")
	void seasonsStaySeparate() {
		assertThat(WorkKey.of("치즈 인 더 트랩=Cheese in the trap:Season 1", "순끼", "9790000000012"))
			.isNotEqualTo(WorkKey.of("치즈 인 더 트랩=Cheese in the trap:Season 4", "순끼", "9790000000013"));
		assertThat(WorkKey.of("미생", "윤태호", "9790000000014"))
			.isNotEqualTo(WorkKey.of("미생=未生:아직 살아 있지 못한 자:시즌 2", "윤태호", "9790000000015"));
	}

	@Test
	@DisplayName("괄호 안 연도·판차는 작품을 가르지 않는다 — 개정판이 원본과 합쳐져야 한다")
	void parentheticalNumbersIgnored() {
		String base = WorkKey.of("작별하지 않는다", "한강", "9790000000016");
		assertThat(WorkKey.of("(2024년 개정판)작별하지 않는다", "한강", "9790000000017")).isEqualTo(base);
		assertThat(WorkKey.of("(200쇄 기념본)작별하지 않는다", "한강", "9790000000018")).isEqualTo(base);
	}

	// ── 권차(vol)·세트(set_isbn) ──

	@Test
	@DisplayName("세트의 권들은 접지 않는다 — 실제 사례: 비룡소 셜록 홈즈 7권이 제목·저자·연도까지 같다")
	void setMembersStaySeparate() {
		String v1 = WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124216", "1", "9788949124209");
		String v7 = WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124278", "7", "9788949124209");
		assertThat(v1).isNotEqualTo(v7);
	}

	@Test
	@DisplayName("같은 권의 다른 판은 세트 ISBN 이 달라도 한 작품이다 — 불의 잔 4-1 이 2010·2014·2019 판으로 세 번 보이던 문제")
	void sameVolumeAcrossEditionsMerges() {
		String ed2010 = WorkKey.of("해리포터와 불의 잔", "조앤 K. 롤링", "9788983920928", "41", "9788983920676");
		String ed2014 = WorkKey.of("해리포터와 불의 잔", "조앤 K. 롤링", "9788983925589", "41", "9788983925664");
		String ed2019 = WorkKey.of("해리포터와 불의 잔", "조앤 K. 롤링", "9788983927682", "41", "9788983927613");
		assertThat(ed2010).isEqualTo(ed2014).isEqualTo(ed2019);
		// 4-2 는 다른 권
		assertThat(WorkKey.of("해리포터와 불의 잔", "조앤 K. 롤링", "9788983927699", "42", "9788983927613")).isNotEqualTo(ed2019);
	}

	@Test
	@DisplayName("세트 ISBN 과 권차가 같아도 제목이 다르면 다른 작품이다 — 전집 한 세트 아래 14작품이 «1권» 으로 뭉개지던 문제")
	void sameSetAndVolumeButDifferentTitleStaysSeparate() {
		String set = "9788901082042";   // 웅진 세계문학: 드라큘라·제인 에어·논어… 가 전부 vol=1
		String dracula = WorkKey.of("드라큘라", "브램 스토커 · 박종윤", "9788901099057", "1", set);
		String janeEyre = WorkKey.of("제인 에어", "샬럿 브론테 · 류경희", "9788901106311", "1", set);
		String analects = WorkKey.of("논어", "최영갑 · 공자", "9788901100197", "1", set);
		assertThat(dracula).isNotEqualTo(janeEyre).isNotEqualTo(analects);
		assertThat(janeEyre).isNotEqualTo(analects);
	}

	@Test
	@DisplayName("세트 표시만 있고 권차가 없으면 ISBN 으로 떨어져 각자 남는다 — 접는 것보다 안전하다")
	void setMemberWithoutVolumeNeverMerges() {
		String a = WorkKey.of("어떤 시리즈", "저자", "9790000000020", null, "9790000000019");
		String b = WorkKey.of("어떤 시리즈", "저자", "9790000000021", null, "9790000000019");
		assertThat(a).isNotEqualTo(b);
		// 세트 없는 같은 제목·저자와도 합쳐지지 않는다 — 한쪽으로라도 접히면 세트 형제가 사라질 수 있다
		assertThat(a).isNotEqualTo(WorkKey.of("어떤 시리즈", "저자", "9790000000022", null, null));
	}

	@Test
	@DisplayName("같은 세트의 같은 권은 한 작품이다 — 재쇄가 따로 잡히지 않는다")
	void sameVolumeInSameSetMerges() {
		assertThat(WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124216", "3", "9788949124209"))
			.isEqualTo(WorkKey.of("셜록 홈즈", "아서 코난 도일 · 김석희", "9790000000022", "3", "9788949124209"));
	}

	@Test
	@DisplayName("세트 표시가 없고 권차만 있으면 제목·저자에 권차를 얹는다")
	void volumeAloneSplitsWork() {
		String base = WorkKey.of("토지", "박경리", "9790000000023", "1", null);
		assertThat(WorkKey.of("토지", "박경리", "9790000000024", "2", null)).isNotEqualTo(base);
		assertThat(WorkKey.of("토지", "박경리", "9790000000025", "1", null)).isEqualTo(base);
	}

	@Test
	@DisplayName("권차의 앞자리 0 은 뗀다 — 광마회귀 위즈덤하우스 «01» 과 문학수첩 «1» 은 같은 권이다")
	void volumeLeadingZerosNormalized() {
		assertThat(WorkKey.of("광마회귀", "유진성", "9791171713509", "01", "9791171713493"))
			.isEqualTo(WorkKey.of("광마회귀", "유진성", "9791193790205", "1", "9791193790243"));
		assertThat(WorkKey.of("Biscuit", "Alyssa Satin Capucilli", "9788953922433", "017", null))
			.isEqualTo(WorkKey.of("Biscuit", "Alyssa Satin Capucilli", "9780060741723", "17", null));
		// 비숫자 권차는 그대로 — 상·하는 다른 권
		assertThat(WorkKey.of("토지", "박경리", "9790000000026", "상", null))
			.isNotEqualTo(WorkKey.of("토지", "박경리", "9790000000027", "하", null));
		assertThat(WorkKey.of("토지", "박경리", "9790000000028", " 상 ", null))
			.isEqualTo(WorkKey.of("토지", "박경리", "9790000000029", "상", null));
	}

	@Test
	@DisplayName("권차·세트가 모두 없으면 예전 규칙 그대로 — 긴긴밤 두 판본은 여전히 한 작품이다")
	void withoutVolumeFallsBackToTitleAndAuthor() {
		assertThat(WorkKey.of("긴긴밤", "루리", "9788954677158", null, null))
			.isEqualTo(WorkKey.of("긴긴밤", "루리", "9788954684033", null, null));
		assertThat(WorkKey.of("긴긴밤", "루리", "9788954677158", "", ""))
			.isEqualTo(WorkKey.of("긴긴밤", "루리", "9788954684033", null, null));
	}

	@Test
	@DisplayName("제목이 같아도 저자가 다르면 다른 작품이다")
	void differentAuthorIsDifferentWork() {
		assertThat(WorkKey.of("밤", "김승옥", "9790000000008"))
			.isNotEqualTo(WorkKey.of("밤", "엘리 위젤", "9790000000009"));
	}

	@Test
	@DisplayName("제목이 비면 ISBN 으로 떨어져 절대 겹치지 않는다 — 권차·세트가 있어도 같다")
	void emptyTitleFallsBackToIsbn() {
		assertThat(WorkKey.of(null, "저자", "9790000000010"))
			.isNotEqualTo(WorkKey.of("", "저자", "9790000000011"));
		assertThat(WorkKey.of("太白山脈", "조정래", "9790000000030", "1", "9790000000031"))
			.isNotEqualTo(WorkKey.of("太白山脈", "조정래", "9790000000032", "1", "9790000000031"));
	}
}
