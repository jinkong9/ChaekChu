#!/usr/bin/env python3
"""관별 원장 CSV 1,660개를 파케이 두 벌로 만든다.

왜 두 벌인가
  관 차원을 접으면 **"이 책을 가진 근처 도서관"** 기능이 죽는다.
  그 기능 때문에 `libraries.parquet` 에 위경도까지 모아 뒀다.
  그렇다고 관별 원장만 두면 추천 후보 필터·랭킹이 매번 1.4억 행을 훑어야 한다.

    holdings_full.parquet   관 × ISBN · 원본 12컬럼 + lib_id
    books_dedup.parquet     ISBN 단위 집계 · 추천 파이프라인 입력

중복 제거 규칙
  대출건수·도서권수   SUM        전국 누적. 월별 파일이 누적 스냅샷이라 그대로 더한다
  등록일자           MIN        최초로 어느 관엔가 들어온 날
  주제분류번호(KDC)   가장 정밀   `813.62` 가 `813` 보다 낫다. **소수 자릿수가 정보다**
  그 밖의 서지        대표 행     아래 참고
  번호               버림       관별 CSV 안의 행 번호라 관을 합치면 의미가 없다
  부가기호            버림       **원장에서는 쓸 수 있는 값이 하나도 없다.**
                               실측 2026-09-04: 정상 5자리 0건 · '0' 류 4,250만행 ·
                               빈 값 4,256만행 · 잡값 5,684만행.
                               부가기호는 선행 0 이 독자대상(아동/청소년)을 뜻해
                               추천 필터에 중요한데, 도서관들이 이 칸을 안 채운다.
                               정보나루 API 의 add_symbol 과 국중 EA_ADD_CODE 가
                               제대로 된 값을 주므로 그쪽을 쓴다. 여기 담으면
                               나중에 진짜 부가기호로 착각할 위험만 남는다.
  등록일자            MIN + 중앙값   1990 이전은 쓰레기라 버린다. 아래 참고

서지를 **컬럼마다 따로** 뽑지 않는 이유
  컬럼별로 최빈값을 고르면 A관의 도서명 + B관의 저자 + C관의 출판사가 섞인
  **어느 관에도 없던 레코드**가 만들어진다. 그래서 (도서명·저자·출판사) 조합이
  가장 흔한 **대표 행 하나**를 골라 통째로 쓴다. 동률이면 글자 수가 긴 쪽 —
  목록화가 더 자세한 관을 택한다는 뜻이다.
  KDC 만 예외로 따로 고른다. 정밀도가 값어치를 결정하고 서지와 독립이기 때문이다.

헤더 변형
  1,656관은 `번호`, 4관은 `관리번호` 로 시작한다. 둘 다 같은 뜻이고
  어차피 버리는 컬럼이라 union_by_name 으로 함께 읽고 무시한다.

실행
    py scripts/build_holdings_full.py
    py scripts/build_holdings_full.py --limit 30     # 맛보기 (관 수를 실제로 줄인다)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
DATA = BASE / "data4library"
RAW = DATA / "holdings_raw"
FULL = DATA / "holdings_full.parquet"
DEDUP = DATA / "books_dedup.parquet"

COLS = {
    "도서명": "title", "저자": "author", "출판사": "publisher",
    "발행년도": "pub_year", "ISBN": "isbn13", "세트 ISBN": "set_isbn",
    "부가기호": "add_symbol", "권": "vol", "주제분류번호": "kdc",
    "도서권수": "copies", "대출건수": "loans", "등록일자": "reg_date",
}


def build_full(con, limit: int) -> None:
    files = sorted(RAW.glob("*.csv"))
    if limit:
        files = files[:limit]
    size = sum(f.stat().st_size for f in files) / 2**30
    print(f"원본 {len(files):,}개 · {size:.1f} GB")

    # **--limit 은 glob 이 아니라 파일 목록으로 넘겨야 한다.**
    # 예전 구현은 목록만 자르고 glob 은 전체를 읽어 limit 이 무의미했다.
    listing = "[" + ", ".join(f"'{f.as_posix()}'" for f in files) + "]"
    select = ", ".join(f'"{src}" AS {dst}' for src, dst in COLS.items())

    print("관 × ISBN 원장을 만드는 중…", flush=True)
    t0 = time.time()
    con.execute(f"""
        CREATE OR REPLACE VIEW raw AS
        SELECT
            CAST(regexp_extract(filename, '([0-9]+)\\.csv$', 1) AS INTEGER) AS lib_id,
            {select}
        FROM read_csv({listing},
                      filename = true,
                      union_by_name = true,
                      header = true,
                      all_varchar = true,
                      ignore_errors = true,
                      strict_mode = false)
    """)
    con.execute(f"""
        COPY (
            SELECT
                lib_id,
                upper(regexp_replace(isbn13, '[^0-9Xx]', '', 'g')) AS isbn13,
                nullif(trim(title), '')      AS title,
                nullif(trim(author), '')     AS author,
                nullif(trim(publisher), '')  AS publisher,
                TRY_CAST(pub_year AS INTEGER) AS pub_year,
                nullif(trim(set_isbn), '')   AS set_isbn,
                nullif(trim(add_symbol), '') AS add_symbol,
                nullif(trim(vol), '')        AS vol,
                nullif(trim(kdc), '')        AS kdc,
                COALESCE(TRY_CAST(copies AS INTEGER), 0) AS copies,
                COALESCE(TRY_CAST(loans  AS INTEGER), 0) AS loans,
                TRY_CAST(reg_date AS DATE)   AS reg_date
            FROM raw
            WHERE length(regexp_replace(COALESCE(isbn13,''), '[^0-9Xx]', '', 'g')) >= 10
        ) TO '{FULL.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    n, libs, isbns = con.execute(
        f"SELECT count(*), count(DISTINCT lib_id), count(DISTINCT isbn13) "
        f"FROM read_parquet('{FULL.as_posix()}')").fetchone()
    print(f"  {FULL.name}  {n:,}행 · {libs:,}관 · 고유 ISBN {isbns:,} "
          f"· {FULL.stat().st_size/2**30:.2f} GB · {time.time()-t0:.0f}초")


