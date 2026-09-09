package com.ssafy.b102.search;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.service.BookIndexService;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.AnalyzeResponse;
import co.elastic.clients.elasticsearch.indices.GetMappingResponse;
import co.elastic.clients.elasticsearch.indices.analyze.AnalyzeToken;

/**
 * 1단계 — 기동 시 books 인덱스가 books_v1-*.json 대로 만들어지고 alias 가 걸리는지, analyzer 가 의도대로 토큰을 내는지.
 * 실제 Elasticsearch(nori) 필요 — CI compose 또는 로컬 스택. 테스트 프로필은 alias=books_test 라 운영·로컬 인덱스와 섞이지 않는다.
 */
@SpringBootTest
@ActiveProfiles("test")
class BookIndexBootstrapTest {

	@Autowired ElasticsearchClient client;
	@Autowired BookIndexService indexService;
	@Autowired SearchProperties props;

	@Test
	@DisplayName("기동 후 alias 가 물리 인덱스를 가리키고, 다시 ensureIndex 를 불러도 손대지 않는다(멱등)")
	void alias_points_to_physical_index() {
		assertThat(props.alias()).isEqualTo("books_test");
		assertThat(indexService.aliasTargets()).containsExactly(props.indexName());
		assertThat(indexService.ensureIndex()).isFalse();
		assertThat(indexService.aliasTargets()).containsExactly(props.indexName());
	}

	@Test
	@DisplayName("매핑: title/authors 는 korean analyzer + ngram 서브필드, dynamic=strict")
	void mapping_applied_from_json() throws IOException {
		GetMappingResponse res = client.indices().getMapping(g -> g.index(props.indexName()));
		var mapping = res.result().get(props.indexName()).mappings();

		assertThat(mapping.dynamic().jsonValue()).isEqualTo("strict");
		assertThat(mapping.properties()).containsKeys("id", "isbn13", "title", "authors", "publisher", "pubYear", "categoryCode", "coverUrl", "updatedAt");
		assertThat(mapping.properties().get("title").text().analyzer()).isEqualTo("korean");
		assertThat(mapping.properties().get("title").text().fields()).containsKeys("ngram", "keyword");
		assertThat(mapping.properties().get("title").text().fields().get("ngram").text().analyzer()).isEqualTo("bigram");
		assertThat(mapping.properties().get("authors").text().fields()).containsKey("ngram");
		assertThat(mapping.properties().get("isbn13").isKeyword()).isTrue();
	}

	@Test
	@DisplayName("bigram: 공백을 지운 뒤 2글자씩 — '어린 왕자' 와 '어린왕자' 가 같은 토큰을 낸다")
	void bigram_ignores_whitespace() throws IOException {
		assertThat(tokens("bigram", "어린 왕자")).containsExactly("어린", "린왕", "왕자");
		assertThat(tokens("bigram", "어린왕자")).containsExactly("어린", "린왕", "왕자");
		assertThat(tokens("bigram", "Harry Potter")).containsExactly("ha", "ar", "rr", "ry", "yp", "po", "ot", "tt", "te", "er");
	}

	@Test
	@DisplayName("korean(nori): 조사를 떼고 형태소로 — '왕자와 거지' → 왕자, 거지")
	void korean_strips_particles() throws IOException {
		List<String> t = tokens("korean", "왕자와 거지");
		assertThat(t).contains("왕자", "거지").doesNotContain("와", "왕자와");
	}

	@Test
	@DisplayName("korean(nori): 사전 복합어는 원형과 분해형을 함께(mixed) — '경제학원론' 을 '경제학'·'원론' 으로도 찾는다")
	void korean_decompounds_mixed() throws IOException {
		// 사전에 없는 붙여쓰기('한국문학')는 분해형만 나온다: [한국, 문학]. 원형까지 나오는 건 사전 복합어일 때.
		assertThat(tokens("korean", "경제학원론")).contains("경제학", "경제", "원론");
		assertThat(tokens("korean", "한국문학")).containsExactly("한국", "문학");
	}

	private List<String> tokens(String analyzer, String text) throws IOException {
		AnalyzeResponse res = client.indices().analyze(a -> a.index(props.indexName()).analyzer(analyzer).text(text));
		return res.tokens().stream().map(AnalyzeToken::token).toList();
	}
}
