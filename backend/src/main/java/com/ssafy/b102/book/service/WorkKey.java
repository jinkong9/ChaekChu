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
 * 원장 권차(`vol`)·세트 ISBN(`set_isbn`)이 있으면 그것을 먼저 본다(V6). 시리즈는 권마다 제목이 같아
 * 제목·저자로는 원리적으로 못 가른다 — 비룡소 셜록 홈즈 7권이 제목·저자·출판사·연도·소개문까지 같다.
 * 추천 후보 44만 기준으로 제목+저자가 겹치는 39,096묶음 중 16,513(42.2%)이 `vol` 로 갈라지고,
 * `vol` 은 없지만 `set_isbn` 이 있는 393묶음(1.0%)도 세트 구성원이라 접지 않는다.
 * 남는 22,190묶음(56.8%)은 세트 표시가 없는 판본 중복이라 접는 것이 맞다.
 *
 * 권차가 없을 때의 키는 <b>제목 줄기 + 괄호 밖 숫자 + 대표 저자</b> 세 조각이다.
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

	/** 같은 작품이면 같은 문자열. */
	public static String of(Book book) {
		return of(book.getTitle(), book.getAuthor(), book.getIsbn13(), book.getVol(), book.getSetIsbn());
	}

	/** 권차 정보가 없던 시절의 호출부용. 새 코드는 vol·setIsbn 을 넘기는 쪽을 쓴다. */
	public static String of(String title, String rawAuthor, String isbn13) {
		return of(title, rawAuthor, isbn13, null, null);
	}

	/**
	 * 판단 순서가 곧 정확도 순서다.
	 *
	 * <ol>
	 *   <li><b>세트의 한 권이면 접지 않는다</b>(V6 `set_isbn`). 시리즈는 권마다 제목이 같아 제목·저자로는 절대 못 가른다.
	 *       권차까지 있으면 그것으로, 없으면 ISBN 으로 떨어뜨려 각자 남긴다 —
	 *       셜록 홈즈 7권이 한 권으로 뭉개지던 것이 이 줄에서 풀린다.</li>
	 *   <li>세트 표시는 없는데 권차만 있으면 제목·저자에 권차를 얹는다.</li>
	 *   <li>둘 다 없으면 제목 줄기·괄호 밖 숫자·대표 저자로 본다(같은 책의 다른 판본을 접는 원래 규칙).</li>
	 * </ol>
	 */
	public static String of(String title, String rawAuthor, String isbn13, String vol, String setIsbn) {
		String set = trimToNull(setIsbn);
		String volume = trimToNull(vol);
		if (set != null) {
			return "set:" + set + "/" + (volume != null ? volume : "isbn:" + trimOrEmpty(isbn13));
		}
		String outsideParentheses = title == null ? "" : PARENTHESES.matcher(title).replaceAll(" ");
		String stem = normalizeTitle(outsideParentheses);
		if (stem.isEmpty()) {
			return "isbn:" + trimOrEmpty(isbn13);
		}
		String key = stem + "#" + NON_DIGIT.matcher(outsideParentheses).replaceAll("") + "|" + firstAuthor(rawAuthor);
		return volume == null ? key : key + "@" + volume;
	}

	private static String trimToNull(String value) {
		if (value == null) {
			return null;
		}
		String trimmed = value.strip();
		return trimmed.isEmpty() ? null : trimmed;
	}

	private static String trimOrEmpty(String value) {
		return value == null ? "" : value.strip();
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
