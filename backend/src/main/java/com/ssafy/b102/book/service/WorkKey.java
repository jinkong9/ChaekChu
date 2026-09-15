package com.ssafy.b102.book.service;

import java.util.List;
import java.util.regex.Pattern;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.search.service.AuthorNameParser;

/**
 * 같은 «작품»인지 가리는 키.
 *
 * 카탈로그는 ISBN13 하나가 한 행이라 같은 책의 다른 판본·다른 출판사·전자책이 전부 별개 행이다.
 * 「비슷한 책」에 기준 책과 같은 작품이 끼면 반칙이므로(API_SPEC §4.5 「같은 작품 묶어 1권만」) 여기서 접는다.
 * 실제 사례: `9788954677158` 긴긴밤·루리·문학동네 2021 의 이웃으로 `9788954684033` 긴긴밤·루리·문학동네 2021 이 올라왔다.
 *
 * 키는 <b>제목 줄기 + 괄호 밖 숫자 + 대표 저자</b> 세 조각이다.
 *
 * 줄기만으로는 시리즈가 뭉개진다 — 도서관 서지는 권차·시즌을 병기 제목 뒤에 다는 일이 흔해서
 * (「치즈 인 더 트랩=Cheese in the trap:Season 1」) `=` 를 자르면 시즌 1과 시즌 4가 같은 작품이 된다.
 * 후보 44만 권으로 재 보니 그렇게 뭉치는 묶음이 7,747개였다. 그래서 <b>괄호 밖 숫자를 키에 남긴다</b> —
 * 시즌·권차는 갈라지고(재측정 0건), 괄호 안의 연도·판차(「(2024년 개정판)작별하지 않는다」)는
 * 무시돼 개정판이 원본과 합쳐진다. 부제(`:`)로는 자르지 않는다.
 *
 * 접기에 실패하는 쪽(중복이 한 번 더 보임)이 잘못 접는 쪽(다른 책이 사라짐)보다 낫다는 원칙은 그대로다.
 * 알면서 두는 한계 — 한자 제목(`太白山脈`)은 줄기가 비어 ISBN 으로 떨어져 접히지 않고, 음역 변이
 * (생텍쥐페리/생떽쥐베리)도 합쳐지지 않는다. 권차가 제목에 없고 원장 `vol` 컬럼(채움률 25.7%)에만 있는
 * 시리즈는 한 권으로 접힌다 — 「비슷한 책」 네 칸을 같은 시리즈로 채우지 않는 편이 낫다고 보고 그대로 둔다.
 */
public final class WorkKey {

	/** `(아이의 미래를 바꾸는)슬로 리딩` 의 앞머리 수식구. 원장 서지가 이 형태를 자주 쓴다. */
	private static final Pattern PARENTHESES = Pattern.compile("\\([^)]*\\)");
	/** `긴긴밤=Long night` 처럼 원제를 병기한 뒤쪽. 줄기에서만 떼고, 숫자는 여기서도 걷는다. */
	private static final Pattern ROMANIZED_TAIL = Pattern.compile("\\s*=.*$");
	/** 키에 남길 권차 숫자. 괄호 밖에서만 걷는다 — 괄호 안 숫자는 연도·판차라 작품을 가르지 않는다. */
	private static final Pattern NON_DIGIT = Pattern.compile("[^0-9]+");
	/** 비교에 쓰지 않는 글자 — 공백·문장부호. 한글·영숫자만 남긴다. */
	private static final Pattern NOISE = Pattern.compile("[^0-9a-z가-힣]+");

	private WorkKey() {
	}

	/** 같은 작품이면 같은 문자열. 제목이 비면 ISBN 으로 떨어져 절대 겹치지 않는다. */
	public static String of(Book book) {
		return of(book.getTitle(), book.getAuthor(), book.getIsbn13());
	}

	public static String of(String title, String rawAuthor, String isbn13) {
		String outsideParentheses = title == null ? "" : PARENTHESES.matcher(title).replaceAll(" ");
		String stem = normalizeTitle(outsideParentheses);
		if (stem.isEmpty()) {
			return "isbn:" + (isbn13 == null ? "" : isbn13.strip());
		}
		return stem + "#" + NON_DIGIT.matcher(outsideParentheses).replaceAll("") + "|" + firstAuthor(rawAuthor);
	}

	/** 병기 제목을 떼고 한글·영숫자만 남긴다. 한자는 남지 않아 줄기가 빌 수 있다(그러면 ISBN 으로 떨어진다). */
	private static String normalizeTitle(String outsideParentheses) {
		String stripped = ROMANIZED_TAIL.matcher(outsideParentheses).replaceAll("");
		return NOISE.matcher(stripped.toLowerCase(java.util.Locale.ROOT)).replaceAll("");
	}

	/**
	 * 대표 저자 한 명만 본다. 같은 작품이라도 판본마다 옮긴이·그린이가 달라 저자 목록 전체로는 안 맞는다
	 * (예: 「데미안」 홍경호 옮김 / 전영애 옮김). AuthorNameParser 가 이미 역할어를 떼고 옮긴이를 제외한다.
	 */
	private static String firstAuthor(String rawAuthor) {
		List<String> authors = AuthorNameParser.parse(rawAuthor);
		if (authors.isEmpty()) {
			return "";
		}
		return NOISE.matcher(authors.get(0).toLowerCase(java.util.Locale.ROOT)).replaceAll("");
	}
}
