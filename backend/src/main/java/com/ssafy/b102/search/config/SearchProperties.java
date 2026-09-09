package com.ssafy.b102.search.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.search.* — 도서 검색 인덱스 이름과 기동 시 동작.
 * 애플리케이션은 항상 alias 로 읽고 쓴다. 물리 인덱스(books_v1, books_v2 …)는 재색인 때 새로 만들고 alias 만 옮긴다.
 * 매핑·analyzer 정의는 resources/elasticsearch/books-{settings,mappings}.json 이 진실의 원천이다 (BookDocument 의 @Setting/@Mapping).
 *
 * indexName 은 「지금 매핑 JSON 에 맞는 물리 인덱스 이름」= 매핑 버전이다. JSON 을 바꾸면 이 값을 올린다(books_v2 → books_v3).
 * 기동 시 alias 가 다른 인덱스를 가리키면 SearchIndexInitializer 가 indexName 을 새로 채워 완전할 때만 alias 를 옮긴다(index-on-start != NEVER).
 * 매핑 이력: v1 = 첫 색인.
 *   v2 = ① title/authors .keyword 에 공백 제거 normalizer(exact) — "어린왕자"/"어린 왕자" 완전일치 동일 취급
 *        ② korean analyzer 에서 nori_readingform 제거 — 한자를 독음으로 바꿔 중국어 도서(秋天→추천)가 한국어 검색에 섞이던 것
 *        ③ nori_part_of_speech stoptags 축소(조사·어미·기호·접사만) — 기본값은 부사까지 지워 "지금 추천"의 지금이 사라졌다
 */
@ConfigurationProperties(prefix = "app.search")
public record SearchProperties(String alias, String indexName, Boolean createIndexOnStart, IndexOnStart indexOnStart) {

	public static final String DEFAULT_ALIAS = "books";

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
			indexName = alias + "_v2";
		}
		if (createIndexOnStart == null) {
			createIndexOnStart = Boolean.TRUE;
		}
		if (indexOnStart == null) {
			indexOnStart = IndexOnStart.IF_CREATED;
		}
	}
}
