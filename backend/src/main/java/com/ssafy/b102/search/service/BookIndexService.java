package com.ssafy.b102.search.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.elasticsearch.BulkFailureException;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.IndexOperations;
import org.springframework.data.elasticsearch.core.document.Document;
import org.springframework.data.elasticsearch.core.index.AliasAction;
import org.springframework.data.elasticsearch.core.index.AliasActionParameters;
import org.springframework.data.elasticsearch.core.index.AliasActions;
import org.springframework.data.elasticsearch.core.index.AliasData;
import org.springframework.data.elasticsearch.core.index.Settings;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.data.elasticsearch.core.query.IndexQuery;
import org.springframework.data.elasticsearch.core.query.IndexQueryBuilder;
import org.springframework.data.elasticsearch.core.query.Query;
import org.springframework.stereotype.Service;

import com.ssafy.b102.book.entity.Book;
import com.ssafy.b102.book.repository.BookRepository;
import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.document.BookDocument;

/**
 * 도서 검색 인덱스 관리 — 생성·alias 연결, PG books → ES bulk 색인, 재색인·alias 전환.
 *
 * 인덱스 구성은 BookDocument 의 @Setting/@Mapping 이 가리키는 elasticsearch/books_v1-*.json 을 그대로 올린다.
 * 물리 인덱스 이름(app.search.index-name)과 alias(app.search.alias)를 분리해 두어, 매핑을 바꿀 때는
 * 새 물리 인덱스를 만들어 채운 뒤 alias 만 옮긴다(체크리스트 #23 "재색인과 alias 전환"). 옛 인덱스는 지우지 않는다 — 되돌릴 수 있게.
 *
 * 색인은 PG 를 id 순으로 {@value #BATCH_SIZE}건씩 읽어(keyset, OFFSET 없음) bulk 로 넣는다. 문서 _id = books.id 라 다시 넣으면 덮어쓴다(멱등).
 * 한 배치 안에서 일부 문서가 거부되면(매핑 위반 등) 그 문서만 실패로 세고 계속 간다 — 색인 실패가 다른 책을 막지 않는다.
 * ES 접속 자체가 안 되면 예외를 그대로 던진다. 호출자(초기화·배치)가 로그를 남긴다.
 */
@Service
public class BookIndexService {

	private static final Logger log = LoggerFactory.getLogger(BookIndexService.class);
	static final int BATCH_SIZE = 1000;

	private final ElasticsearchOperations operations;
	private final SearchProperties props;
	private final BookRepository bookRepository;
	private final BookDocumentMapper mapper;

	public BookIndexService(ElasticsearchOperations operations, SearchProperties props,
		BookRepository bookRepository, BookDocumentMapper mapper) {
		this.operations = operations;
		this.props = props;
		this.bookRepository = bookRepository;
		this.mapper = mapper;
	}

	/** 색인 1회 결과. failed 는 ES 가 거부한 문서 수(로그에 id·사유가 남는다). */
	public record IndexReport(String index, long indexed, long failed, Duration elapsed) {
		public long total() {
			return indexed + failed;
		}
	}

	// ── 인덱스·alias ──

	/**
	 * alias 가 없으면 물리 인덱스를 만들고(이미 있으면 재사용) alias 를 건다. 멱등 — 여러 인스턴스가 동시에 불러도 안전하다.
	 *
	 * @return 이번 호출에서 alias 를 새로 걸었으면 true. alias 가 이미 어딘가를 가리키면 손대지 않고 false.
	 */
	public boolean ensureIndex() {
		String alias = props.alias();
		String indexName = props.indexName();

		IndexOperations aliasOps = operations.indexOps(IndexCoordinates.of(alias));
		if (aliasOps.exists()) {
			log.debug("검색 alias '{}' 가 이미 있습니다: {}", alias, aliasTargets(aliasOps));
			return false;
		}

		IndexOperations physical = operations.indexOps(IndexCoordinates.of(indexName));
		if (!physical.exists()) {
			createIndex(indexName);
		}

		physical.alias(new AliasActions(new AliasAction.Add(
			AliasActionParameters.builder().withIndices(indexName).withAliases(alias).build())));
		log.info("검색 alias '{}' → '{}' 연결", alias, indexName);
		return true;
	}

