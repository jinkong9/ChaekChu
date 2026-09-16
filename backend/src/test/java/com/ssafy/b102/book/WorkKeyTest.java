package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.ssafy.b102.book.service.WorkKey;

/**
 * 같은 작품인지 가리는 판정. 「비슷한 책」에 기준 책의 다른 판본이 끼는 것을 막는다(API_SPEC §4.5).
 *
 * 접기에 실패하는 쪽보다 <b>잘못 접는 쪽이 더 나쁘다</b> — 중복은 한 번 더 보이고 끝이지만,
 * 잘못 접으면 다른 책이 목록에서 사라진다. 그래서 시리즈가 뭉개지지 않는지를 함께 고정한다.
 * 숫자가 붙은 사례는 추천 후보 440,757권을 실제 코드로 돌려 잰 것이다(09-16).
 */
class WorkKeyTest {

	private static boolean same(WorkKey a, WorkKey b) {
		assertThat(a.sameWorkAs(b)).as("대칭이어야 한다").isEqualTo(b.sameWorkAs(a));
		return a.sameWorkAs(b);
	}

	@Test
	@DisplayName("판본·출판사·옮긴이가 달라도 제목과 대표 저자가 같으면 한 작품이다")
	void sameWorkAcrossEditions() {
		WorkKey base = WorkKey.of("긴긴밤", "루리", "9788954677158");

		assertThat(same(base, WorkKey.of("긴긴밤", "루리", "9788954684033"))).isTrue();          // 실제 사례
		assertThat(same(base, WorkKey.of("긴 긴 밤", "루리 글·그림", "9790000000001"))).isTrue();  // 띄어쓰기·역할어
		assertThat(same(base, WorkKey.of("긴긴밤=Long night", "루리", "9790000000002"))).isTrue(); // 병기 제목
		assertThat(same(base, WorkKey.of("(제21회 문학동네어린이문학상)긴긴밤", "루리", "9790000000003"))).isTrue();
	}

	@Test
	@DisplayName("옮긴이가 다른 번역본도 한 작품이다 — 대표 저자 한 명이 같다")
	void sameWorkAcrossTranslators() {
		assertThat(same(WorkKey.of("작별하지 않는다", "한강 지음 ;김유경 옮김", "9790000000004"),
			WorkKey.of("작별하지 않는다", "한강", "9790000000005"))).isTrue();
	}

	@Test
	@DisplayName("옮긴이가 앞에 와서 대표 저자가 달라도 한쪽의 대표 저자가 상대 목록에 있으면 한 작품이다 — 데미안 「구기성 · 헤세」 vs 「헤세 · 정홍택」")
	void translatorFirstStillSameWork() {
		WorkKey a = WorkKey.of("데미안", "구기성 · 헤르만 헤세", "9790000000040");
		WorkKey b = WorkKey.of("데미안", "헤르만 헤세 · 정홍택", "9790000000041");
		WorkKey c = WorkKey.of("데미안", "전은경 · 헤르만 헤세", "9790000000042");
		assertThat(same(a, b)).isTrue();
		assertThat(same(b, c)).isTrue();
		// 옮긴이만 공유하는 다른 책은 접지 않는다 — 「우리 몸」 세 권이 옮긴이 이충호를 공유했다
		assertThat(same(WorkKey.of("우리 몸", "로빈 카터 · 잔 스트래들링 · 이충호", "9790000000043"),
			WorkKey.of("우리 몸", "파스칼 데주르 · 마누 부아스토 · 이충호", "9790000000044"))).isFalse();
	}

	@Test
	@DisplayName("시리즈는 뭉개지 않는다 — 부제(:)로 자르지 않는다")
	void seriesStaysSeparateBySubtitle() {
		assertThat(same(WorkKey.of("해리 포터: 마법사의 돌", "조앤 K. 롤링", "9790000000006"),
			WorkKey.of("해리 포터: 비밀의 방", "조앤 K. 롤링", "9790000000007"))).isFalse();
	}

	@Test
	@DisplayName("권차·시즌이 병기 제목(=) 뒤에 있어도 갈라진다 — 실측 7,747 묶음이 여기서 뭉쳤다")
	void seasonsStaySeparate() {
		assertThat(same(WorkKey.of("치즈 인 더 트랩=Cheese in the trap:Season 1", "순끼", "9790000000012"),
			WorkKey.of("치즈 인 더 트랩=Cheese in the trap:Season 4", "순끼", "9790000000013"))).isFalse();
		assertThat(same(WorkKey.of("미생", "윤태호", "9790000000014"),
			WorkKey.of("미생=未生:아직 살아 있지 못한 자:시즌 2", "윤태호", "9790000000015"))).isFalse();
	}

