package com.ssafy.b102.search.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.search.* — 도서 검색 인덱스 이름과 기동 시 동작.
 * 애플리케이션은 항상 alias 로 읽고 쓴다. 물리 인덱스(books_v1, books_v2 …)는 재색인 때 새로 만들고 alias 만 옮긴다.
 * 매핑·analyzer 정의는 resources/elasticsearch/books_v1-{settings,mappings}.json 이 진실의 원천이다 (BookDocument 의 @Setting/@Mapping).
 */
@ConfigurationProperties(prefix = "app.search")
public record SearchProperties(String alias, String indexName, Boolean createIndexOnStart, IndexOnStart indexOnStart) {

	public static final String DEFAULT_ALIAS = "books";

	/** 기동 시 PG → ES 전체 색인을 언제 돌리나. 색인은 별도 스레드라 readiness 를 막지 않는다. */
	public enum IndexOnStart {
		/** 안 한다. 테스트·색인을 따로 관리하는 환경. */
		NEVER,
		/** 이번 기동에서 alias 를 새로 만들었을 때만(= 빈 인덱스). 첫 배포·볼륨 초기화 뒤 자동 채움. 기본값. */
		IF_CREATED,
		/** 매 기동마다. books 가 배치로 자주 바뀌는데 증분 색인이 아직 없을 때. */
		ALWAYS
	}

	public SearchProperties {
		if (alias == null || alias.isBlank()) {
			alias = DEFAULT_ALIAS;
		}
		if (indexName == null || indexName.isBlank()) {
			indexName = alias + "_v1";
		}
		if (createIndexOnStart == null) {
			createIndexOnStart = Boolean.TRUE;
		}
		if (indexOnStart == null) {
			indexOnStart = IndexOnStart.IF_CREATED;
		}
	}
}
