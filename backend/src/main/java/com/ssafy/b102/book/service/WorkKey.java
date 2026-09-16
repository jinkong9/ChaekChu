package com.ssafy.b102.book.service;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.search.service.AuthorNameParser;

/**
 * 같은 «작품»인지 가리는 값 객체. {@link #sameWorkAs(WorkKey)} 로 두 책을 비교한다.
 *
 * 카탈로그는 ISBN13 하나가 한 행이라 같은 책의 다른 판본·다른 출판사·전자책이 전부 별개 행이다.
 * 「비슷한 책」에 기준 책과 같은 작품이 끼면 반칙이므로(API_SPEC §4.5 「같은 작품 묶어 1권만」) 여기서 접는다.
 *
 * <p><b>왜 문자열 키가 아니라 쌍 비교인가(09-16).</b> 09-15 까지는 「제목 줄기 + 대표 저자 + 권차」 문자열이 같으면 한 작품으로 봤다.
 * 그런데 세계문학 고전에서는 이 키가 거의 항상 어긋난다 — 데미안 판본 94권이 24개 키로 갈렸다.
 * <ul>
 *   <li>저자 원문에서 옮긴이가 앞에 온다: 「구기성 · 헤르만 헤세」 vs 「헤르만 헤세 · 정홍택」. 대표 저자가 다르다.</li>
 *   <li>원장 `vol` 이 권차가 아니라 문고 일련번호다: 민음사 세계문학전집 44, 범우사 사르비아총서 638, 열린책들 227.
 *       추천 후보 44만 중 `vol` 있는 130,129권에서 세트 표시가 없는 90,331권은 절반이 이런 번호다.</li>
 * </ul>
 * 두 조건은 「이 책과 저 책」을 놓고 봐야 판단이 된다(교집합·출판사 비교). 그래서 키가 아니라 predicate 다.
 *
 * <p><b>같은 작품 판정</b> — 세 조건을 모두 만족해야 한다.
 * <ol>
 *   <li><b>제목 줄기</b>(괄호 수식구·병기 제목을 뗀 한글·영숫자)와 <b>괄호 밖 숫자</b>가 같다. 「치즈 인 더 트랩 … Season 1」 과 「… Season 4」
 *       는 숫자로 갈린다(실측 7,747묶음). 줄기가 비면(한자 제목) 절대 같지 않다.</li>
 *   <li><b>저자가 이어진다</b>: 대표 저자가 같거나, 한쪽의 대표 저자가 다른 쪽 저자 목록에 있다. 「구기성 · 헤세」 의 상대 「헤세 · 정홍택」 은
 *       대표 저자 헤세가 이쪽 목록에 있으니 같은 작품. 이름은 AuthorNameParser 가 역할어를 뗀 «전체 이름»으로만 비교한다 —
 *       원문을 토큰으로 쪼개면 `by` 30,919권·`illustrated` 9,465권이 겹쳐 다른 책이 붙는다. 옮긴이만 공유하는 다른 책
 *       (「우리 몸」 세 권이 옮긴이 이충호를 공유)은 대표 저자가 서로의 목록에 없어 붙지 않는다.
 *       두 쪽 모두 저자가 없으면 이어진 것으로, 한쪽만 없으면 아닌 것으로 본다.</li>
 *   <li><b>권차가 모순되지 않는다</b>:
 *     <ul>
 *       <li>둘 다 있고 같으면(앞의 0 은 뗀다, `01`=`1`) 같은 권.</li>
 *       <li>둘 다 있고 다르면 — 같은 출판사이거나, 같은 세트(`set_isbn`)이거나, 어느 한쪽이라도 카탈로그가 «시리즈»라고 아는 책이면
 *           다른 권(=다른 작품). 그 밖에는 출판사가 다른 문고 번호로 보고 같은 작품. 시리즈 판정은 WorkSeriesRepository —
 *           «같은 제목·같은 출판사가 한 해에 두 권차 이상을 냈다» 는 기록이 있으면 시리즈다. 출판사가 고전을 여러 전집에 다시 넣으면
 *           연도가 달라 걸리지 않고(데미안 민음사 2000/2009), 세트로 함께 낸 권들은 걸린다(토지 나남 2002 21권).</li>
 *       <li>한쪽만 있으면 모른다 → 다른 작품으로 둔다(접지 않는 쪽이 안전).</li>
 *       <li>둘 다 없으면 같은 작품. 단 같은 세트의 권차 미상 형제는 다른 작품으로 둔다.</li>
 *     </ul>
 *   </li>
 * </ol>
 *
 * <p>추천 후보 440,757권을 이 클래스 그대로 탐욕적으로 접어 보면(AI 순서 대신 id 순, 시리즈 판정은 로컬 카탈로그 331만 행) 41,829권이 접히고
 * (09-16 오전 규칙 35,118권), 데미안 94권은 24묶음 → 5묶음, 어린 왕자 207권은 42 → 53(카탈로그가 시리즈로 아는 출판사가 많아 오히려 덜 접힌다).
 * 시리즈는 그대로다 — 토지 78권 33묶음, 학사검전 9권 9묶음, 먼나라 이웃나라 64권 16묶음, 셜록 홈즈 41권 17묶음.
 * 출판사가 다르고 권차도 다른데 접힌 5,696쌍을 표본 조사하면 크리스마스 캐럴 여원미디어 30·웅진닷컴 23 처럼 문고 번호였다.
 *
 * <p>원칙은 그대로다 — 덜 접는 실패(중복이 한 번 더 보임)가 잘못 접는 실패(다른 책이 사라짐)보다 낫다. 그래서 «한쪽만 권차 있음»과
 * «같은 세트 권차 미상»은 접지 않고, 시리즈 판정은 «어느 한쪽이라도» 로 넓게 잡는다.
 * 알면서 두는 한계: 한자 제목, 음역 변이(생텍쥐페리/생떽쥐베리), 제목 조사 변이(「해리포터:불의 잔」/「해리포터와 불의 잔」),
 * 같은 원작의 다른 선집(「톨스토이 단편선」)이 한 작품으로 접히는 것.
 */