	@Test
	@DisplayName("괄호 안 연도·판차는 작품을 가르지 않는다 — 개정판이 원본과 합쳐져야 한다")
	void parentheticalNumbersIgnored() {
		WorkKey base = WorkKey.of("작별하지 않는다", "한강", "9790000000016");
		assertThat(same(base, WorkKey.of("(2024년 개정판)작별하지 않는다", "한강", "9790000000017"))).isTrue();
		assertThat(same(base, WorkKey.of("(200쇄 기념본)작별하지 않는다", "한강", "9790000000018"))).isTrue();
	}

	// ── 권차(vol)·세트(set_isbn)·출판사 ──

	@Test
	@DisplayName("같은 출판사의 다른 권차는 다른 책이다 — 비룡소 셜록 홈즈 7권이 제목·저자·연도까지 같다")
	void samePublisherDifferentVolumeIsDifferentWork() {
		WorkKey v1 = WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124216", "비룡소", "1", "9788949124209", false);
		WorkKey v7 = WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124278", "비룡소", "7", "9788949124209", false);
		assertThat(same(v1, v7)).isFalse();
		// 출판사 표기가 없어도 같은 세트면 다른 권
		assertThat(same(WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124216", "1", "9788949124209"),
			WorkKey.of("셜록 홈즈", "아서 코난 도일", "9788949124278", "7", "9788949124209"))).isFalse();
	}

	@Test
	@DisplayName("출판사 표기가 달라도 한쪽이 다른 쪽을 품으면 같은 출판사다 — 「(주)크레용하우스」 2권과 「크레용하우스」 4권은 다른 책")
	void publisherNameVariantsCountAsSamePublisher() {
		assertThat(same(WorkKey.of("공룡유치원", "저자", "9790000000080", "(주)크레용하우스", "2", null, false),
			WorkKey.of("공룡유치원", "저자", "9790000000081", "크레용하우스", "4", null, false))).isFalse();
		assertThat(same(WorkKey.of("담아 나라가 시끌시끌", "저자", "9790000000082", "그레이트북스", "29", null, false),
			WorkKey.of("담아 나라가 시끌시끌", "저자", "9790000000083", "그레이트Books(그레이트북스)", "34", null, false))).isFalse();
		// 전혀 다른 출판사면 문고 번호 — 같은 작품
		assertThat(same(WorkKey.of("어린 왕자", "생텍쥐페리 · 이효숙", "9790000000084", "푸른책들", "2", null, false),
			WorkKey.of("어린 왕자", "생텍쥐페리 · 박기종", "9790000000085", "삼성당", "5", null, false))).isTrue();
	}

	@Test
	@DisplayName("같은 권의 다른 판은 세트 ISBN 이 달라도 한 작품이다 — 불의 잔 4-1 이 2010·2014·2019 판으로 세 번 보이던 문제")
	void sameVolumeAcrossEditionsMerges() {
		WorkKey ed2010 = WorkKey.of("해리포터와 불의 잔", "최인자 · 조앤 K. 롤링", "9788983920928", "문학수첩", "41", "9788983920676", true);
		WorkKey ed2014 = WorkKey.of("해리포터와 불의 잔", "최인자 · J. K. 롤링", "9788983925589", "문학수첩", "41", "9788983925664", true);
		WorkKey ed2019 = WorkKey.of("해리포터와 불의 잔", "J. K. 롤링 · 강동혁", "9788983927682", "문학수첩", "41", "9788983927613", true);
		assertThat(same(ed2010, ed2014)).isTrue();
		assertThat(same(ed2014, ed2019)).isTrue();   // 「최인자 · J. K. 롤링」 vs 「J. K. 롤링 · 강동혁」 — 대표 저자 롤링이 상대 목록에 있다
		assertThat(same(ed2019, WorkKey.of("해리포터와 불의 잔", "J. K. 롤링 · 강동혁", "9788983927699", "문학수첩", "42", "9788983927613", true))).isFalse();
	}

	@Test
	@DisplayName("세트 ISBN 과 권차가 같아도 제목이 다르면 다른 작품이다 — 전집 한 세트 아래 14작품이 «1권» 으로 뭉개지던 문제")
	void sameSetAndVolumeButDifferentTitleStaysSeparate() {
		String set = "9788901082042";   // 웅진 세계문학: 드라큘라·제인 에어·논어… 가 전부 vol=1
		WorkKey dracula = WorkKey.of("드라큘라", "브램 스토커 · 박종윤", "9788901099057", "웅진씽크빅", "1", set, false);
		WorkKey janeEyre = WorkKey.of("제인 에어", "샬럿 브론테 · 류경희", "9788901106311", "웅진씽크빅", "1", set, false);
		assertThat(same(dracula, janeEyre)).isFalse();
	}

