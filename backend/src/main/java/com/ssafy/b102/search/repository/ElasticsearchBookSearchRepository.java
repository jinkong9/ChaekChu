package com.ssafy.b102.search.repository;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.client.elc.NativeQueryBuilder;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHit;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.stereotype.Repository;

import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;

import co.elastic.clients.elasticsearch._types.FieldValue;
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.mapping.FieldType;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionBoostMode;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionScoreMode;
import co.elastic.clients.elasticsearch._types.query_dsl.Operator;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.TextQueryType;

/**
 * Spring Data ES 의 NativeQuery(= 공식 Java 클라이언트 DSL)로 검색한다. derived query 로는 필드 가중치·서브필드·동점 정렬을 못 쓴다.
 *
 * 검색어가 있을 때의 점수식 (bool.should, minimum_should_match=1 — 셋 중 하나라도 맞으면 후보). 아래는 scope=ALL(기본)의 필드다:
 *   ① multi_match cross_fields AND  title^3 · authors^2 · publisher   — 검색어의 모든 형태소가 세 필드 어딘가에 있어야 한다.
 *        "한강 소년" 처럼 저자+제목이 섞인 검색어를 받아 준다. 세 필드 analyzer 가 같아(korean) cross_fields 가 성립한다.
 *   ② multi_match phrase          title.ngram^1.5 · authors.ngram     — 공백을 지운 2-gram 연속 일치. "어린왕자"↔"어린 왕자", 사전에 없는 고유명사.
 *   ③ term                        title.keyword ×10                    — 제목이 검색어와 글자까지 같으면 맨 위.
 *   ④ function_score              hasCover=false 이면 × noCoverWeight   — 표지 없는 판본을 조금 내린다(매핑 v3, 기본 0.7). 곱셈이라 ①~③ 의 서열은 유지.
 * 가중치는 실제 카탈로그를 색인한 뒤 대표 검색어로 조정한다. 여기 숫자는 시작값이다.
 *
 * 검색 범위(scope, 09-17): ①~③ 에 들어가는 필드 목록만 범위에 따라 바뀐다(FIELDS). ALL 이 위의 식 그대로고,
 *   TITLE·AUTHOR 는 그 필드 하나의 형태소·bigram·완전일치, PUBLISHER 는 형태소만 본다 — 섞인 검색어를 못 받는 것은 의도된 동작이다.
 *   매핑은 그대로라 재색인이 없다: title·authors·publisher 가 이미 각각 필드고 .ngram·.keyword 서브필드가 있다. ④·kdc 필터·정렬은 범위와 무관.
 *
 * KDC 필터(매핑 v4)는 점수에 끼지 않는 bool.filter 의 prefix 절이다 — categoryCode 가 keyword 라 "813.62" 가 "8"·"81"·"813" 에 걸린다.
 * 정렬은 검색어가 있으면 _score → loanCum(누적 대출) 내림차순 → id, 없으면 loanCum 내림차순 → id 다(동점 규칙 09-16).
 *   같은 작품의 판본은 제목이 같아 점수가 정확히 같다 — 운영에서 「데미안」은 표지 있는 완전일치 판본 151종이 동점이었다. 동점을 id 로만 가르면
 *   가장 먼저 적재된 판본(출판사 미상 전집 권, 대출 72)이 1위가 되므로 대출 많은 판본(민음사, 12.8만)을 앞세운다. 관련도 서열은 그대로고 동점 안에서만 바뀐다.
 *   값이 없는 책(수요 스냅샷에 없는 약 57만 권)은 뒤로 보낸다. 검색어 없이 분류만 조회할 때는 점수가 없으므로 loanCum 이 1차 키다.
 * loanCum 정렬에는 unmappedType 을 준다 — v4 재색인 동안 alias 가 아직 v3(그 필드가 없는 인덱스)를 가리켜도 500 이 아니라 "전부 없음" 으로 동작한다.
 */
@Repository
public class ElasticsearchBookSearchRepository implements BookSearchRepository {

	/** ③ 검색어와 글자까지 같은 문서에 곱하는 가중. 완전일치가 형태소·부분일치 위에 서게 하는 값이라 범위와 무관하게 같다. */
	private static final float EXACT_BOOST = 10f;

