package com.ssafy.b102.search.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.search.* — 도서 검색 인덱스 이름과 기동 시 동작, 순위 조정 계수.
 * 애플리케이션은 항상 alias 로 읽고 쓴다. 물리 인덱스(books_v1, books_v2 …)는 재색인 때 새로 만들고 alias 만 옮긴다.
 * 매핑·analyzer 정의는 resources/elasticsearch/books-{settings,mappings}.json 이 진실의 원천이다 (BookDocument 의 @Setting/@Mapping).
 *
 * indexName 은 「지금 매핑 JSON 에 맞는 물리 인덱스 이름」= 매핑 버전이다. JSON 을 바꾸면 이 값을 올린다(books_v4 → books_v5).
 * 기동 시 alias 가 다른 인덱스를 가리키면 SearchIndexInitializer 가 indexName 을 새로 채워 완전할 때만 alias 를 옮긴다(index-on-start != NEVER).
 * 매핑 이력: v1 = 첫 색인.
 *   v2 = ① title/authors .keyword 에 공백 제거 normalizer(exact) — "어린왕자"/"어린 왕자" 완전일치 동일 취급
 *        ② korean analyzer 에서 nori_readingform 제거 — 한자를 독음으로 바꿔 중국어 도서(秋天→추천)가 한국어 검색에 섞이던 것
 *        ③ nori_part_of_speech stoptags 축소(조사·어미·기호·접사만) — 기본값은 부사까지 지워 "지금 추천"의 지금이 사라졌다
 *   v3 = hasCover(boolean) 추가 — 표지 없는 문서의 점수에 noCoverWeight 를 곱해 같은 작품의 판본 사이에서 표지 있는 쪽이 먼저 오게(09-11).
 *        coverUrl 은 index=false 라 exists 로 못 묻는다. 운영 books 의 표지 채움률은 26.7%(09-09).
 *   v4 = loanCum(long) 추가 — 검색어 없이 분류(kdc)만으로 조회할 때의 정렬 키(09-11). book_demand_features 최신 스냅샷의 누적 대출을
 *        색인 시 LEFT JOIN 해 넣는다(BookIndexRowRepository). 수요 지표가 없는 책은 null 이고 정렬에서 뒤로 간다.
 *
 * noCoverWeight: 표지 없는 문서 점수에 곱하는 계수(0 < w ≤ 1). 1 이면 끔. 덧셈 가산이 아니라 곱셈이라 검색어마다 점수 크기가 달라도 같은 비율로 내려간다.
 *   관련도가 훨씬 높은 책이 표지가 없다고 무관한 책 아래로 떨어지지 않도록 0.7 을 시작값으로 둔다 — 완전일치 가산(×10)은 그대로 살아 있다.
 */
@ConfigurationProperties(prefix = "app.search")
public record SearchProperties(String alias, String indexName, Boolean createIndexOnStart, IndexOnStart indexOnStart,
	Double noCoverWeight) {

	public static final String DEFAULT_ALIAS = "books";
	public static final double DEFAULT_NO_COVER_WEIGHT = 0.7;

	/** 기동 시 PG → ES 전체 색인을 언제 돌리나. 색인은 별도 스레드라 readiness 를 막지 않는다. */
	public enum IndexOnStart {
		/** 안 한다(매핑 버전이 달라도 경고만). 테스트·색인을 따로 관리하는 환경. */
		NEVER,
		/** 이번 기동에서 alias 를 새로 만들었을 때(= 빈 인덱스), 또는 alias 가 indexName 이 아닌 옛 인덱스를 가리킬 때(매핑 버전 올림). 기본값. */
		IF_CREATED,
		/** 매 기동마다 전체 색인(+ 매핑 버전 올림 처리). books 가 배치로 자주 바뀌는데 증분 색인이 아직 없을 때. */
		ALWAYS
	}

	public SearchProperties {
		if (alias == null || alias.isBlank()) {
			alias = DEFAULT_ALIAS;
		}
		if (indexName == null || indexName.isBlank()) {
			indexName = alias + "_v4";
		}
		if (createIndexOnStart == null) {
			createIndexOnStart = Boolean.TRUE;
		}
		if (indexOnStart == null) {
			indexOnStart = IndexOnStart.IF_CREATED;
		}
		if (noCoverWeight == null) {
			noCoverWeight = DEFAULT_NO_COVER_WEIGHT;
		}
		if (noCoverWeight <= 0 || noCoverWeight > 1) {
			throw new IllegalArgumentException("app.search.no-cover-weight 는 0 초과 1 이하여야 합니다: " + noCoverWeight);
		}
	}
	// 생성자는 하나만 둔다 — @ConfigurationProperties record 는 생성자가 둘이면 바인딩할 생성자를 못 골라 기동에 실패한다. 테스트는 noCoverWeight 에 null 을 넘기면 기본값.
}
