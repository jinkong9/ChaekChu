package com.ssafy.b102.book.service;

import java.util.List;
import java.util.regex.Matcher;
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
 * 키는 <b>제목 줄기 + 괄호 밖 숫자 + 대표 저자</b>, 그리고 원장 권차(`vol`, V6)가 있으면 그것을 얹은 네 조각이다.
 *
 * <p><b>세트 ISBN(`set_isbn`)은 키에 넣지 않는다(09-16).</b> 09-15 에는 세트 ISBN 을 키의 맨 앞에 두었는데
 * 추천 후보 440,757권을 실제 코드로 전부 돌려 보니 두 방향으로 틀렸다.
 * <ul>
 *   <li>세트 ISBN 은 «작품»이 아니라 «묶음 상품»의 번호다. 판을 새로 찍으면 새로 발급되고(문학수첩 해리포터 2010·2014·2019 가
 *       각각 다른 세트) 출판사 전집은 수십 작품이 한 세트를 쓴다. 그래서 «세트+권차» 가 같은 <b>다른 작품</b>이 452묶음·1,476권
 *       있었고 그중 1,024권이 같은 작품으로 잘못 접혔다 — 웅진 세계문학 세트 `9788901082042` 의 1권 아래 드라큘라·제인 에어·논어 등
 *       14작품, 신영미디어 세트 `9788941330325` 의 1권 아래 96작품이 한 키였다. 화면에서 다른 책이 사라지는 최악의 실패다.</li>
 *   <li>반대로 같은 권의 다른 판(불의 잔 4-1 의 2010·2014·2019 판)은 세트가 달라 세 키로 갈려 세 번 보였다.</li>
 * </ul>
 * 제목·저자·권차로 바꾸면 잘못 접힌 452묶음이 전부 풀리고, 판본 중복 3,004묶음(4,575권)이 추가로 접힌다.
 * 추가로 접히는 묶음 안에 권차가 섞인 경우는 0 이다.
 *
 * <p>세트 표시만 있고 권차가 없는 449권은 ISBN 으로 떨어뜨려 접지 않는다. 세트의 형제인데 권차를 모르는 것이라
 * 제목·저자로 접으면 다른 권이 사라질 수 있다. 그 대가로 판본 중복 45묶음(132권)이 그대로 보인다 — 감수한다.
 *
 * <p>권차는 숫자면 앞의 0 을 뗀다(`01`→`1`, `017`→`17`) — 광마회귀 위즈덤하우스 `01` 과 문학수첩 `1` 이 갈리던 8묶음.
 * `상`·`하`·`중` 같은 비숫자는 그대로 둔다.
 *
 * <p>줄기만으로는 시리즈가 뭉개진다 — 도서관 서지는 권차·시즌을 병기 제목 뒤에 다는 일이 흔해서
 * (「치즈 인 더 트랩=Cheese in the trap:Season 1」) `=` 를 자르면 시즌 1과 시즌 4가 같은 작품이 된다.
 * 그렇게 뭉치던 묶음이 7,747개였고, <b>괄호 밖 숫자를 키에 남기자</b> 0 이 됐다. 괄호 안의 연도·판차
 * (「(2024년 개정판)작별하지 않는다」)는 무시돼 개정판이 원본과 합쳐진다. 부제(`:`)로는 자르지 않는다.
 *
 * <p>접기에 실패하는 쪽(중복이 한 번 더 보임)이 잘못 접는 쪽(다른 책이 사라짐)보다 낫다는 원칙은 그대로다.
 * 알면서 두는 한계 — 한자 제목(`太白山脈`)은 줄기가 비어 ISBN 으로 떨어져 접히지 않고, 음역 변이
 * (생텍쥐페리/생떽쥐베리)도 합쳐지지 않는다. 저자 원문에서 옮긴이가 앞에 오면(「최인자 · J. K. 롤링」 vs 「J. K. 롤링 · 강동혁」)
 * 대표 저자가 달라 같은 권이라도 갈린다 — 저자 이름 교집합으로 잇는 안은 「우리 몸」(옮긴이 이충호를 공유하는 세 다른 책)·
 * 「십팔사략」(소설·번역·만화)처럼 다른 책을 접는 사례가 실측돼 넣지 않았다. 권차가 제목에 없고 원장 `vol` 에도 없는
 * 시리즈는 한 권으로 접힌다. `vol` 이 문고 일련번호인 책(같은 작품이 출판사마다 다른 번호, 2,044묶음)은 접히지 않고 남는다.
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
	/** 숫자만인 권차. 앞의 0 을 떼기 위해 가린다. */
	private static final Pattern NUMERIC_VOLUME = Pattern.compile("0*([0-9]+)");

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
	 * 판단 순서.
	 *
	 * <ol>
	 *   <li>제목 줄기가 비면(한자 제목) ISBN 으로 떨어져 절대 겹치지 않는다.</li>
	 *   <li>권차가 있으면 제목 줄기·괄호 밖 숫자·대표 저자에 권차를 얹는다 — 셜록 홈즈 1권과 7권은 갈리고,
	 *       불의 잔 4-1 의 2010·2014·2019 판은 세트가 달라도 한 작품이다.</li>
	 *   <li>권차는 없는데 세트 표시가 있으면 ISBN 으로 떨어뜨린다 — 세트의 형제인데 몇 권인지 모르는 것이라 접지 않는다.</li>
	 *   <li>둘 다 없으면 제목 줄기·괄호 밖 숫자·대표 저자(같은 책의 다른 판본을 접는 원래 규칙).</li>
	 * </ol>
	 * 세트 ISBN 자체는 키에 들어가지 않는다 — 이유는 클래스 설명 참조.
	 */
	public static String of(String title, String rawAuthor, String isbn13, String vol, String setIsbn) {
		String outsideParentheses = title == null ? "" : PARENTHESES.matcher(title).replaceAll(" ");
		String stem = normalizeTitle(outsideParentheses);
		if (stem.isEmpty()) {
			return "isbn:" + trimOrEmpty(isbn13);
		}
		String volume = normalizeVolume(vol);
		if (volume == null && trimToNull(setIsbn) != null) {
			return "isbn:" + trimOrEmpty(isbn13);
		}
		String key = stem + "#" + NON_DIGIT.matcher(outsideParentheses).replaceAll("") + "|" + firstAuthor(rawAuthor);
		return volume == null ? key : key + "@" + volume;
	}

	/** 빈 값은 null. 숫자만이면 앞의 0 을 뗀다(`01`→`1`). 그 외(`상`·`하`)는 다듬기만 한다. */
	static String normalizeVolume(String vol) {
		String trimmed = trimToNull(vol);
		if (trimmed == null) {
			return null;
		}
		Matcher numeric = NUMERIC_VOLUME.matcher(trimmed);
		return numeric.matches() ? numeric.group(1) : trimmed;
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
