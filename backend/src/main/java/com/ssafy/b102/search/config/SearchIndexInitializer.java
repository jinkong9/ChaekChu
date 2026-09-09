package com.ssafy.b102.search.config;

import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Component;

import com.ssafy.b102.search.config.SearchProperties.IndexOnStart;
import com.ssafy.b102.search.service.BookIndexService;
import com.ssafy.b102.search.service.BookIndexService.IndexReport;

/**
 * 기동 시 검색 인덱스를 준비한다.
 *   1) alias 가 없으면 indexName 으로 만든다 (app.search.create-index-on-start, 동기)
 *   2) 색인 (app.search.index-on-start, 별도 스레드 — 수십만 권이면 몇 분 걸리므로 readiness 를 막지 않는다)
 *      - alias 를 이번에 새로 만들었다 → indexAll (빈 인덱스 채움)
 *      - alias 가 indexName 이 아닌 옛 인덱스를 가리킨다 → 매핑 버전이 올라간 것. rebuild(indexName): 새 인덱스를 채우고 완전할 때만 alias 전환.
 *        그동안 검색은 옛 인덱스로 계속 된다. 옛 인덱스는 지우지 않는다(되돌리기용, 확인 뒤 사람이 지운다).
 *      - ALWAYS 면 위에 더해 현행 인덱스도 indexAll 로 다시 덮어쓴다
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
		Set<String> targets;
		try {
			created = indexService.ensureIndex();
			targets = indexService.aliasTargets();
			log.info("검색 인덱스 준비 완료: alias={} → {} ({})", props.alias(), targets, created ? "새로 연결" : "기존 사용");
		} catch (RuntimeException e) {
			// 접속 실패·타임아웃·권한 오류 전부. 기동은 막지 않는다.
			log.error("검색 인덱스 준비 실패 — Elasticsearch 에 접속할 수 없거나 인덱스 생성이 거부되었습니다. "
				+ "검색 API 는 복구될 때까지 SEARCH_UNAVAILABLE 을 냅니다. alias={}, index={}", props.alias(), props.indexName(), e);
			return;
		}

		IndexOnStart mode = props.indexOnStart();
		boolean current = targets.equals(Set.of(props.indexName()));
		if (mode == IndexOnStart.NEVER) {
			if (!current) {
				log.warn("alias '{}' 가 {} 를 가리키고 매핑 버전은 '{}' 인데 index-on-start=NEVER 라 재색인하지 않습니다. 수동으로 rebuild 하세요.",
					props.alias(), targets, props.indexName());
			} else {
				log.info("기동 시 색인 건너뜀 (index-on-start=NEVER)");
			}
			return;
		}

		if (!current) {
			// 매핑 버전 올림. 옛 인덱스가 검색을 계속 받는 동안 새 인덱스를 채운다.
			log.info("매핑 버전 변경 감지: alias '{}' → {} 이지만 현행은 '{}'. 백그라운드에서 재색인 후 alias 를 옮깁니다.",
				props.alias(), targets, props.indexName());
			runInBackground("매핑 버전 재색인", () -> indexService.rebuild(props.indexName()));
			return;
		}
		if (created || mode == IndexOnStart.ALWAYS) {
			log.info("기동 시 전체 색인 시작 (index-on-start={}, alias 새로 만듦={}) — 백그라운드에서 PG books → {}", mode, created, props.alias());
			runInBackground("전체 색인", indexService::indexAll);
			return;
		}
		log.info("기동 시 전체 색인 건너뜀 (index-on-start={}, alias 는 현행 '{}')", mode, props.indexName());
	}

	private void runInBackground(String what, java.util.function.Supplier<IndexReport> job) {
		taskExecutor.execute(() -> {
			try {
				IndexReport report = job.get();
				log.info("기동 시 {} 끝: index={} {}건 색인, {}건 실패, {}", what, report.index(), report.indexed(), report.failed(), report.elapsed());
			} catch (RuntimeException e) {
				log.error("기동 시 {} 실패 — alias 는 그대로입니다. 로그를 보고 고친 뒤 재기동하면 다시 시도합니다.", what, e);
			}
		});
	}
}
