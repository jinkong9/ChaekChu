package com.ssafy.b102.search.document;

import java.time.Instant;
import java.util.List;

import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.DateFormat;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;
import org.springframework.data.elasticsearch.annotations.Mapping;
import org.springframework.data.elasticsearch.annotations.Setting;
import org.springframework.data.elasticsearch.annotations.WriteTypeHint;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * ES 도서 문서 — V1 books 한 행을 검색용으로 옮긴 읽기 모델. PG 가 원천이고 이 문서는 색인기(BookIndexService)가 만든다.
 *
 * 필드 타입·analyzer 는 여기의 어노테이션이 아니라 elasticsearch/books-mappings.json 이 결정한다(@Mapping).
 * 매핑을 바꾸면 app.search.index-name 을 올린다(books_v3 → v4). 배포 시 SearchIndexInitializer 가 새 인덱스를 채우고 alias 를 옮긴다.
 * 매핑이 dynamic=strict 라 여기에 필드를 더하면 JSON 도 같이 고쳐야 한다. Spring Data 의 _class 힌트도 그래서 끈다.
 *
 * indexName 은 alias(app.search.alias). 물리 인덱스 이름은 SearchProperties.indexName — 재색인 때 v2, v3 로 바뀌어도 코드는 alias 만 본다.
 * createIndex=false: 인덱스는 BookIndexService.ensureIndex() 가 JSON 기준으로 만들고 alias 를 건다. 어노테이션 자동 생성에 맡기지 않는다.
 *
 * V1 매핑: id ← books.id · isbn13 · title · authors ← author 를 구분자·역할어로 나눈 배열(원문은 authorRaw) · publisher · pubYear ← pub_year
 *          categoryCode ← category_code(KDC) · coverUrl ← cover_url · updatedAt ← updated_at(증분 색인 기준). description 은 색인하지 않는다(검색 대상 아님, bigram 크기).
 */
@Document(indexName = "#{@environment.getProperty('app.search.alias', 'books')}", createIndex = false, writeTypeHint = WriteTypeHint.FALSE)
@Setting(settingPath = "elasticsearch/books-settings.json")
@Mapping(mappingPath = "elasticsearch/books-mappings.json")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class BookDocument {

	/** books.id. 문서 _id 이자 정렬 tie-break 키(_score 같으면 id 오름차순). */
	@Id
	private Long id;

	private String isbn13;

	private String title;

	/** 역할어(지음·옮김·글·그림 등) 를 뗀 저자명 배열. API BookSummary.authors 로 그대로 나간다. 없으면 빈 배열. */
	private List<String> authors;

	/** books.author 원문. 검색·집계에 쓰지 않고 디버그·재파싱용으로만 둔다. */
	private String authorRaw;

	private String publisher;

	private Integer pubYear;

	/** KDC 코드(books.category_code). API classNo. */
	private String categoryCode;

	private String coverUrl;

	/**
	 * coverUrl 이 비어 있지 않은가 (매핑 v3). coverUrl 은 index=false 라 exists 로 물을 수 없어 따로 둔다.
	 * 검색 순위에서 표지 없는 문서에 app.search.no-cover-weight 를 곱한다(ElasticsearchBookSearchRepository).
	 */
	private Boolean hasCover;

	/**
	 * book_demand_features.loan_cum — 원장 누적 대출 합(최신 스냅샷). 매핑 v4.
	 * 분류만으로 조회할 때(q 없이 kdc 만) 정렬 키다. 수요 지표가 없는 책(약 57만 권)은 null 이고 정렬에서 뒤로 간다.
	 */
	private Long loanCum;

	/** books.updated_at. 증분 색인이 "이 시각 이후 바뀐 행" 을 고르는 기준. */
	@Field(type = FieldType.Date, format = DateFormat.date_time)
	private Instant updatedAt;
}
