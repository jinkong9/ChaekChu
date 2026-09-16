package com.ssafy.b102.book.repository;

import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.ssafy.b102.book.entity.Book;

/**
 * 「이 제목을 이 출판사가 시리즈(여러 권)로 냈는가」를 카탈로그 전체에서 묻는다. WorkKey 의 권차 판단에 쓴다.
 *
 * 원장 `vol` 은 권차와 문고 일련번호가 섞여 있어 값만 보고는 못 가른다(데미안 민음사 44 = 세계문학전집 44번).
 * 시리즈의 표지는 <b>같은 제목·같은 출판사가 한 해에 두 권차 이상을 낸 기록</b>이다 — 세트는 함께 나온다(토지 나남 2002 21권,
 * 셜록 홈즈 비룡소 2013 7권). 출판사가 고전을 다른 전집에 다시 넣으면 연도가 달라 걸리지 않는다(데미안 민음사 2000·2009).
 * 연도 없이 출판사만 보면 그 재수록이 전부 시리즈로 잡힌다 — 데미안 삼성출판사 34·4·39 가 그 예다.
 *
 * 인덱스 idx_books_title_publisher_vol (lower(title), publisher) WHERE vol IS NOT NULL (V7) 을 탄다. 한 요청에 책 10권 안팎이라
 * VALUES 조인 한 번이다. 제목 비교는 lower() 정확 일치 — 시리즈의 권들은 원장에서 같은 제목을 쓴다.
 */
@Repository
public class WorkSeriesRepository {

	private final JdbcClient jdbc;

	public WorkSeriesRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** (lower(title), publisher) 쌍의 키. Book 에서 만든다. 제목이나 출판사가 없으면 null. */
	public static String keyOf(Book book) {
		if (book.getTitle() == null || book.getTitle().isBlank() || book.getPublisher() == null || book.getPublisher().isBlank()) {
			return null;
		}
		return book.getTitle().strip().toLowerCase(Locale.ROOT) + "" + book.getPublisher().strip();
	}

	/** 주어진 책들 중 카탈로그가 시리즈로 아는 (제목, 출판사) 쌍의 {@link #keyOf} 집합. */
	public Set<String> findSeriesKeys(Collection<Book> books) {
		Map<String, Book> byKey = new LinkedHashMap<>();
		for (Book book : books) {
			String key = keyOf(book);
			if (key != null) {
				byKey.putIfAbsent(key, book);
			}
		}
		if (byKey.isEmpty()) {
			return Set.of();
		}
		StringBuilder values = new StringBuilder();
		Map<String, Object> params = new LinkedHashMap<>();
		int i = 0;
		for (Book book : byKey.values()) {
			if (i > 0) {
				values.append(", ");
			}
			values.append("(:t").append(i).append(", :p").append(i).append(')');
			params.put("t" + i, book.getTitle().strip().toLowerCase(Locale.ROOT));
			params.put("p" + i, book.getPublisher().strip());
			i++;
		}
		String sql = """
			select v.t, v.p
			from (values %s) as v(t, p)
			join books b on lower(b.title) = v.t and b.publisher = v.p
			where b.vol is not null
			group by v.t, v.p, b.pub_year
			having count(distinct b.vol) >= 2
			""".formatted(values);
		Set<String> result = new HashSet<>();
		jdbc.sql(sql).params(params)
			.query((rs, n) -> rs.getString("t") + "" + rs.getString("p"))
			.list()
			.forEach(result::add);
		return result;
	}
}
