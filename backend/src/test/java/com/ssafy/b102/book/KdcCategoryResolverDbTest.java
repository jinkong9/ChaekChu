package com.ssafy.b102.book;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.transaction.AfterTransaction;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.service.KdcCategoryResolver;

/**
 * 실제 PostgreSQL 의 kdc_codes(V2) 를 읽는 경로만 본다 — refresh 가 표를 읽어 2단계 경로를 만드는지.
 * 사전이 비었을 때의 대분류 폴백은 DB 없이 KdcCategoryResolverTest(단위)가 이미 덮는다.
 *
 * 픽스처는 트랜잭션 롤백으로 정리한다. 예전에는 끝에 `delete ... where code in ('8','81')` 로 지웠는데,
 * kdc_codes 는 parent_code 가 자기 자신을 참조하는 FK(fk_kdc_parent, ON DELETE 없음)라
 * seed 가 적재된 DB(운영 949행: '8' 의 자식 10 · '81' 의 자식 9)에서는 그 DELETE 가 FK 위반으로 실패한다.
 * seed 가 없는 DB 에서만 성공하는 불안정한 정리였다.
 *
 * 롤백 뒤에는 resolver 의 메모리 표가 사라진 픽스처를 들고 있으므로 @AfterTransaction 에서 다시 읽는다 —
 * 같은 컨텍스트를 쓰는 다음 테스트(검색·상세의 category 경로)가 이 캐시를 그대로 본다.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class KdcCategoryResolverDbTest {

	@Autowired KdcCategoryResolver resolver;
	@Autowired JdbcTemplate jdbc;

	@AfterTransaction
	void restoreResolverCache() {
		resolver.refresh();
	}

	@Test
	@DisplayName("kdc_codes 에 행이 있으면 refresh 뒤 2단계 경로 — JdbcTemplate 조회 경로 검증")
	void reads_from_table_and_refreshes() {
		// seed 가 이미 있는 DB 에서도 값이 같아 결과가 바뀌지 않는다(운영: '8' 문학 · '81' 한국문학)
		jdbc.update("insert into kdc_codes(code, label, parent_code, depth) values ('8','문학',null,1) on conflict (code) do nothing");
		jdbc.update("insert into kdc_codes(code, label, parent_code, depth) values ('81','한국문학','8',2) on conflict (code) do nothing");
		resolver.refresh();

		assertThat(resolver.pathOf("813.62")).isEqualTo("문학 > 한국문학");
		assertThat(resolver.pathOf("8")).isEqualTo("문학");
	}
}
