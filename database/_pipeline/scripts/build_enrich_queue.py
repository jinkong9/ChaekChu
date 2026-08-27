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
  - L1 후보: 누적 대출 72+ (수요 99% 유지 임계)  또는  2025+ 신간
  - 국중 텍스트가 이미 있으면(has_text_final) 제외
  - 국중에 아예 없는 정보나루 전용 ISBN 은 텍스트가 없으므로 당연히 포함

산출: data4library/enrich_queue.csv  (isbn13, tier, loans, priority)

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
LOANS = BASE / "data4library" / "loans_by_isbn.parquet"
OUT = BASE / "data4library" / "enrich_queue.csv"

LOAN_MIN = 72        # L1 후보 임계 (수요 99% 유지)
NEW_YEAR = 2025      # 신간 트랙 기준
BAND = 0.90          # 1단이 덮는 누적 대출 비중


def path(p: Path) -> str:
    return str(p).replace("\\", "/")


def main() -> int:
    con = duckdb.connect()
    con.execute(f"CREATE VIEW e AS SELECT * FROM read_parquet('{path(ENRICHED)}')")
    con.execute(f"CREATE VIEW l AS SELECT * FROM read_parquet('{path(LOANS)}')")

    # 국중에서 텍스트를 이미 확보한 ISBN — 보강 대상에서 뺀다
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
        SELECT c.isbn13, c.loans, c.is_new
        FROM cand c LEFT JOIN has_text h USING (isbn13)
        WHERE h.isbn13 IS NULL
    """)

    total_loans = con.execute("SELECT sum(loans) FROM target").fetchone()[0] or 0

    # 1단: 누적 대출이 BAND 에 닿을 때까지. 2단: 나머지 신간. 3단: 꼬리
    con.execute(f"""
        CREATE VIEW ranked AS
        SELECT isbn13, loans, is_new,
               sum(loans) OVER (ORDER BY loans DESC, isbn13
                                ROWS UNBOUNDED PRECEDING) AS cum
        FROM target
    """)
    con.execute(f"""
        CREATE VIEW tiered AS
        SELECT isbn13, loans,
               CASE WHEN cum <= {total_loans * BAND} THEN 1
                    WHEN is_new                      THEN 2
                    ELSE 3 END AS tier
        FROM ranked
    """)

    con.execute(f"""
        COPY (
            SELECT isbn13, tier, loans,
                   row_number() OVER (ORDER BY tier, loans DESC, isbn13) AS priority
            FROM tiered ORDER BY priority
        ) TO '{path(OUT)}' (HEADER, DELIMITER ',')
    """)

    rows = con.execute("""
        SELECT tier, count(*), sum(loans), min(loans), max(loans)
        FROM tiered GROUP BY tier ORDER BY tier
    """).fetchall()
    total = sum(r[1] for r in rows)

    print("=== 보강 큐 ===")
    print(f"{'단':<4}{'건수':>10}{'대출합':>14}{'대출범위':>16}{'비중':>8}")
    print("-" * 54)
    names = {1: "노출90%", 2: "신간", 3: "꼬리"}
    for tier, n, s, lo, hi in rows:
        span = f"{int(lo):,}~{int(hi):,}"
        print(f"{names[tier]:<8}{n:>9,}{int(s or 0):>14,}{span:>16}{100*n/total:>7.1f}%")
    print("-" * 54)
    print(f"{'합계':<8}{total:>9,}")
    print(f"\n저장: {OUT}")
    print(f"1단만으로 전체 대출량의 {BAND:.0%} 를 덮는다 — 중단 시에도 노출 손실은 작다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