public final class WorkKey {

	/** `(아이의 미래를 바꾸는)슬로 리딩` 의 앞머리 수식구. 원장 서지가 이 형태를 자주 쓴다. */
	private static final Pattern PARENTHESES = Pattern.compile("\\([^)]*\\)");
	/** `긴긴밤=Long night` 처럼 원제를 병기한 뒤쪽. 줄기에서만 떼고, 숫자는 여기서도 걷는다. */
	private static final Pattern ROMANIZED_TAIL = Pattern.compile("\\s*=.*$");
	/** 줄기와 함께 볼 권차·시즌 숫자. 괄호 밖에서만 걷는다 — 괄호 안 숫자는 연도·판차라 작품을 가르지 않는다. */
	private static final Pattern NON_DIGIT = Pattern.compile("[^0-9]+");
	/** 비교에 쓰지 않는 글자 — 공백·문장부호. 한글·영숫자만 남긴다. */
	private static final Pattern NOISE = Pattern.compile("[^0-9a-z가-힣]+");
	/** 숫자만인 권차. 앞의 0 을 떼기 위해 가린다. */
	private static final Pattern NUMERIC_VOLUME = Pattern.compile("0*([0-9]+)");

	private final String isbn13;
	/** 제목 줄기 + '#' + 괄호 밖 숫자. 비면 한자 제목 등으로 비교 불능. */
	private final String stem;
	private final String firstAuthor;
	private final Set<String> authors;
	private final String volume;
	private final String publisher;
	private final String setIsbn;
	private final boolean knownSeries;

	private WorkKey(String isbn13, String stem, String firstAuthor, Set<String> authors, String volume,
		String publisher, String setIsbn, boolean knownSeries) {
		this.isbn13 = isbn13;
		this.stem = stem;
		this.firstAuthor = firstAuthor;
		this.authors = authors;
		this.volume = volume;
		this.publisher = publisher;
		this.setIsbn = setIsbn;
		this.knownSeries = knownSeries;
	}

	/** 카탈로그가 시리즈로 아는지(WorkSeriesRepository)까지 넘겨 만든다. 「비슷한 책」이 쓰는 경로. */
	public static WorkKey of(Book book, boolean knownSeries) {
		return of(book.getTitle(), book.getAuthor(), book.getIsbn13(), book.getPublisher(), book.getVol(), book.getSetIsbn(),
			knownSeries);
	}

	/** 시리즈 정보 없이 만든다. 권차가 다르고 출판사도 다르면 문고 번호로 본다. */
	public static WorkKey of(Book book) {
		return of(book, false);
	}

	/** 권차·세트·출판사 정보가 없는 호출부용. */
	public static WorkKey of(String title, String rawAuthor, String isbn13) {
		return of(title, rawAuthor, isbn13, null, null, null, false);
	}

	/** 출판사·시리즈 정보 없이 권차·세트만. 테스트·단순 비교용. */
	public static WorkKey of(String title, String rawAuthor, String isbn13, String vol, String setIsbn) {
		return of(title, rawAuthor, isbn13, null, vol, setIsbn, false);
	}

