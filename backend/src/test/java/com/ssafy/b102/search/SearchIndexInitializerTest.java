package com.ssafy.b102.search;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.core.task.SyncTaskExecutor;

import com.ssafy.b102.search.config.SearchIndexInitializer;
import com.ssafy.b102.search.config.SearchProperties;
import com.ssafy.b102.search.config.SearchProperties.IndexOnStart;
import com.ssafy.b102.search.service.BookIndexService;

/** 기동 시 분기만 — ES 없이 서비스 mock, 백그라운드는 동기 executor 로. */
class SearchIndexInitializerTest {

	private final BookIndexService service = mock(BookIndexService.class);
	private final DefaultApplicationArguments noArgs = new DefaultApplicationArguments();

	private SearchIndexInitializer init(IndexOnStart mode) {
		return new SearchIndexInitializer(service, new SearchProperties("books", "books_v2", true, mode), new SyncTaskExecutor());
	}

	@Test
	@DisplayName("alias 를 새로 만들었으면(빈 인덱스) indexAll")
	void created_alias_indexes_all() {
		when(service.ensureIndex()).thenReturn(true);
		when(service.aliasTargets()).thenReturn(Set.of("books_v2"));

		init(IndexOnStart.IF_CREATED).run(noArgs);

		verify(service).indexAll();
		verify(service, never()).rebuild(anyString());
	}

	@Test
	@DisplayName("alias 가 옛 매핑 인덱스를 가리키면 rebuild(현행 이름) — 매핑 버전 올림")
	void stale_alias_triggers_rebuild() {
		when(service.ensureIndex()).thenReturn(false);
		when(service.aliasTargets()).thenReturn(Set.of("books_v1"));

		init(IndexOnStart.IF_CREATED).run(noArgs);

		verify(service).rebuild("books_v2");
		verify(service, never()).indexAll();
	}

	@Test
	@DisplayName("alias 가 현행이고 문서 수가 PG 행수와 같으면 IF_CREATED 는 아무것도 안 한다")
	void current_and_complete_noop() {
		when(service.ensureIndex()).thenReturn(false);
		when(service.aliasTargets()).thenReturn(Set.of("books_v2"));
		when(service.documentCount("books")).thenReturn(3_312_467L);
		when(service.sourceCount()).thenReturn(3_312_467L);

		init(IndexOnStart.IF_CREATED).run(noArgs);

		verify(service, never()).indexAll();
		verify(service, never()).rebuild(anyString());
	}

	@Test
	@DisplayName("alias 가 현행인데 문서 수가 PG 행수보다 적으면(채우다 끊김) indexAll 로 보충한다")
	void current_but_incomplete_fills_up() {
		when(service.ensureIndex()).thenReturn(false);
		when(service.aliasTargets()).thenReturn(Set.of("books_v2"));
		when(service.documentCount("books")).thenReturn(3_139_000L);
		when(service.sourceCount()).thenReturn(3_312_467L);

		init(IndexOnStart.IF_CREATED).run(noArgs);

		verify(service).indexAll();
		verify(service, never()).rebuild(anyString());
	}

	@Test
	@DisplayName("ALWAYS 는 현행이어도 indexAll")
	void always_reindexes() {
		when(service.ensureIndex()).thenReturn(false);
		when(service.aliasTargets()).thenReturn(Set.of("books_v2"));

		init(IndexOnStart.ALWAYS).run(noArgs);

		verify(service).indexAll();
	}

	@Test
	@DisplayName("NEVER 는 매핑 버전이 달라도 손대지 않는다(경고만)")
	void never_does_nothing_even_if_stale() {
		when(service.ensureIndex()).thenReturn(false);
		when(service.aliasTargets()).thenReturn(Set.of("books_v1"));

		init(IndexOnStart.NEVER).run(noArgs);

		verify(service, never()).indexAll();
		verify(service, never()).rebuild(anyString());
	}

	@Test
	@DisplayName("ES 접속 실패는 삼키고 기동을 막지 않는다")
	void es_down_is_swallowed() {
		when(service.ensureIndex()).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("refused"));

		init(IndexOnStart.IF_CREATED).run(noArgs);   // 예외가 새지 않아야 한다

		verify(service, never()).indexAll();
	}
}
