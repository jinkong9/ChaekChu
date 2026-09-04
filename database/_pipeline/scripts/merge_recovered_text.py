#!/usr/bin/env python3
"""회수한 URL 텍스트를 국중 파생 Parquet 에 병합한다.

recover_nl_url_text.py 가 만든 nl_url_text.csv 를 읽어
nl_books_enriched.parquet 을 만든다. 원본(nl_books_derived.parquet)은 건드리지 않는다.

병합 규칙
  intro_final   = 본문(BOOK_INTRODUCTION)이 있으면 그것, 없으면 회수 텍스트
  toc_final     = 목차도 동일
  summary_final = 요약도 동일
  text_source   = 'inline' / 'url_recovered' / 'none'   <- 출처 추적용

임베딩 파이프라인은 intro_final 을 쓰면 되고, text_source 로 품질 차이를
사후 분석할 수 있다.

실행:
    py scripts/merge_recovered_text.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
DERIVED = BASE / "nl_books_derived.parquet"
RECOVERED = BASE / "nl_url_text.csv"
ENRICHED = BASE / "nl_books_enriched.parquet"
USABLE_MIN = 100


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--derived", type=Path, default=DERIVED)
    parser.add_argument("--recovered", type=Path, default=RECOVERED)
    parser.add_argument("--out", type=Path, default=ENRICHED)
    args = parser.parse_args()

    con = duckdb.connect()
    con.execute("SET memory_limit='6GB'")
    con.execute("SET preserve_insertion_order=false")

    # 회수 CSV -> 필드별 피벗 (같은 ISBN 에 intro/toc/summary 가 각각 온다)
    con.execute(f"""
        CREATE OR REPLACE VIEW rec AS
        SELECT isbn13,
               max(CASE WHEN field='intro'   THEN text END) AS r_intro,
               max(CASE WHEN field='toc'     THEN text END) AS r_toc,
               max(CASE WHEN field='summary' THEN text END) AS r_summary
        FROM read_csv('{args.recovered.as_posix()}', header=true,
                      columns={{'isbn13':'VARCHAR','field':'VARCHAR','url':'VARCHAR',
                                'chars':'VARCHAR','text':'VARCHAR'}})
        GROUP BY isbn13
    """)
    n_rec = con.execute("SELECT count(*) FROM rec").fetchone()[0]
    print(f"회수 텍스트: {n_rec:,} ISBN")

    # 원본 본문은 nl_books.parquet 에만 있으므로 길이 컬럼으로 판단하고,
    # 회수분은 텍스트 자체를 붙인다.
    con.execute(f"""
        COPY (
            SELECT d.*,
                   r.r_intro, r.r_toc, r.r_summary,
                   CASE WHEN d.intro_len >= {USABLE_MIN} THEN 'inline'
                        WHEN length(r.r_intro) >= {USABLE_MIN} THEN 'url_recovered'
                        ELSE 'none' END AS intro_source,
                   greatest(d.intro_len, coalesce(length(r.r_intro), 0))     AS intro_final_len,
                   greatest(d.toc_len, coalesce(length(r.r_toc), 0))         AS toc_final_len,
                   greatest(d.summary_len, coalesce(length(r.r_summary), 0)) AS summary_final_len,
                   (greatest(d.intro_len, coalesce(length(r.r_intro), 0)) >= {USABLE_MIN}
                    OR greatest(d.toc_len, coalesce(length(r.r_toc), 0)) >= {USABLE_MIN}
                    OR greatest(d.summary_len, coalesce(length(r.r_summary), 0)) >= {USABLE_MIN})
                                                                             AS has_text_final
            FROM '{args.derived.as_posix()}' d
            LEFT JOIN rec r ON d.isbn13_norm = r.isbn13
        ) TO '{args.out.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    src = f"'{args.out.as_posix()}'"
    total, before, after = con.execute(f"""
        SELECT count(*), sum(has_usable_text::INT), sum(has_text_final::INT) FROM {src}
    """).fetchone()
    print(f"\n=== 병합 결과 (국중 {total:,}건) ===")
    print(f"  회수 전 텍스트 보유  {before:>9,}  ({100*before/total:>5.2f}%)")
    print(f"  회수 후 텍스트 보유  {after:>9,}  ({100*after/total:>5.2f}%)")
    print(f"  순증               {after-before:>9,}  ({after/before:.2f}배)")

    print("\n  출처별 (책소개 기준):")
    for source, count in con.execute(
            f"SELECT intro_source, count(*) FROM {src} GROUP BY 1 ORDER BY 2 DESC").fetchall():
        print(f"    {source:<16}{count:>10,}")

    # L1 후보 기준 효과
    # 예전 loans_by_isbn 은 4컬럼 축약본에서 나온 것이라 2026-09-04 에 지웠다.
    # 새 원장(books_dedup)이 같은 isbn13·loans 를 담고 서지·KDC 까지 준다.
    data = BASE / "data4library" / "books_dedup.parquet"
    if data.exists():
        row = con.execute(f"""
            SELECT count(*), sum(n.has_usable_text::INT), sum(n.has_text_final::INT)
            FROM '{data.as_posix()}' l
            JOIN {src} n ON l.isbn13 = n.isbn13_norm
            WHERE l.loans >= 72
        """).fetchone()
        print(f"\n  [L1 후보 교집합 {row[0]:,}건]")
        print(f"    회수 전 {row[1]:,} ({100*row[1]/row[0]:.1f}%) "
              f"-> 회수 후 {row[2]:,} ({100*row[2]/row[0]:.1f}%)")

    print(f"\n  연도별 개선:")
    for label, cond in [("~2006", "pub_year < 2007"),
                        ("2007-2014", "pub_year BETWEEN 2007 AND 2014"),
                        ("2015+", "pub_year >= 2015")]:
        b, a, n = con.execute(f"""
            SELECT sum(has_usable_text::INT), sum(has_text_final::INT), count(*)
            FROM {src} WHERE {cond}
        """).fetchone()
        print(f"    {label:<12}{100*(b or 0)/n:>6.2f}% -> {100*(a or 0)/n:>6.2f}%"
              f"   (+{(a or 0)-(b or 0):,}건)")

    print(f"\n생성: {args.out}  ({args.out.stat().st_size/1024/1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