	public static WorkKey of(String title, String rawAuthor, String isbn13, String publisher, String vol, String setIsbn,
		boolean knownSeries) {
		String outsideParentheses = title == null ? "" : PARENTHESES.matcher(title).replaceAll(" ");
		String normalizedTitle = normalizeTitle(outsideParentheses);
		String stem = normalizedTitle.isEmpty() ? "" : normalizedTitle + "#" + NON_DIGIT.matcher(outsideParentheses).replaceAll("");
		Set<String> authors = new LinkedHashSet<>();
		for (String name : AuthorNameParser.parse(rawAuthor)) {
			String normalized = NOISE.matcher(name.toLowerCase(Locale.ROOT)).replaceAll("");
			if (!normalized.isEmpty()) {
				authors.add(normalized);
			}
		}
		String first = authors.isEmpty() ? "" : authors.iterator().next();
		return new WorkKey(trimOrEmpty(isbn13), stem, first, Set.copyOf(authors), normalizeVolume(vol),
			publisher == null ? "" : NOISE.matcher(publisher.toLowerCase(Locale.ROOT)).replaceAll(""),
			trimToNull(setIsbn), knownSeries);
	}

	/** 같은 작품이면 true. 대칭이다. 자기 자신(같은 ISBN)은 언제나 true. */
	public boolean sameWorkAs(WorkKey other) {
		if (!isbn13.isEmpty() && isbn13.equals(other.isbn13)) {
			return true;
		}
		if (stem.isEmpty() || !stem.equals(other.stem)) {
			return false;
		}
		return authorsRelated(other) && volumeCompatible(other);
	}

	private boolean authorsRelated(WorkKey other) {
		if (authors.isEmpty() && other.authors.isEmpty()) {
			return true;
		}
		if (authors.isEmpty() || other.authors.isEmpty()) {
			return false;
		}
		return firstAuthor.equals(other.firstAuthor) || other.authors.contains(firstAuthor) || authors.contains(other.firstAuthor);
	}

	private boolean volumeCompatible(WorkKey other) {
		boolean sameSet = setIsbn != null && setIsbn.equals(other.setIsbn);
		if (volume != null && other.volume != null) {
			if (volume.equals(other.volume)) {
				return true;
			}
			if (samePublisher(other)) {
				return false;     // 같은 출판사의 다른 권차 = 시리즈의 다른 권
			}
			if (sameSet || knownSeries || other.knownSeries) {
				return false;     // 세트 형제이거나 카탈로그가 시리즈로 아는 책 — 권차를 믿는다
			}
			return true;          // 출판사가 다른 문고 일련번호 — 같은 작품
		}
		if (volume == null && other.volume == null) {
			return !sameSet;      // 같은 세트의 권차 미상 형제만 갈라 둔다
		}
		return false;             // 한쪽만 권차가 있다 — 모르므로 접지 않는다
	}

	/**
	 * 출판사 표기가 원장마다 다르다 — 「그레이트북스」/「그레이트Books(그레이트북스)」, 「크레용하우스」/「(주)크레용하우스」, 「학산문화사」/「학산문화사(만화)」.
	 * 한글·영숫자만 남긴 뒤 한쪽이 다른 쪽을 품으면(3자 이상) 같은 출판사로 본다. 실측: 출판사·권차가 모두 다르다고 접힌 6,172쌍 중 491쌍이 이 표기 차이였다.
	 * 「비룡소」/「비룡소플래닛」·「김영사」/「주니어김영사」 같은 임프린트도 같은 곳으로 묶여 권차를 믿게 된다 — 덜 접는 쪽이라 안전하다.
	 */
	private boolean samePublisher(WorkKey other) {
		if (publisher.isEmpty() || other.publisher.isEmpty()) {
			return false;
		}
		if (publisher.equals(other.publisher)) {
			return true;          // 「나남」처럼 두 글자 출판사는 완전일치로만 본다
		}
		String shorter = publisher.length() <= other.publisher.length() ? publisher : other.publisher;
		String longer = shorter == publisher ? other.publisher : publisher;
		return shorter.length() >= 3 && longer.contains(shorter);
	}

	public String isbn13() {
		return isbn13;
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

	/** 병기 제목을 떼고 한글·영숫자만 남긴다. 한자는 남지 않아 줄기가 빌 수 있다. */
	private static String normalizeTitle(String outsideParentheses) {
		String stripped = ROMANIZED_TAIL.matcher(outsideParentheses).replaceAll("");
		return NOISE.matcher(stripped.toLowerCase(Locale.ROOT)).replaceAll("");
	}

	@Override
	public String toString() {
		return "WorkKey[" + stem + "|" + firstAuthor + (volume == null ? "" : "@" + volume) + (knownSeries ? " series" : "") + "]";
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof WorkKey k && isbn13.equals(k.isbn13) && stem.equals(k.stem) && firstAuthor.equals(k.firstAuthor)
			&& Objects.equals(volume, k.volume) && publisher.equals(k.publisher) && Objects.equals(setIsbn, k.setIsbn);
	}

	@Override
	public int hashCode() {
		return Objects.hash(isbn13, stem, firstAuthor, volume, publisher, setIsbn);
	}
}
