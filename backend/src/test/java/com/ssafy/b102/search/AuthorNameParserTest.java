package com.ssafy.b102.search;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import com.ssafy.b102.search.service.AuthorNameParser;

/** books.author 원문 → authors 배열. 예시는 정보나루·국중·알라딘 서지에서 실제로 보이는 형태다. */
class AuthorNameParserTest {

	static Stream<Arguments> cases() {
		return Stream.of(
			// 후치 역할어
			Arguments.of("한강 지음", List.of("한강")),
			Arguments.of("홍길동, 김철수 지음", List.of("홍길동", "김철수")),
			Arguments.of("박교식,황지연", List.of("박교식", "황지연")),
			Arguments.of("김영하", List.of("김영하")),
			Arguments.of("홍길동 외 2인 지음", List.of("홍길동")),
			Arguments.of("홍길동 외 지음", List.of("홍길동")),
			// 대괄호 표기 (국중)
			Arguments.of("동아출판 [편]", List.of("동아출판")),
			Arguments.of("홍길동 [외] 지음", List.of("홍길동")),
			Arguments.of("홍길동,김철수 [공]지음", List.of("홍길동", "김철수")),
			// 역할 접두 + ; 구분 (정보나루)
			Arguments.of("지은이: 홍길동;그림: 김철수", List.of("홍길동", "김철수")),
			Arguments.of("글: 오윤정 ;그림: 이지후", List.of("오윤정", "이지후")),
			Arguments.of("집필진: 강승원,홍창섭", List.of("강승원", "홍창섭")),
			Arguments.of("이 책을 쓰신 선생님들: 강윤식,홍철희", List.of("강윤식", "홍철희")),
			Arguments.of("글과 사진: 장우혜", List.of("장우혜")),
			Arguments.of("글·그림 백희나", List.of("백희나")),
			// 옮긴이는 창작자가 있으면 뺀다
			Arguments.of("홍길동 지음 ; 김철수 옮김", List.of("홍길동")),
			Arguments.of("한강 (지은이), 데버라 스미스 (옮긴이)", List.of("한강")),
			Arguments.of("헤르만 헤세 지음 ; 전영애 옮김", List.of("헤르만 헤세")),
			// 창작자가 없으면 편집자 → 옮긴이 순으로 내려간다
			Arguments.of("데버라 스미스 옮김", List.of("데버라 스미스")),
			Arguments.of("연세대학교 언어정보연구원 편 ;구인모", List.of("구인모")),
			Arguments.of("한국문학번역원 편", List.of("한국문학번역원")),
			// 운영 DB 실제 형식 (2026-09-09): ' · ' 구분, 지음·옮김 없음, [공]·[ ]·후치 역할어 일부
			Arguments.of("이순원 · 최현묵", List.of("이순원", "최현묵")),
			Arguments.of("윤석희 · 이미현 [공] · 김숙경", List.of("윤석희", "이미현", "김숙경")),
			Arguments.of("한국예술인복지재단 [ ]", List.of("한국예술인복지재단")),
			Arguments.of("김동욱 · Yamato Yamamoto · Takaya Kagami · Daisuke Furuya 콘티", List.of("김동욱", "Yamato Yamamoto", "Takaya Kagami", "Daisuke Furuya")),
			Arguments.of("D. S. Cairns · 김창운 · 장남혁 [공] · 한국연합선교회", List.of("D. S. Cairns", "김창운", "장남혁", "한국연합선교회")),
			Arguments.of("이삼형 · 류소영 · 김창원 · 장윤희 · 권순정", List.of("이삼형", "류소영", "김창원", "장윤희", "권순정")),
			Arguments.of("에이드리언 J. 슬라이워츠키", List.of("에이드리언 J. 슬라이워츠키")),
			// 영어
			Arguments.of("edited by Mikyoung Kim", List.of("Mikyoung Kim")),
			Arguments.of("George Akita & Brandon Palmer ;foreword by Kevin M. Doak", List.of("George Akita", "Brandon Palmer")),
			Arguments.of("Rosetta Sherwood Hall ;transcribed by Hyun Sue Kim", List.of("Rosetta Sherwood Hall")),
			Arguments.of("by J. K. Rowling", List.of("J. K. Rowling")),
			// 중복·전각·빈값
			Arguments.of("한강 글 ; 한강 그림", List.of("한강")),
			Arguments.of("홍길동，김철수 지음", List.of("홍길동", "김철수")),
			Arguments.of("   ", List.of()),
			Arguments.of(null, List.of())
		);
	}

	@ParameterizedTest(name = "[{index}] \"{0}\" → {1}")
	@MethodSource("cases")
	void parse(String raw, List<String> expected) {
		assertThat(AuthorNameParser.parse(raw)).containsExactlyElementsOf(expected);
	}

	@Test
	@DisplayName("역할어만 있으면 이름으로 치지 않는다")
	void role_word_alone_is_not_a_name() {
		assertThat(AuthorNameParser.parse("지음")).isEmpty();
		assertThat(AuthorNameParser.parse("[편]")).isEmpty();
	}

	@Test
	@DisplayName("100자를 넘는 조각은 이름이 아니라 설명문으로 보고 버린다")
	void overlong_fragment_dropped() {
		String junk = "가".repeat(120);
		assertThat(AuthorNameParser.parse(junk + ", 한강 지음")).containsExactly("한강");
	}
}