	/** books_v1-settings.json + books_v1-mappings.json 으로 물리 인덱스를 만든다. 이미 있으면 ES 가 400 을 낸다. */
	public void createIndex(String indexName) {
		IndexOperations entityOps = operations.indexOps(BookDocument.class);
		Settings settings = entityOps.createSettings();
		Document mapping = entityOps.createMapping();
		operations.indexOps(IndexCoordinates.of(indexName)).create(settings, mapping);
		log.info("검색 인덱스 '{}' 생성 (shards={}, replicas={})", indexName,
			settings.get("index.number_of_shards"), settings.get("index.number_of_replicas"));
	}

	/**
	 * alias 를 newIndex 하나만 가리키게 바꾼다 — 기존 대상 제거 + 새 대상 추가를 한 요청으로(원자적). 검색이 빈 결과를 보는 순간이 없다.
	 *
	 * @return 이전에 alias 가 가리키던 물리 인덱스들. 되돌리거나 지울 때 쓴다.
	 */
	public Set<String> switchAlias(String newIndex) {
		Set<String> previous = aliasTargets();
		List<AliasAction> actions = new ArrayList<>();
		for (String old : previous) {
			if (!old.equals(newIndex)) {
				actions.add(new AliasAction.Remove(AliasActionParameters.builder().withIndices(old).withAliases(props.alias()).build()));
			}
		}
		if (!previous.contains(newIndex)) {
			actions.add(new AliasAction.Add(AliasActionParameters.builder().withIndices(newIndex).withAliases(props.alias()).build()));
		}
		if (actions.isEmpty()) {
			return previous;
		}
		operations.indexOps(IndexCoordinates.of(newIndex)).alias(new AliasActions(actions.toArray(AliasAction[]::new)));
		log.info("검색 alias '{}' 전환: {} → {}", props.alias(), previous, newIndex);
		return previous;
	}

	/** alias 가 가리키는 물리 인덱스 이름들. 없으면 빈 집합. */
	public Set<String> aliasTargets() {
		return aliasTargets(operations.indexOps(IndexCoordinates.of(props.alias())));
	}

	private Set<String> aliasTargets(IndexOperations aliasOps) {
		if (!aliasOps.exists()) {
			return Set.of();
		}
		// alias 이름으로 indexOps 를 열면 getAliases 는 { 물리인덱스 → [AliasData] } 로 돌아온다
		return aliasOps.getAliases(props.alias()).entrySet().stream()
			.filter(e -> e.getValue().stream().map(AliasData::getAlias).anyMatch(props.alias()::equals))
			.map(e -> e.getKey())
			.collect(Collectors.toUnmodifiableSet());
	}

	// ── 색인 ──

	/** PG books 전체를 alias 로 색인한다(덮어쓰기). 기동 시 자동 색인·수동 전체 재색인용. */
	public IndexReport indexAll() {
		return indexInto(props.alias(), lastId -> bookRepository.findByIdGreaterThanOrderByIdAsc(lastId, batch()));
	}

	/**
	 * updated_at 이 since 이후인 책만 alias 로 색인한다. 배치가 books 를 갱신한 뒤 증분 반영용.
	 * 추가·수정만 반영한다 — PG 에서 지워진 책의 문서는 남는다. 지금 수집기는 물리 삭제를 하지 않아 문제 없고,
	 * 삭제 정책이 생기면 (a) 삭제 id 를 받아 operations.delete 하거나 (b) reindexInto 로 전체를 다시 만드는 쪽(새 인덱스는 PG 만 보고 만들어지므로 자연히 빠진다)을 붙인다.
	 */
	public IndexReport indexUpdatedSince(Instant since) {
		return indexInto(props.alias(),
			lastId -> bookRepository.findByUpdatedAtAfterAndIdGreaterThanOrderByIdAsc(since, lastId, batch()));
	}