	/**
	 * 범위별로 점수식 ①~③ 에 들어가는 필드. ④(표지 가중)·정렬은 범위와 무관.
	 * ALL 은 09-17 이전의 필드 목록 그대로다. 단일 필드 범위에서는 cross_fields 가 그 필드 하나의 match(AND)와 같다.
	 * PUBLISHER 는 매핑에 bigram 서브필드가 없어 ② 가 비고, ③ 도 두지 않는다 — publisher.keyword 에 normalizer 가 없어 "문학동네"/"문학 동네" 중 원문과 글자까지 같은 쪽만
 *   ×10 으로 튀어, 같은 출판사 안에서 대출순으로 서야 할 책들이 표기 변형으로 두 층으로 갈린다. normalizer 를 붙인 매핑 v7 에서 되살릴 수 있다.
	 */
	private static final Map<SearchScope, ScopeFields> FIELDS = Map.of(
		SearchScope.ALL, new ScopeFields(List.of("title^3", "authors^2", "publisher"), List.of("title.ngram^1.5", "authors.ngram"), "title.keyword"),
		SearchScope.TITLE, new ScopeFields(List.of("title"), List.of("title.ngram"), "title.keyword"),
		SearchScope.AUTHOR, new ScopeFields(List.of("authors"), List.of("authors.ngram"), "authors.keyword"),
		SearchScope.PUBLISHER, new ScopeFields(List.of("publisher"), List.of(), null));

	/**
	 * @param morpheme ① cross_fields AND 대상(가중치 포함 표기)
	 * @param ngram    ② phrase 대상. 비면 ② 를 만들지 않는다
	 * @param exact    ③ term 대상 keyword 필드. null 이면 ③ 을 만들지 않는다(PUBLISHER)
	 */
	private record ScopeFields(List<String> morpheme, List<String> ngram, String exact) {
	}

	private final ElasticsearchOperations operations;
	private final SearchProperties props;

	public ElasticsearchBookSearchRepository(ElasticsearchOperations operations, SearchProperties props) {
		this.operations = operations;
		this.props = props;
	}

	@Override
	public BookSearchResult search(String q, String kdcPrefix, SearchScope scope, int page, int size) {
		boolean byQuery = q != null && !q.isBlank();
		boolean byKdc = kdcPrefix != null && !kdcPrefix.isBlank();
		SearchScope resolved = Objects.requireNonNullElse(scope, SearchScope.ALL);

		Query query = Query.of(b -> b.bool(bool -> {
			if (byQuery) {
				bool.must(relevance(q, resolved));
			}
			if (byKdc) {
				bool.filter(f -> f.prefix(p -> p.field("categoryCode").value(kdcPrefix)));
			}
			return bool;
		}));

		NativeQueryBuilder builder = NativeQuery.builder()
			.withQuery(query)
			.withPageable(PageRequest.of(page, size))
			.withTrackTotalHits(true);
		if (byQuery) {
			builder.withSort(s -> s.score(sc -> sc.order(SortOrder.Desc)));
		}
		// 검색어가 있으면 동점(같은 작품의 판본) 안에서, 없으면 1차 키로 — 누적 대출 많은 판본이 앞. 값이 없으면 뒤.
		builder.withSort(s -> s.field(f -> f.field("loanCum").order(SortOrder.Desc)
			.missing(FieldValue.of("_last")).unmappedType(FieldType.Long)));
		builder.withSort(s -> s.field(f -> f.field("id").order(SortOrder.Asc)));

		SearchHits<BookDocument> hits = operations.search(builder.build(), BookDocument.class, alias());
		return new BookSearchResult(hits.getTotalHits(), hits.getSearchHits().stream().map(SearchHit::getContent).toList());
	}

	/** ①~④ 를 합친 관련도 절. 검색어가 있을 때만 쓴다. 범위는 ①~③ 의 필드 목록만 바꾼다. */
	private Query relevance(String q, SearchScope scope) {
		ScopeFields fields = FIELDS.get(scope);
		Query scored = Query.of(b -> b.bool(bool -> {
			bool.should(s -> s.multiMatch(m -> m.query(q).fields(fields.morpheme())
				.type(TextQueryType.CrossFields).operator(Operator.And)));
			if (!fields.ngram().isEmpty()) {
				bool.should(s -> s.multiMatch(m -> m.query(q).fields(fields.ngram())
					.type(TextQueryType.Phrase)));
			}
			if (fields.exact() != null) {
				bool.should(s -> s.term(t -> t.field(fields.exact()).value(q).boost(EXACT_BOOST)));
			}
			return bool.minimumShouldMatch("1");
		}));

		// 표지 없는 문서(hasCover=false)는 점수 × noCoverWeight. 후보 집합은 그대로고 순서만 바뀐다 — 곱셈이라 완전일치(×10)를 뒤집지는 못한다.
		// hasCover 가 없는 옛 문서(v2)는 필터에 안 걸려 그대로다.
		return Query.of(b -> b.functionScore(fs -> fs
			.query(scored)
			.functions(fn -> fn
				.filter(f -> f.term(t -> t.field("hasCover").value(false)))
				.weight(props.noCoverWeight()))
			.scoreMode(FunctionScoreMode.Multiply)
			.boostMode(FunctionBoostMode.Multiply)));
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
