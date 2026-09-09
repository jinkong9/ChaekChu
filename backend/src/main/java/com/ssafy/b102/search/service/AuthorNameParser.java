package com.ssafy.b102.search.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * books.author 원문(역할어 포함 한 줄) → 표시·검색용 저자명 배열.
 *
 * 원문 형태(정보나루·국중·알라딘 서지가 섞여 있다):
 *   "한강 지음" · "홍길동, 김철수 지음" · "홍길동 지음 ; 김철수 옮김" · "지은이: 홍길동;그림: 김철수" · "글: 오윤정 ;그림: 이지후"
 *   "동아출판 [편]" · "홍길동 [외] 지음" · "홍길동,김철수 [공]지음" · "집필진: 강승원,홍창섭" · "한강 (지은이), 데버라 스미스 (옮긴이)"
 *   "edited by Mikyoung Kim" · "George Akita & Brandon Palmer ;foreword by Kevin M. Doak"
 *   운영 DB(2026-09-09, 331만 행)는 적재 때 이미 정규화되어 "이순원 · 최현묵" 처럼 ' · ' 로 이어져 있고 지음·옮김이 없다(93% 이름만).
 *   남은 표기는 "[공]"(공동), "[ ]"(빈 대괄호), "… 콘티" 같은 후치 역할어 정도. 역할 표시가 없으니 옮긴이도 저자로 남는다 — 데이터가 구분을 안 준다.
 *
 * 규칙(DB_TABLE_DESIGN §3.1 books.authors): 옮긴이는 빼고 그림작가는 넣는다(아동서 비중). 우선순위는
 *   1) 지음·글·그림·원작 같은 창작자  2) 없으면 편·엮음·감수·사진 같은 편집자  3) 그것도 없으면 옮긴이.
 * 순서는 원문 순, 중복 제거. 판단이 안 되는 역할어는 창작자로 본다(빠뜨리는 것보다 남기는 쪽이 검색에 안전).
 * 원문은 BookDocument.authorRaw 에 그대로 남으므로 규칙을 바꾸면 재색인만 하면 된다.
 */
public final class AuthorNameParser {

	private AuthorNameParser() {
	}

	enum Role { CREATOR, EDITOR, TRANSLATOR }

	/** 이름 뒤에 붙는 한국어 역할어. 긴 것부터 — "글·그림" 이 "글" 보다 먼저 매치되어야 한다. */
	private static final String KO_ROLE_WORDS = String.join("|",
		"글·그림", "글그림", "그림·글", "글과 그림", "글과 사진", "글쓴이", "그린이", "지은이", "옮긴이", "엮은이",
		"집필진", "집필", "공저", "공역", "편저", "편역", "편집", "편찬", "엮음", "옮김", "번역", "역주", "역자", "저자",
		"감수", "해설", "구성", "기획", "정리", "원작", "사진", "만화", "콘티", "각색", "원안", "채색", "지음", "그림", "글", "편", "저", "역", "작");

	private static final Pattern ROLE_PREFIX = Pattern.compile("^([^:\\d]{1,30}?)\\s*:\\s*(.*)$");
	private static final Pattern KO_ROLE_SUFFIX = Pattern.compile("^(.*?)(?:^|\\s|\\)|\\])(" + KO_ROLE_WORDS + ")\\s*$");
	private static final Pattern KO_ROLE_LEADING = Pattern.compile("^(" + KO_ROLE_WORDS + ")\\s+(.+)$");
	private static final Pattern EN_ROLE_PREFIX = Pattern.compile(
		"^(?:(edited|compiled|written|illustrated|translated|transcribed|foreword|introduction|preface|afterword|photographs?|photos?)\\s+)?by\\s+(.+)$",
		Pattern.CASE_INSENSITIVE);
	private static final Pattern PAREN_ROLE = Pattern.compile("^(.*?)\\s*[\\(（]\\s*(" + KO_ROLE_WORDS + ")\\s*[\\)）]\\s*$");
	private static final Pattern BRACKET_TOKEN = Pattern.compile("\\[\\s*(공|외|등)\\s*\\]|\\(\\s*(공|외|등)\\s*\\)");
	private static final Pattern BRACKET_OTHER = Pattern.compile("\\[\\s*([^\\]]+?)\\s*\\]");
	private static final Pattern ET_AL = Pattern.compile("\\s*(?:외\\s*\\d*\\s*(?:인|명)?|등)\\s*$");
	private static final Pattern NAME_SPLIT = Pattern.compile("\\s*[,，·/|&]\\s*|\\s+and\\s+", Pattern.CASE_INSENSITIVE);
	private static final Pattern TRIM_PUNCT = Pattern.compile("^[\\s\\p{Punct}·]+|[\\s\\p{Punct}·]+$");

	private static final int MAX_NAME_LENGTH = 100;

	private record Candidate(String name, Role role) {
	}

