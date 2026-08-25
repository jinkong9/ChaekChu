#!/usr/bin/env python3
"""국중에 있으나 어느 도서관도 소장하지 않는 집합(미커버)의 정체를 규명한다.

방향이 중요하다. 앞선 분석은 '도서관에 있는데 국중에 없는' 쪽이었다.
이 스크립트는 반대편, 즉 **대출 필터가 실제로 버리는 집합**을 본다.

핵심 질문
  1. 미커버 집합에 임베딩 재료(description/목차)를 가진 책이 얼마나 있는가
  2. 그것이 어떤 성격의 책인가 — 버려도 되는가

가장 중요한 지표: 텍스트 보유 국중 레코드 중 미커버 비율.
낮으면 필터는 안전하다. 높으면 값어치 있는 책을 버리는 것이다.

입력
  nl_books_derived.parquet   Phase 0 산출물
  loans_by_isbn.csv          정보나루 수집 결과 (isbn13, loans, holder_libs)

실행
    py scripts/analyze_nl_uncovered.py --loans <경로>
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NL = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books_derived.parquet")
DEFAULT_REPORTS = ROOT / "reports"

AUDIENCE = {"0": "교양", "1": "실용", "2": "여성", "3": "(예비)", "4": "청소년",
            "5": "학습참고(중고)", "6": "학습참고(초등)", "7": "아동", "8": "(예비)",
            "9": "전문"}
FORM = {"0": "문고본", "1": "사전", "2": "신서판", "3": "단행본", "4": "전집·다권본",
        "5": "전자출판물", "6": "도감", "7": "그림책·만화", "8": "혼합자료"}
KDC = {"0": "총류", "1": "철학", "2": "종교", "3": "사회과학", "4": "자연과학",
       "5": "기술과학", "6": "예술", "7": "언어", "8": "문학", "9": "역사"}


def pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 2) if whole else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nl", type=Path, default=DEFAULT_NL)
    parser.add_argument("--loans", type=Path, required=True)
    parser.add_argument("--scope", default="nl_uncovered")
    args = parser.parse_args()

    DEFAULT_REPORTS.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET memory_limit='4GB'")
    con.execute(f"""
        CREATE VIEW loans AS
        SELECT isbn13, CAST(loans AS BIGINT) AS loans,
               CAST(holder_libs AS INTEGER) AS holder_libs
        FROM read_csv('{args.loans.as_posix()}', header=true,
                      columns={{'isbn13':'VARCHAR','loans':'VARCHAR','holder_libs':'VARCHAR'}})
    """)
    con.execute(f"""
        CREATE VIEW nl AS
        SELECT *, (l.isbn13 IS NOT NULL) AS covered, coalesce(l.loans, 0) AS lib_loans
        FROM '{args.nl.as_posix()}' n
        LEFT JOIN loans l ON n.isbn13_norm = l.isbn13
        WHERE n.isbn13_norm IS NOT NULL
    """)

    total, covered = con.execute(
        "SELECT count(*), sum(covered::INT) FROM nl").fetchone()
    uncovered = total - covered

    out: list[str] = []
    add = out.append
    add("국중 미커버 집합 분석 — 대출 필터가 버리는 것의 정체")
    add("=" * 78)
    add(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    add(f"국중 정규화 ISBN {total:,}건")
    add(f"  도서관 소장(커버) {covered:,}건 ({pct(covered, total):.1f}%)")
    add(f"  미커버           {uncovered:,}건 ({pct(uncovered, total):.1f}%)")
    add("")

    # ---------- 1 핵심: 텍스트 보유 책이 버려지는가 ----------
    add("[1] 가장 중요한 질문 — 텍스트 보유 레코드가 버려지는가")
    rows = con.execute("""
        SELECT has_usable_text, count(*) n, sum(covered::INT) c FROM nl GROUP BY 1
    """).fetchall()
    add(f"  {'구분':<18}{'전체':>12}{'커버':>12}{'미커버':>12}{'미커버율':>10}")
    add("  " + "-" * 66)
    for has_text, n, c in sorted(rows, key=lambda x: -x[0]):
        label = "텍스트 보유(>=100자)" if has_text else "텍스트 없음"
        add(f"  {label:<18}{n:>12,}{c:>12,}{n-c:>12,}{pct(n-c, n):>9.1f}%")
    add("")
    add("  -> 텍스트 보유 레코드의 미커버율이 전체 미커버율보다 낮으면")
    add("     필터는 값어치 있는 책을 우선적으로 남기고 있다는 뜻이다.")
    add("")

    # ---------- 2 발행연도 ----------
    add("[2] 발행연도별 미커버율")
    add(f"  {'구간':<10}{'전체':>12}{'커버':>12}{'미커버':>12}{'미커버율':>10}")
    add("  " + "-" * 58)
    for label, cond in [
        ("~1999", "pub_year < 2000"), ("2000-04", "pub_year BETWEEN 2000 AND 2004"),
        ("2005-09", "pub_year BETWEEN 2005 AND 2009"),
        ("2010-14", "pub_year BETWEEN 2010 AND 2014"),
        ("2015-19", "pub_year BETWEEN 2015 AND 2019"),
        ("2020-24", "pub_year BETWEEN 2020 AND 2024"),
        ("2025-", "pub_year >= 2025"), ("연도 미상", "pub_year IS NULL"),
    ]:
        n, c = con.execute(f"SELECT count(*), sum(covered::INT) FROM nl WHERE {cond}").fetchone()
        if not n:
            continue
        add(f"  {label:<10}{n:>12,}{c or 0:>12,}{n-(c or 0):>12,}{pct(n-(c or 0), n):>9.1f}%")
    add("")

    # ---------- 3 독자대상 / 발행형태 / 분류 ----------
    for column, mapping, title in [
        ("add_audience", AUDIENCE, "[3] 독자대상(EA_ADD_CODE 첫자리)별 미커버율"),
        ("add_form", FORM, "[4] 발행형태(EA_ADD_CODE 둘째자리)별 미커버율"),
        ("substr(add_kdc3,1,1)", KDC, "[5] KDC 대분류별 미커버율"),
    ]:
        add(title)
        add(f"  {'코드':<20}{'전체':>12}{'미커버':>12}{'미커버율':>10}")
        add("  " + "-" * 56)
        rows = con.execute(f"""
            SELECT {column} g, count(*) n, sum(covered::INT) c
            FROM nl WHERE {column} IS NOT NULL GROUP BY 1 HAVING count(*) >= 3000
            ORDER BY 2 DESC
        """).fetchall()
        for group, n, c in rows:
            label = f"{group} {mapping.get(group, '?')}"
            add(f"  {label:<20}{n:>12,}{n-(c or 0):>12,}{pct(n-(c or 0), n):>9.1f}%")
        add("")

    # ---------- 6 가격 / CIP / 전자책 ----------
    add("[6] 상업성 지표별 미커버율")
    add(f"  {'구분':<24}{'전체':>12}{'미커버':>12}{'미커버율':>10}")
    add("  " + "-" * 60)
    for label, cond in [
        ("정가 있음(숫자)", "pre_price IS NOT NULL AND pre_price NOT LIKE '%비매품%'"
                       " AND TRY_CAST(replace(pre_price,',','') AS INTEGER) IS NOT NULL"),
        ("비매품/무료", "pre_price LIKE '%비매품%' OR pre_price LIKE '%무료%'"),
        ("정가 미기재", "pre_price IS NULL"),
        ("CIP_YN = Y", "trim(coalesce(CIP_YN,'')) = 'Y'"),
        ("CIP_YN = N", "trim(coalesce(CIP_YN,'')) = 'N'"),
        ("전자책(EBOOK_YN=Y)", "trim(coalesce(EBOOK_YN,'')) = 'Y'"),
    ]:
        n, c = con.execute(f"SELECT count(*), sum(covered::INT) FROM nl WHERE {cond}").fetchone()
        if not n:
            continue
        add(f"  {label:<24}{n:>12,}{n-(c or 0):>12,}{pct(n-(c or 0), n):>9.1f}%")
    add("")

    # ---------- 7 미커버인데 텍스트 있는 책 = 가장 아까운 집합 ----------
    add("[7] 미커버 + 텍스트 보유 = 가장 아까운 집합")
    n = con.execute(
        "SELECT count(*) FROM nl WHERE NOT covered AND has_usable_text").fetchone()[0]
    add(f"  규모 {n:,}건 (미커버 {uncovered:,}건의 {pct(n, uncovered):.1f}%)")
    add("")
    add("  발행연도 분포:")
    for label, cond in [("~2014", "pub_year < 2015"),
                        ("2015-19", "pub_year BETWEEN 2015 AND 2019"),
                        ("2020-24", "pub_year BETWEEN 2020 AND 2024"),
                        ("2025-", "pub_year >= 2025")]:
        c = con.execute(f"SELECT count(*) FROM nl WHERE NOT covered "
                        f"AND has_usable_text AND {cond}").fetchone()[0]
        add(f"    {label:<10}{c:>10,}  {pct(c, n):>5.1f}%")
    add("")
    add("  독자대상 분포:")
    for group, cnt in con.execute("""
        SELECT add_audience, count(*) FROM nl
        WHERE NOT covered AND has_usable_text AND add_audience IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 6
    """).fetchall():
        add(f"    {group} {AUDIENCE.get(group,'?'):<14}{cnt:>10,}  {pct(cnt, n):>5.1f}%")
    add("")
    add("  출판사 상위 12:")
    for name, cnt in con.execute("""
        SELECT coalesce(nullif(trim(PUBLISHER),''),'(없음)') p, count(*) FROM nl
        WHERE NOT covered AND has_usable_text GROUP BY 1 ORDER BY 2 DESC LIMIT 12
    """).fetchall():
        add(f"    {name[:28]:<30}{cnt:>10,}")
    add("")
    add("  실제 사례 20건 (소개 긴 것 순):")
    for title, publisher, year, length in con.execute("""
        SELECT TITLE, PUBLISHER, pub_year, intro_len FROM nl
        WHERE NOT covered AND has_usable_text
        ORDER BY intro_len DESC LIMIT 20
    """).fetchall():
        add(f"    {(title or '')[:44]:<46}{(publisher or '')[:14]:<16}"
            f"{year or 0:>6}{length:>7}자")
    add("")

    # ---------- 8 소장 도서관 수 분포 ----------
    add("[8] 커버된 책의 소장 도서관 수 (희소성)")
    rows = con.execute("""
        SELECT CASE WHEN holder_libs = 1 THEN '1개관'
                    WHEN holder_libs <= 3 THEN '2-3개관'
                    WHEN holder_libs <= 10 THEN '4-10개관'
                    WHEN holder_libs <= 50 THEN '11-50개관'
                    ELSE '51개관+' END g,
               count(*) n, sum(has_usable_text::INT) t
        FROM nl WHERE covered GROUP BY 1
    """).fetchall()
    order = ["1개관", "2-3개관", "4-10개관", "11-50개관", "51개관+"]
    lookup = {g: (n, t) for g, n, t in rows}
    add(f"  {'소장 도서관수':<14}{'건수':>12}{'텍스트보유':>12}{'보유율':>9}")
    add("  " + "-" * 50)
    for key in order:
        if key not in lookup:
            continue
        n, t = lookup[key]
        add(f"  {key:<14}{n:>12,}{t:>12,}{pct(t, n):>8.1f}%")

    path = DEFAULT_REPORTS / f"data_quality_summary_{args.scope}.txt"
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))
    print(f"\n생성: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
