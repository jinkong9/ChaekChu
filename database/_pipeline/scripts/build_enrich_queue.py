#!/usr/bin/env python3
"""텍스트 보강 대상의 우선순위 큐를 만든다.

전량을 다 긁기 전에 중단될 수 있다는 전제로 순서를 정한다.
멈춘 시점까지 확보한 것이 가장 값어치 있어야 한다.

우선순위 (3단)
  1. 노출 90% 밴드   대출 상위. 누적 대출이 전체의 90% 에 도달할 때까지
  2. 신간 트랙       2025년 이후 발행. 대출 이력이 없어 1단에 못 드는데
                    추천 품질에는 직결된다. 꼬리보다 앞세운다
  3. 나머지 꼬리     L1 후보 중 남은 것

대상 조건
  - L1 후보 전량: 누적 대출 72+ (수요 99% 유지 임계)  또는  2025+ 신간
  - **국중 텍스트가 있어도 제외하지 않는다.**

    한때 제외했었다. `srchDtlList`(텍스트만 주는 API)를 쓰던 시절에는
    텍스트가 이미 있으면 부를 이유가 없었기 때문이다.
    그러나 `usageAnalysisList` 로 바꾸면서 같은 1호출에
    **함께대출 · 키워드 · 월별 대출이력 · 연령x성별**이 딸려오게 됐다.
    제외를 그대로 두면 국중 텍스트 보유 12.8만 건(L1 의 11.8%)이
    **협업필터링 신호를 통째로 못 받는다.** 그 책들은 대출 상위 구간에도
    15~17% 고루 분포하므로 변두리가 아니다.

산출: data4library/enrich_queue.csv
      (isbn13, tier, loans, has_nl_text, priority)
      has_nl_text 는 국중 텍스트 보유 여부. 수집에는 영향이 없고
      나중에 두 집단을 비교할 때 쓴다.

실행:
    py scripts/build_enrich_queue.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
ENRICHED = BASE / "nl_books_enriched.parquet"
# **새 원장(books_dedup)을 쓴다.** 예전 loans_by_isbn 은 4컬럼 축약본에서
# 나온 것이라 서지·KDC 가 없고, 2026-08-26 자로 두 달 낡았다.
LOANS = BASE / "data4library" / "books_dedup.parquet"
OUT = BASE / "data4library" / "enrich_queue.csv"

LOAN_MIN = 72        # L1 후보 임계 (수요 99% 유지)
NEW_YEAR = 2025      # 신간 트랙 기준
BAND = 0.90          # 1단이 덮는 누적 대출 비중


def path(p: Path) -> str:
    return str(p).replace("\\", "/")


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(OUT),
                    help="산출 경로. 기존 큐를 덮지 않고 대조하려면 다른 이름을 준다")
    args = ap.parse_args()
    out_path = Path(args.out)
    con = duckdb.connect()
    con.execute("PRAGMA memory_limit='6GB'")
    con.execute(f"CREATE VIEW e AS SELECT * FROM read_parquet('{path(ENRICHED)}')")
    con.execute(f"CREATE VIEW l AS SELECT * FROM read_parquet('{path(LOANS)}')")

    # 국중 텍스트 보유 여부. **제외 조건이 아니라 표시용**이다 (위 주석 참조)
    con.execute("""
        CREATE VIEW has_text AS
        SELECT DISTINCT isbn13_norm AS isbn13 FROM e
        WHERE isbn13_norm IS NOT NULL AND has_text_final
    """)

    # L1 후보 = 대출 72+ 합집합 신간. 신간은 국중 쪽에만 있을 수 있다
    con.execute(f"""
        CREATE VIEW cand AS
        SELECT isbn13, MAX(loans) AS loans, MAX(is_new) AS is_new
        FROM (
            SELECT isbn13, loans, FALSE AS is_new FROM l WHERE loans >= {LOAN_MIN}
            UNION ALL
            SELECT DISTINCT isbn13_norm, 0, TRUE FROM e
            WHERE isbn13_norm IS NOT NULL AND TRY_CAST(pub_year AS INTEGER) >= {NEW_YEAR}
        )
        GROUP BY isbn13
    """)
    con.execute("""
        CREATE VIEW target AS
        SELECT c.isbn13, c.loans, c.is_new,
               h.isbn13 IS NOT NULL AS has_nl_text
        FROM cand c LEFT JOIN has_text h USING (isbn13)
    """)

    total_loans = con.execute("SELECT sum(loans) FROM target").fetchone()[0] or 0

    # 1단: 누적 대출이 BAND 에 닿을 때까지. 2단: 나머지 신간. 3단: 꼬리
    con.execute(f"""
        CREATE VIEW ranked AS
        SELECT isbn13, loans, is_new, has_nl_text,
               sum(loans) OVER (ORDER BY loans DESC, isbn13
                                ROWS UNBOUNDED PRECEDING) AS cum
        FROM target
    """)
    con.execute(f"""
        CREATE VIEW tiered AS
        SELECT isbn13, loans, has_nl_text,
               CASE WHEN cum <= {total_loans * BAND} THEN 1
                    WHEN is_new                      THEN 2
                    ELSE 3 END AS tier
        FROM ranked
    """)

    con.execute(f"""
        COPY (
            SELECT isbn13, tier, loans, has_nl_text,
                   row_number() OVER (ORDER BY tier, loans DESC, isbn13) AS priority
            FROM tiered ORDER BY priority
        ) TO '{path(out_path)}' (HEADER, DELIMITER ',')
    """)

    rows = con.execute("""
        SELECT tier, count(*), sum(loans), min(loans), max(loans),
               sum(CASE WHEN has_nl_text THEN 1 ELSE 0 END)
        FROM tiered GROUP BY tier ORDER BY tier
    """).fetchall()
    total = sum(r[1] for r in rows)

    print("=== 보강 큐 ===")
    print(f"{'단':<4}{'건수':>10}{'대출합':>14}{'대출범위':>16}{'국중텍스트有':>12}")
    print("-" * 58)
    names = {1: "노출90%", 2: "신간", 3: "꼬리"}
    for tier, n, s, lo, hi, nl_n in rows:
        span = f"{int(lo):,}~{int(hi):,}"
        print(f"{names[tier]:<8}{n:>9,}{int(s or 0):>14,}{span:>16}"
              f"{nl_n:>9,} ({100*nl_n/n:.0f}%)")
    print("-" * 58)
    print(f"{'합계':<8}{total:>9,}")
    print(f"\n저장: {OUT}")
    print(f"1단만으로 전체 대출량의 {BAND:.0%} 를 덮는다 — 중단 시에도 노출 손실은 작다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
