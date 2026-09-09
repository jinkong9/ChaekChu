package com.ssafy.b102.search.service;

import com.ssafy.b102.search.service.BookIndexService.IndexReport;

/**
 * 재색인이 완전하지 않아 alias 를 옮기지 않았다. 새 인덱스는 지우지 않고 남겨 두었으니 로그의 거부 사유를 보고
 * 고친 뒤 다시 populateAndSwitch 하거나(같은 이름은 덮어쓴다) 인덱스를 지운다.
 */
public class IncompleteIndexException extends RuntimeException {

	private final transient IndexReport report;
	private final long expected;
	private final long actual;

	public IncompleteIndexException(IndexReport report, long expected, long actual) {
		super("재색인 불완전: index=" + report.index() + " 거부=" + report.failed() + " ES문서=" + actual + " PG행=" + expected
			+ " — alias 를 옮기지 않았습니다.");
		this.report = report;
		this.expected = expected;
		this.actual = actual;
	}

	public IndexReport report() {
		return report;
	}

	public long expected() {
		return expected;
	}

	public long actual() {
		return actual;
	}
}