	/**
	 * 새 물리 인덱스를 만들어 PG 전체를 채운 뒤, **완전할 때만** alias 를 옮긴다. 매핑·analyzer 를 바꿨을 때의 절차.
	 * 옛 인덱스는 남긴다 — 문제가 있으면 switchAlias(옛 이름) 으로 즉시 되돌린다. 확인 뒤 사람이 지운다.
	 *
	 * @param newIndex 새 물리 인덱스 이름 (예: books_v2). 이미 있으면 실패한다.
	 * @throws IncompleteIndexException 거부된 문서가 있거나 ES 문서 수가 PG 행수와 다르면. alias 는 그대로, 새 인덱스는 조사용으로 남는다
	 */
	public IndexReport reindexInto(String newIndex) {
		createIndex(newIndex);
		return populateAndSwitch(newIndex);
	}

	/**
	 * 이미 만들어진(빈) 물리 인덱스를 PG 전체로 채우고 alias 를 옮긴다. reindexInto 의 뒷부분.
	 * 전환 조건: 거부 0건 이고 새 인덱스의 문서 수 == PG books 행수. 하나라도 어긋나면 alias 를 건드리지 않고 IncompleteIndexException.
	 * 일부만 들어간 인덱스로 alias 를 바꾸면 빠진 책이 검색에서 조용히 사라지기 때문이다(리뷰 P1).
	 */
	public IndexReport populateAndSwitch(String newIndex) {
		IndexReport report = indexInto(newIndex, lastId -> bookRepository.findByIdGreaterThanOrderByIdAsc(lastId, batch()));
		long expected = bookRepository.count();
		long actual = operations.count(Query.findAll(), BookDocument.class, IndexCoordinates.of(newIndex));
		if (report.failed() > 0 || actual != expected) {
			log.error("재색인 불완전 — alias '{}' 를 옮기지 않습니다. index={} 거부={} ES문서={} PG행={}. 인덱스는 조사용으로 남겨 둡니다.",
				props.alias(), newIndex, report.failed(), actual, expected);
			throw new IncompleteIndexException(report, expected, actual);
		}
		Set<String> previous = switchAlias(newIndex);
		log.info("재색인 완료: {} (이전 {}) — {}건 색인, PG {}행과 일치, {}", newIndex, previous, report.indexed(), expected, report.elapsed());
		return report;
	}

	/** 색인 직후 검색에 보이게. 테스트·재색인 마지막에 부른다(운영 검색 경로에서는 부르지 않는다 — refresh_interval 에 맡긴다). */
	public void refresh(String index) {
		operations.indexOps(IndexCoordinates.of(index)).refresh();
	}

	private static Pageable batch() {
		return PageRequest.of(0, BATCH_SIZE);
	}

	private IndexReport indexInto(String target, Function<Long, List<Book>> nextBatch) {
		Instant started = Instant.now();
		IndexCoordinates coords = IndexCoordinates.of(target);
		long indexed = 0;
		long failed = 0;
		long lastId = 0;
		while (true) {
			List<Book> books = nextBatch.apply(lastId);
			if (books.isEmpty()) {
				break;
			}
			lastId = books.get(books.size() - 1).getId();
			List<IndexQuery> queries = books.stream()
				.map(mapper::toDocument)
				.map(doc -> new IndexQueryBuilder().withId(String.valueOf(doc.getId())).withObject(doc).build())
				.toList();
			try {
				operations.bulkIndex(queries, coords);
				indexed += queries.size();
			} catch (BulkFailureException e) {
				// 일부만 거부됨(매핑 위반 등). 나머지는 들어갔다. 거부된 것만 세고 계속 간다.
				int rejected = e.getFailedDocuments().size();
				failed += rejected;
				indexed += queries.size() - rejected;
				e.getFailedDocuments().forEach((id, detail) ->
					log.warn("색인 거부 index={} id={} status={} reason={}", target, id, detail.status(), detail.errorMessage()));
			}
			if (indexed % (BATCH_SIZE * 20) == 0) {
				log.info("색인 진행 index={} {}건 (마지막 id {})", target, indexed, lastId);
			}
		}
		refresh(target);
		IndexReport report = new IndexReport(target, indexed, failed, Duration.between(started, Instant.now()));
		log.info("색인 완료 index={} {}건 색인, {}건 실패, {}", target, indexed, failed, report.elapsed());
		return report;
	}
}
