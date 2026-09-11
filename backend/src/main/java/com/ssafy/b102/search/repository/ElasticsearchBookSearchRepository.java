package com.ssafy.b102.search.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHit;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.stereotype.Repository;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;

import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionBoostMode;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionScoreMode;
import co.elastic.clients.elasticsearch._types.query_dsl.Operator;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.TextQueryType;

/**
 * Spring Data ES 의 NativeQuery(= 공식 Java 클라이언트 DSL)로 검색한다. derived query 로는 필드 가중치·서브필드·동점 정렬을 못 쓴다.
 *
 * 점수식 (bool.should, minimum_should_match=1 — 셋 중 하나라도 맞으면 후보):
 *   ① multi_match cross_fields AND  title^3 · authors^2 · publisher   — 검색어의 모든 형태소가 세 필드 어딘가에 있어야 한다.
 *        "한강 소년" 처럼 저자+제목이 섞인 검색어를 받아 준다. 세 필드 analyzer 가 같아(korean) cross_fields 가 성립한다.
 *   ② multi_match phrase          title.ngram^1.5 · authors.ngram     — 공백을 지운 2-gram 연속 일치. "어린왕자"↔"어린 왕자", 사전에 없는 고유명사.
 *   ③ term                        title.keyword ×10                    — 제목이 검색어와 글자까지 같으면 맨 위.
 *   ④ function_score              hasCover=false 이면 × noCoverWeight   — 표지 없는 판본을 조금 내린다(매핑 v3, 기본 0.7). 곱셈이라 ①~③ 의 서열은 유지.
 * 가중치는 실제 카탈로그를 색인한 뒤 대표 검색어로 조정한다. 여기 숫자는 시작값이다.
 */
@Repository
public class ElasticsearchBookSearchRepository implements BookSearchRepository {

	private static final List<String> MORPHEME_FIELDS = List.of("title^3", "authors^2", "publisher");
	private static final List<String> NGRAM_FIELDS = List.of("title.ngram^1.5", "authors.ngram");
	private static final float EXACT_TITLE_BOOST = 10f;

	private final ElasticsearchOperations operations;
	private final SearchProperties props;

	public ElasticsearchBookSearchRepository(ElasticsearchOperations operations, SearchProperties props) {
		this.operations = operations;
		this.props = props;
	}

	@Override
	public BookSearchResult search(String q, int page, int size) {
		Query relevance = Query.of(b -> b.bool(bool -> bool
			.should(s -> s.multiMatch(m -> m.query(q).fields(MORPHEME_FIELDS)
				.type(TextQueryType.CrossFields).operator(Operator.And)))
			.should(s -> s.multiMatch(m -> m.query(q).fields(NGRAM_FIELDS)
				.type(TextQueryType.Phrase)))
			.should(s -> s.term(t -> t.field("title.keyword").value(q).boost(EXACT_TITLE_BOOST)))
			.minimumShouldMatch("1")));

		// ④ 표지 없는 문서(hasCover=false)는 점수 × noCoverWeight. 후보 집합은 그대로고 순서만 바뀐다 — 곱셈이라 완전일치(×10)를 뒤집지는 못한다.
		//    hasCover 가 없는 옛 문서(v2)는 필터에 안 걸려 그대로다.
		Query query = Query.of(b -> b.functionScore(fs -> fs
			.query(relevance)
			.functions(fn -> fn
				.filter(f -> f.term(t -> t.field("hasCover").value(false)))
				.weight(props.noCoverWeight()))
			.scoreMode(FunctionScoreMode.Multiply)
			.boostMode(FunctionBoostMode.Multiply)));

		NativeQuery nativeQuery = NativeQuery.builder()
			.withQuery(query)
			.withPageable(PageRequest.of(page, size))
			.withSort(s -> s.score(sc -> sc.order(SortOrder.Desc)))
			.withSort(s -> s.field(f -> f.field("id").order(SortOrder.Asc)))
			.withTrackTotalHits(true)
			.build();

		SearchHits<BookDocument> hits = operations.search(nativeQuery, BookDocument.class, alias());
		return new BookSearchResult(hits.getTotalHits(), hits.getSearchHits().stream().map(SearchHit::getContent).toList());
	}

	@Override
	public Optional<BookDocument> findByIsbn13(String isbn13) {
		NativeQuery nativeQuery = NativeQuery.builder()
			.withQuery(q -> q.term(t -> t.field("isbn13").value(isbn13)))
			.withMaxResults(1)
			.build();
		SearchHits<BookDocument> hits = operations.search(nativeQuery, BookDocument.class, alias());
		return hits.getSearchHits().stream().findFirst().map(SearchHit::getContent);
	}

	private IndexCoordinates alias() {
		return IndexCoordinates.of(props.alias());
	}
}
