#!/usr/bin/env python3
"""ISBN 정규화를 순수 SQL 매크로로 제공한다.

Python UDF 로도 되지만 200만 행에서 너무 느렸다(10분 이상). 매크로는 duckdb 내부에서
벡터화 실행되므로 수 초에 끝난다. numpy 의존도 사라진다.

로직은 database/yes24/scripts/yes24_isbn_collector.py 와 동일하며,
같은 테스트 벡터로 검증한다(self_test).

    py scripts/isbn_sql.py     # 자체 검증 실행
"""

from __future__ import annotations

import sys

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


MACROS = """
-- 주의: duckdb 는 AND/CASE 를 벡터 단위로 평가한다. 무효 행에서도 하위 식이 실행되므로
-- 숫자 변환은 반드시 TRY_CAST 여야 한다. CAST 를 쓰면 빈 문자열에서 전체 질의가 죽는다.

-- EAN-13 체크숫자: 앞 12자리에 1,3,1,3... 가중치를 곱해 합한 뒤 10의 보수
CREATE OR REPLACE MACRO ean13_check(s) AS (
  (10 - (list_sum(list_transform(range(1, 13), i ->
     TRY_CAST(substr(s, CAST(i AS INTEGER), 1) AS INTEGER)
     * (CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END)
  )) % 10)) % 10
);

-- ISBN10: 가중치 10..1, X 는 10, 합이 11로 나누어떨어지면 유효
CREATE OR REPLACE MACRO isbn10_ok(v) AS (
  regexp_matches(v, '^[0-9]{9}[0-9X]$')
  AND list_sum(list_transform(range(1, 11), i ->
        (11 - i) * (CASE WHEN substr(v, CAST(i AS INTEGER), 1) = 'X' THEN 10
                    ELSE TRY_CAST(substr(v, CAST(i AS INTEGER), 1) AS INTEGER) END)
      )) % 11 = 0
);

CREATE OR REPLACE MACRO isbn13_ok(v) AS (
  regexp_matches(v, '^97[89][0-9]{10}$')
  AND TRY_CAST(substr(v, 13, 1) AS INTEGER) = ean13_check(substr(v, 1, 12))
);

-- 하이픈/공백 제거 후 대문자화. X 를 소문자로 쓴 레코드가 있다.
CREATE OR REPLACE MACRO isbn_clean(v) AS (
  upper(replace(replace(trim(coalesce(v, '')), '-', ''), ' ', ''))
);

-- ISBN10/13 혼재를 ISBN13 으로 통일한다. 변환은 10->13 단방향만 필요하다.
CREATE OR REPLACE MACRO norm_isbn13(v) AS (
  CASE
    WHEN isbn13_ok(isbn_clean(v)) THEN isbn_clean(v)
    WHEN isbn10_ok(isbn_clean(v))
      THEN ('978' || substr(isbn_clean(v), 1, 9))
           || CAST(ean13_check('978' || substr(isbn_clean(v), 1, 9)) AS VARCHAR)
  END
);

CREATE OR REPLACE MACRO isbn_kind(v) AS (
  CASE
    WHEN isbn_clean(v) = ''                                THEN '빈값'
    WHEN isbn13_ok(isbn_clean(v))                          THEN 'ISBN13'
    WHEN regexp_matches(isbn_clean(v), '^97[89][0-9]{10}$') THEN 'ISBN13(체크섬오류)'
    WHEN isbn10_ok(isbn_clean(v))                          THEN 'ISBN10'
    WHEN regexp_matches(isbn_clean(v), '^[0-9]{9}[0-9X]$')  THEN 'ISBN10(체크섬오류)'
    ELSE '기타형식'
  END
);
"""


def install(con: duckdb.DuckDBPyConnection) -> None:
    for statement in MACROS.split(";"):
        if statement.strip():
            con.execute(statement)


def self_test() -> int:
    """yes24 수집기의 테스트 벡터를 그대로 쓴다."""
    con = duckdb.connect()
    install(con)
    cases = [
        ("9788966260959", "9788966260959", "ISBN13", "유효 ISBN13은 그대로"),
        ("978-89-6626-095-9", "9788966260959", "ISBN13", "하이픈 제거"),
        ("9788966260950", None, "ISBN13(체크섬오류)", "체크섬 틀린 ISBN13은 버린다"),
        ("8966260950", "9788966260959", "ISBN10", "ISBN10 -> ISBN13 변환"),
        ("8985502654", "9788985502658", "ISBN10", "ISBN10 변환"),
        ("0548035784", "9780548035788", "ISBN10", "외서 ISBN10 변환"),
        ("notanisbn", None, "기타형식", "쓰레기는 버린다"),
        ("", None, "빈값", "빈값"),
    ]
    failures = 0
    print(f"  {'입력':<20}{'정규화':<16}{'분류':<20}{'결과'}")
    print("  " + "-" * 66)
    for raw, expect_norm, expect_kind, note in cases:
        norm, kind = con.execute(
            "SELECT norm_isbn13(?), isbn_kind(?)", [raw, raw]).fetchone()
        ok = (norm == expect_norm) and (kind == expect_kind)
        failures += 0 if ok else 1
        mark = "OK  " if ok else "실패"
        print(f"  {raw!r:<20}{str(norm):<16}{kind:<20}{mark} {note}")
        if not ok:
            print(f"       기대: norm={expect_norm} kind={expect_kind}")
    print("")
    print("모든 케이스 통과" if not failures else f"{failures}건 실패")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(self_test())
