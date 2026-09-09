package com.ssafy.b102.search.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Component;

import com.ssafy.b102.search.config.SearchProperties.IndexOnStart;
import com.ssafy.b102.search.service.BookIndexService;

/**
 * 기동 시 검색 인덱스를 준비한다.
 *   1) alias 가 없으면 만든다 (app.search.create-index-on-start, 동기)
 *   2) PG → ES 전체 색인 (app.search.index-on-start: NEVER / IF_CREATED / ALWAYS) — 별도 스레드. 수십만 권이면 몇 분 걸리므로 readiness 를 막지 않는다.
 *
 * ES 가 죽어 있어도 기동은 계속한다 — 검색 장애가 로그인·서재를 막지 않게 한다(MVP 구현 원칙 8).
 * 그 경우 검색 API 는 SEARCH_UNAVAILABLE 을 내고, ES 가 살아난 뒤 재기동하면 다시 시도한다.
 */
@Component
public class SearchIndexInitializer implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(SearchIndexInitializer.class);

	private final BookIndexService indexService;
	private final SearchProperties props;
	private final TaskExecutor taskExecutor;

	public SearchIndexInitializer(BookIndexService indexService, SearchProperties props, TaskExecutor taskExecutor) {
		this.indexService = indexService;
		this.props = props;
		this.taskExecutor = taskExecutor;
	}

	@Override
	public void run(ApplicationArguments args) {
		if (!props.createIndexOnStart()) {
			log.info("app.search.create-index-on-start=false — 검색 인덱스 자동 생성 건너뜀 (alias={})", props.alias());
			return;
		}
		boolean created;
		try {
			created = indexService.ensureIndex();
			log.info("검색 인덱스 준비 완료: alias={} → {} ({})", props.alias(), indexService.aliasTargets(),
				created ? "새로 연결" : "기존 사용");
		} catch (RuntimeException e) {
			// 접속 실패·타임아웃·권한 오류 전부. 기동은 막지 않는다.
			log.error("검색 인덱스 준비 실패 — Elasticsearch 에 접속할 수 없거나 인덱스 생성이 거부되었습니다. "
				+ "검색 API 는 복구될 때까지 SEARCH_UNAVAILABLE 을 냅니다. alias={}, index={}", props.alias(), props.indexName(), e);
			return;
		}

		IndexOnStart mode = props.indexOnStart();
		boolean shouldIndex = mode == IndexOnStart.ALWAYS || (mode == IndexOnStart.IF_CREATED && created);
		if (!shouldIndex) {
			log.info("기동 시 전체 색인 건너뜀 (index-on-start={}, alias 새로 만듦={})", mode, created);
			return;
		}
		log.info("기동 시 전체 색인 시작 (index-on-start={}) — 백그라운드에서 PG books → {}", mode, props.alias());
		taskExecutor.execute(() -> {
			try {
				BookIndexService.IndexReport report = indexService.indexAll();
				log.info("기동 시 전체 색인 끝: {}건 색인, {}건 실패, {}", report.indexed(), report.failed(), report.elapsed());
			} catch (RuntimeException e) {
				log.error("기동 시 전체 색인 실패 — 인덱스는 비어 있거나 일부만 채워졌습니다. 재기동 또는 수동 색인이 필요합니다.", e);
			}
		});
	}
}