def build_dedup(con) -> None:
    print("\nISBN 단위로 접는 중…", flush=True)
    t0 = time.time()
    full = FULL.as_posix()
    con.execute(f"""
        COPY (
            WITH h AS (
                SELECT *,
                       -- 정상 범위 밖 날짜는 없는 것으로 본다
                       CASE WHEN reg_date >= DATE '1990-01-01'
                             AND reg_date <= current_date
                             AND reg_date <> DATE '1970-01-01'
                            THEN reg_date END AS sane
                FROM read_parquet('{full}')
            ),
            -- 1) (도서명·저자·출판사) 조합별 빈도. 가장 흔한 조합이 대표다.
            combo AS (
                SELECT isbn13, title, author, publisher, set_isbn,
                       vol, pub_year,
                       count(*) AS freq,
                       length(COALESCE(title,'')) + length(COALESCE(author,''))
                         + length(COALESCE(publisher,'')) AS detail
                FROM h
                GROUP BY ALL
            ),
            rep AS (
                SELECT * FROM (
                    SELECT *, row_number() OVER (
                        PARTITION BY isbn13
                        -- 흔한 순, 동률이면 목록화가 자세한 순
                        ORDER BY freq DESC, detail DESC, title
                    ) AS rn
                    FROM combo
                ) WHERE rn = 1
            ),
            -- 2) KDC 는 서지와 따로 고른다. 규칙이 두 겹이다.
            --
            --   (a) **청구기호를 걸러낸다.** 주제분류번호 칸에 청구기호를 넣은
            --       관이 있다: '808.9-비295 v.49', '스마트(안동역)'.
            --       실측 2026-09-03: 2,953,587종 중 69,695종(2.4%)이 이랬고,
            --       소장 관이 많은 인기 도서일수록 걸릴 확률이 높아
            --       대출 상위 표본이 전부 오염됐다.
            --       KDC 는 숫자 1~3자리에 소수부가 붙는 형태다.
            --
            --   (b) **길이가 아니라 관들의 합의(최빈값)를 따른다.**
            --       예전 규칙은 가장 긴 값을 골랐는데, 9788949110004 의 경우
            --       9,965개관이 '808.9' 라 하는데 1,329개관의 '808.91' 을 택했다.
            --       동률일 때만 정밀한(긴) 쪽을 쓴다.
            -- **f-string 안이라 중괄호를 두 번 써야 한다.** `{1,3}` 은 파이썬이
            -- 튜플 (1, 3) 으로 치환해 정규식이 아무것도 매치하지 않는다.
            -- 실측 2026-09-03: 이것 때문에 KDC 보유율이 95.8% -> 0% 가 됐다.
            best_kdc AS (
                SELECT isbn13, kdc FROM (
                    SELECT isbn13, kdc, row_number() OVER (
                        PARTITION BY isbn13
                        ORDER BY count(*) DESC, length(kdc) DESC, kdc
                    ) AS rn
                    FROM h
                    WHERE kdc IS NOT NULL
                      AND regexp_matches(kdc, '^[0-9]{{1,3}}(\.[0-9]+)?$')
                    GROUP BY isbn13, kdc
                ) WHERE rn = 1
            ),
            -- 3) 수량은 전국 합
            agg AS (
                SELECT isbn13,
                       CAST(sum(loans)  AS BIGINT) AS loans,
                       CAST(sum(copies) AS BIGINT) AS copies,
                       -- **등록일자에는 쓰레기가 섞여 있고 MIN 은 그것에 끌려간다.**
                       --
                       -- 자리표시자·오타 실측 2026-09-04:
                       --   1970-01-01  215만행  (등록일을 모를 때 넣는 값)
                       --   1111년       2,647행  (채워 넣기용 타자)
                       --   1900년         238행 · 1875년 1행 · 1200년 1행
                       -- 정상 구간은 1995년부터다. MIN 이라 한 관만 이래도
                       -- 그 책 전체가 끌려간다 — 1970 하나로 482,518종(16.3%)이
                       -- 오염됐고 `나미야 잡화점의 기적` 은 실제 2003-12-06 인데
                       -- 1970 이 됐다. 그래서 1990 이전은 통째로 버린다.
                       min(sane) AS first_reg,

                       -- **MIN 하나로는 부족하다.** 10개관 이상 보유한 118만 종에서
                       -- MIN 과 중앙값이 평균 11.3년 벌어지고, 14.8%는 10년을 넘는다.
                       -- 옛 책을 한 관이 일찍 사고 나머지가 재판을 늦게 산 경우라
                       -- 그 자체는 오류가 아니지만, **대출 속도 정규화에는 독이다** —
                       -- 분모가 15년 길어지면 속도가 그만큼 과소평가된다.
                       --   first_reg   "언제 세상에 나왔나" (신간 판정)
                       --   median_reg  "언제부터 흔해졌나"  (대출 속도 분모)
                       median(sane) AS median_reg,
                       count(DISTINCT lib_id) AS lib_count
                FROM h GROUP BY isbn13
            )
            SELECT a.isbn13, r.title, r.author, r.publisher, r.pub_year,
                   r.set_isbn, r.vol,
                   k.kdc,
                   a.loans, a.copies, a.first_reg, a.median_reg, a.lib_count
            FROM agg a
            LEFT JOIN rep r      USING (isbn13)
            LEFT JOIN best_kdc k USING (isbn13)
        ) TO '{DEDUP.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    n, loans, kdc, dec = con.execute(f"""
        SELECT count(*), sum(loans),
               count(*) FILTER (WHERE kdc IS NOT NULL),
               count(*) FILTER (WHERE kdc LIKE '%.%')
        FROM read_parquet('{DEDUP.as_posix()}')""").fetchone()
    print(f"  {DEDUP.name}  {n:,}종 · 누적 대출 {loans:,}")
    print(f"    KDC 보유 {kdc:,} ({100*kdc/n:.1f}%) · 그중 소수점 {dec:,} "
          f"({100*dec/max(1,kdc):.1f}%)")
    print(f"    {DEDUP.stat().st_size/2**20:.0f} MB · {time.time()-t0:.0f}초")


def compare_old(con) -> None:
    """예전 축약본과 대조한다. 어긋나면 새 것을 믿기 전에 원인을 봐야 한다."""
    old = DATA / "loans_by_isbn.parquet"
    if not old.exists():
        print("\n예전 loans_by_isbn.parquet 이 없어 대조를 건너뛴다")
        return
    print("\n예전 축약본과 대조")
    on, ol, nn, nl = con.execute(f"""
        SELECT (SELECT count(*)   FROM read_parquet('{old.as_posix()}')),
               (SELECT sum(loans) FROM read_parquet('{old.as_posix()}')),
               (SELECT count(*)   FROM read_parquet('{DEDUP.as_posix()}')),
               (SELECT sum(loans) FROM read_parquet('{DEDUP.as_posix()}'))
    """).fetchone()
    print(f"  종수      {on:,}  ->  {nn:,}   ({nn-on:+,})")
    print(f"  누적 대출 {ol:,}  ->  {nl:,}   ({nl-ol:+,})")
    if nl < ol:
        print("  [경고] 대출 총합이 줄었다. 월별 파일이 누적이라 줄어들 수 없다 —")
        print("         수집 누락이나 파싱 오류를 의심해야 한다")
    else:
        print("  대출 총합이 늘었다 — 그 사이 쌓인 실제 대출분이다 (정상)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--memory", default="6GB")
    parser.add_argument("--dedup-only", action="store_true",
                        help="holdings_full 은 그대로 두고 집계만 다시")
    args = parser.parse_args()
    if not RAW.exists():
        raise SystemExit(f"{RAW} 가 없다. collect_full_holdings.py 를 먼저 돌려라")

    import duckdb
    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{args.memory}'")
    con.execute("PRAGMA threads=4")
    con.execute(f"PRAGMA temp_directory='{(DATA / 'duckdb_tmp').as_posix()}'")

    if not args.dedup_only:
        build_full(con, args.limit)
    build_dedup(con)
    if not args.limit:
        compare_old(con)

    print("\n대출 상위 표본")
    for row in con.execute(f"""
            SELECT isbn13, title, kdc, loans, lib_count
            FROM read_parquet('{DEDUP.as_posix()}')
            ORDER BY loans DESC LIMIT 5""").fetchall():
        print(f"  {row[0]}  {str(row[1])[:32]:<32} KDC {str(row[2]):<9} "
              f"대출 {row[3]:>9,} · {row[4]:,}개관")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
