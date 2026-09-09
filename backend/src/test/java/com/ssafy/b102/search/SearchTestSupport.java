package com.ssafy.b102.search;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.service.BookIndexService;

/**
 * ES 를 쓰는 테스트 공통. 테스트 프로필은 index-on-start=NEVER 라 기동 시 재색인을 안 하므로,
 * 로컬 ES 에 옛 매핑 버전(books_test_v1 …)이 남아 alias 가 그쪽을 가리키면 여기서 동기로 현행 버전으로 맞춘다.
 * CI 는 매번 새 ES 라 ensureIndex 가 곧 현행 인덱스를 만들어 no-op.
 */
final class SearchTestSupport {

	private SearchTestSupport() {
	}

	static void ensureCurrentIndex(BookIndexService indexService, SearchProperties props) {
		indexService.ensureIndex();
		if (!indexService.isCurrent()) {
			indexService.rebuild(props.indexName());
		}
	}
}
