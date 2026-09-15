package com.ssafy.b102.book.service;

import java.util.List;
import java.util.regex.Pattern;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.search.service.AuthorNameParser;

/**
 * 같은 «작품»인지 가리는 키 — 「정규화한 제목 + 첫 저자」.
 *
 * 카탈로그는 ISBN13 하나가 한 행이라 같은 책의 다른 판본·다른 출판사·전자책이 전부 별개 행이다.
 * 「비슷한 책」에 기준 책과 같은 작품이 끼면 반칙이므로(API_SPEC §4.5 「같은 작품 묶어 1권만」) 여기서 접는다.
 * 실제 사례: `9788954677158` 긴긴밤·루리·문학동네 2021 의 이웃으로 `9788954684033` 긴긴밤·루리·문학동네 2021 이 올라왔다.
 *
 * 정규화는 <b>일부러 보수적으로</b> 한다. 과하게 접으면 시리즈가 한 권으로 뭉개진다 —
 * 특히 부제 구분자 `:` 로 자르면 「해리포터: 마법사의 돌」과 「해리포터: 비밀의 방」이 같은 작품이 된다.
 * 그래서 자르는 것은 병기 제목(`=`)과 괄호 수식구까지만 하고, 부제는 남긴다.
 * 접기에 실패하는 쪽(중복이 한 번 더 보임)이 잘못 접는 쪽(다른 책이 사라짐)보다 낫다.
 */
public final class WorkKey {

	/** `(아이의 미래를 바꾸는)슬로 리딩` 의 앞머리 수식구. 원장 서지가 이 형태를 자주 쓴다. */
	private static final Pattern PARENTHESES = Pattern.compile("\\([^)]*\\)");
	/** `긴긴밤=Long night` 처럼 원제를 병기한 뒤쪽. */
	private static final Pattern ROMANIZED_TAIL = Pattern.compile("\\s*=.*$");
	/** 비교에 쓰지 않는 글자 — 공백·문장부호. 한글·영숫자만 남긴다. */
	private static final Pattern NOISE = Pattern.compile("[^0-9a-z가-힣]+");

	private WorkKey() {
	}

	/** 같은 작품이면 같은 문자열. 제목이 비면 ISBN 으로 떨어져 절대 겹치지 않는다. */
	public static String of(Book book) {
		return of(book.getTitle(), book.getAuthor(), book.getIsbn13());
	}

	public static String of(String title, String rawAuthor, String isbn13) {
		String normalizedTitle = normalizeTitle(title);
		if (normalizedTitle.isEmpty()) {
			return "isbn:" + (isbn13 == null ? "" : isbn13.strip());
		}
		return normalizedTitle + "|" + firstAuthor(rawAuthor);
	}

	private static String normalizeTitle(String title) {
		if (title == null) {
			return "";
		}
		String stripped = ROMANIZED_TAIL.matcher(PARENTHESES.matcher(title).replaceAll(" ")).replaceAll("");
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
