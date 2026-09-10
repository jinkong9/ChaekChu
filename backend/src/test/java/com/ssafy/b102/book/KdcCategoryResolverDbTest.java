package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import com.ssafy.b102.book.service.KdcCategoryResolver;

/**
 * 실제 PostgreSQL 의 kdc_codes(V2) 를 읽는 경로. 테스트 DB 에는 사전 행이 없으니(적재는 파이프라인) 몇 행 넣고 refresh 로 반영한다.
 * 운영 코드는 '8','81' 처럼 소수점 없는 코드. 테스트 코드 값은 다른 테스트와 겹치지 않게 'T' 접두를 쓰지 않고 실제 코드로 넣되 끝에 지운다.
 */
@SpringBootTest
@ActiveProfiles("test")
class KdcCategoryResolverDbTest {

	@Autowired KdcCategoryResolver resolver;
	@Autowired JdbcTemplate jdbc;

	@AfterEach
	void tearDown() {
		jdbc.update("delete from kdc_codes where code in ('81','8')");
		resolver.refresh();
	}

	@Test
	@DisplayName("kdc_codes 에 행이 있으면 refresh 뒤 2단계 경로, 지우고 refresh 하면 대분류 폴백")
	void reads_from_table_and_refreshes() {
		jdbc.update("insert into kdc_codes(code, label, parent_code, depth) values ('8','문학',null,1) on conflict (code) do nothing");
		jdbc.update("insert into kdc_codes(code, label, parent_code, depth) values ('81','한국문학','8',2) on conflict (code) do nothing");
		resolver.refresh();
		assertThat(resolver.pathOf("813.62")).isEqualTo("문학 > 한국문학");

		jdbc.update("delete from kdc_codes where code in ('81','8')");
		resolver.refresh();
		assertThat(resolver.pathOf("813.62")).isEqualTo("문학");   // 표에 없어도 KdcMainClass 폴백
	}
}