	@Test
	@DisplayName("출판사가 다르고 권차도 다르면 문고 일련번호로 보고 한 작품이다 — 데미안 민음사 44 · 범우사 638 · 열린책들 227")
	void collectionNumbersAcrossPublishersMerge() {
		WorkKey minumsa = WorkKey.of("데미안", "헤르만 헤세 · 전영애", "9788937460449", "민음사", "44", null, false);
		WorkKey bumwoo = WorkKey.of("데미안", "헤르만 헤세 · 홍경호", "9788908033153", "범우사", "638", null, false);
		WorkKey openbooks = WorkKey.of("데미안", "헤르만 헤세 · 김인순", "9788932912271", "열린책들", "227", null, false);
		assertThat(same(minumsa, bumwoo)).isTrue();
		assertThat(same(bumwoo, openbooks)).isTrue();
	}

	@Test
	@DisplayName("카탈로그가 시리즈로 아는 책이면 출판사가 달라도 권차를 믿는다 — 학사검전 북박스 1권 vs 랜덤하우스 9권")
	void knownSeriesTrustsVolumeAcrossPublishers() {
		WorkKey bookbox1 = WorkKey.of("학사검전", "최현우", "9790000000050", "북박스", "1", null, true);
		WorkKey random9 = WorkKey.of("학사검전", "최현우", "9790000000051", "랜덤하우스코리아", "9", null, false);
		assertThat(same(bookbox1, random9)).isFalse();      // 한쪽만 시리즈로 알아도 충분하다
		assertThat(same(bookbox1, WorkKey.of("학사검전", "최현우", "9790000000052", "랜덤하우스코리아", "1", null, false))).isTrue();  // 같은 권
	}

	@Test
	@DisplayName("한쪽만 권차가 있으면 모르는 것이라 접지 않는다 — 접는 것보다 안전하다")
	void unknownVolumeOnOneSideNeverMerges() {
		assertThat(same(WorkKey.of("해리포터와 불의 잔", "J. K. 롤링", "9790000000060", "문학수첩", "41", null, true),
			WorkKey.of("해리포터와 불의 잔", "J. K. 롤링", "9790000000061", "문학수첩", null, null, true))).isFalse();
	}

	@Test
	@DisplayName("세트 표시만 있고 권차가 없는 형제는 서로 접지 않지만, 세트가 다른 판본과는 한 작품이다")
	void setSiblingsWithoutVolume() {
		WorkKey a = WorkKey.of("어떤 시리즈", "저자", "9790000000020", null, "9790000000019");
		WorkKey b = WorkKey.of("어떤 시리즈", "저자", "9790000000021", null, "9790000000019");
		assertThat(same(a, b)).isFalse();
		// Cat in the Hat 1985 Random House(세트 있음) 와 2003 HarperCollins(세트 없음) 는 같은 그림책
		assertThat(same(WorkKey.of("(The)Cat in the Hat", "by Dr. Seuss", "9780394800011", null, "9780385376204"),
			WorkKey.of("(The)cat in the hat", "by Dr. Seuss", "9780007158447", null, null))).isTrue();
	}

	@Test
	@DisplayName("권차의 앞자리 0 은 뗀다 — 광마회귀 위즈덤하우스 «01» 과 문학수첩 «1» 은 같은 권")
	void volumeLeadingZerosNormalized() {
		assertThat(same(WorkKey.of("광마회귀", "유진성", "9791171713509", "위즈덤하우스", "01", "9791171713493", true),
			WorkKey.of("광마회귀", "유진성", "9791193790205", "문학수첩", "1", "9791193790243", true))).isTrue();
		assertThat(same(WorkKey.of("토지", "박경리", "9790000000026", "나남", "상", null, false),
			WorkKey.of("토지", "박경리", "9790000000027", "나남", "하", null, false))).isFalse();
	}

	@Test
	@DisplayName("제목이 같아도 저자가 다르면 다른 작품이다")
	void differentAuthorIsDifferentWork() {
		assertThat(same(WorkKey.of("밤", "김승옥", "9790000000008"), WorkKey.of("밤", "엘리 위젤", "9790000000009"))).isFalse();
		// 한쪽만 저자가 없으면 모르는 것이라 접지 않는다
		assertThat(same(WorkKey.of("밤", "", "9790000000070"), WorkKey.of("밤", "엘리 위젤", "9790000000009"))).isFalse();
	}

	@Test
	@DisplayName("제목이 비면 절대 겹치지 않는다 — 권차·세트가 있어도 같다. 자기 자신(같은 ISBN)만 같다")
	void emptyTitleNeverMatches() {
		assertThat(same(WorkKey.of(null, "저자", "9790000000010"), WorkKey.of("", "저자", "9790000000011"))).isFalse();
		assertThat(same(WorkKey.of("太白山脈", "조정래", "9790000000030", "1", "9790000000031"),
			WorkKey.of("太白山脈", "조정래", "9790000000032", "1", "9790000000031"))).isFalse();
		assertThat(same(WorkKey.of("太白山脈", "조정래", "9790000000030"), WorkKey.of("太白山脈", "조정래", "9790000000030"))).isTrue();
	}
}