	/** null·빈 문자열이면 빈 리스트. 결과는 수정 불가 리스트. */
	public static List<String> parse(String raw) {
		if (raw == null || raw.isBlank()) {
			return List.of();
		}
		String s = normalize(raw);
		List<Candidate> candidates = new ArrayList<>();
		for (String segment : s.split(";")) {
			parseSegment(segment.trim(), candidates);
		}
		for (Role role : Role.values()) {
			List<String> picked = pick(candidates, role);
			if (!picked.isEmpty()) {
				return picked;
			}
		}
		return List.of();
	}

	private static String normalize(String raw) {
		String s = raw.replace('；', ';').replace('，', ',').replace('／', '/').replace('：', ':')
			.replace('（', '(').replace('）', ')').replace('\u00a0', ' ');
		// "[공]지음" "[외]" "(공)" → 공동·외 표시는 이름이 아니다. 지운다.
		s = BRACKET_TOKEN.matcher(s).replaceAll(" ");
		// "동아출판 [편]" → "동아출판 편" 으로 풀어 후치 역할어로 처리
		s = BRACKET_OTHER.matcher(s).replaceAll(" $1 ");
		return s.replaceAll("\\s+", " ").trim();
	}

	private static void parseSegment(String segment, List<Candidate> out) {
		if (segment.isEmpty()) {
			return;
		}
		Role segmentRole = Role.CREATOR;
		String names = segment;

		Matcher prefix = ROLE_PREFIX.matcher(segment);
		Matcher en = EN_ROLE_PREFIX.matcher(segment);
		if (prefix.matches()) {
			// "지은이: 홍길동,김철수" · "글: 오윤정" · "집필진: …" · "이 책을 쓰신 선생님들: …"
			segmentRole = classifyKorean(prefix.group(1).trim());
			names = prefix.group(2);
		} else if (en.matches()) {
			// "edited by X" · "foreword by X" · "by X"
			segmentRole = classifyEnglish(en.group(1));
			names = en.group(2);
		} else {
			Matcher suffix = KO_ROLE_SUFFIX.matcher(segment);
			if (suffix.matches() && !suffix.group(1).isBlank()) {
				// "홍길동, 김철수 지음" · "동아출판 편" · "홍길동 외 2인 지음"
				segmentRole = classifyKorean(suffix.group(2));
				names = suffix.group(1);
				// 겹친 역할어("지음 그림")는 안쪽 것도 벗긴다. 역할은 바깥 것 기준.
				Matcher again = KO_ROLE_SUFFIX.matcher(names.trim());
				while (again.matches() && !again.group(1).isBlank()) {
					names = again.group(1);
					again = KO_ROLE_SUFFIX.matcher(names.trim());
				}
			} else {
				Matcher leading = KO_ROLE_LEADING.matcher(segment);
				if (leading.matches()) {
					// "글·그림 백희나"
					segmentRole = classifyKorean(leading.group(1));
					names = leading.group(2);
				}
			}
		}

		for (String part : NAME_SPLIT.split(names)) {
			Role role = segmentRole;
			String name = part;
			Matcher paren = PAREN_ROLE.matcher(name);
			if (paren.matches()) {
				// 알라딘식 "한강 (지은이)" — 이름마다 역할이 붙는다
				role = classifyKorean(paren.group(2));
				name = paren.group(1);
			}
			name = ET_AL.matcher(name).replaceAll("");
			name = TRIM_PUNCT.matcher(name).replaceAll("");
			if (name.isEmpty() || name.length() > MAX_NAME_LENGTH || isRoleWord(name)) {
				continue;
			}
			out.add(new Candidate(name, role));
		}
	}

	private static List<String> pick(List<Candidate> candidates, Role role) {
		Set<String> names = new LinkedHashSet<>();
		for (Candidate c : candidates) {
			if (c.role() == role) {
				names.add(c.name());
			}
		}
		return List.copyOf(names);
	}

	private static Role classifyKorean(String roleWord) {
		String r = roleWord.replace(" ", "");
		if (r.contains("옮") || r.contains("번역") || r.equals("역") || r.equals("역자") || r.equals("역주") || r.equals("공역") || r.equals("편역")) {
			return Role.TRANSLATOR;
		}
		if (r.equals("편") || r.startsWith("편저") || r.startsWith("편집") || r.startsWith("편찬") || r.contains("엮")
			|| r.contains("감수") || r.contains("해설") || r.contains("구성") || r.contains("기획") || r.contains("정리") || r.contains("사진")) {
			return Role.EDITOR;
		}
		return Role.CREATOR;
	}

	private static Role classifyEnglish(String verb) {
		if (verb == null) {
			return Role.CREATOR;
		}
		String v = verb.toLowerCase(Locale.ROOT);
		if (v.startsWith("translat") || v.startsWith("transcrib") || v.equals("foreword") || v.equals("introduction")
			|| v.equals("preface") || v.equals("afterword")) {
			return Role.TRANSLATOR;
		}
		if (v.startsWith("edit") || v.startsWith("compil") || v.startsWith("photo")) {
			return Role.EDITOR;
		}
		return Role.CREATOR;
	}

	private static boolean isRoleWord(String name) {
		return Pattern.matches("(?:" + KO_ROLE_WORDS + ")", name.replace(" ", ""));
	}
}
