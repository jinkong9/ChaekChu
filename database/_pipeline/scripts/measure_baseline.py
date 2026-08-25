#!/usr/bin/env python3
"""Phase 0 — 국립중앙도서관 전수 기준선 측정. API 호출 0회.

산출
  0-1  ISBN13 정규화와 유효성
  0-2  발간연도 분포 (전수 실측. 기존 6.1은 캐시 기반 추정치였다)
  0-3  텍스트 5필드 합집합          <- 보완 전 기준선. 최우선 항목
  0-4  EA_ADD_CODE 분류 복원
  0-5  연도 x CIP_YN 교차표
  0-6  BOOK_INTRODUCTION_URL 확장자 분포 (.txt 즉시 사용 vs .jpg OCR 필요)
  0-7  층화 보조축 후보 비교        <- CIP_YN 이 2020년 이후 붕괴하므로 대안 탐색

부산물로 파생 컬럼이 붙은 Parquet 을 만든다. Phase 1 층화 표본 추출이 이걸 쓴다.

실행:
    py scripts/measure_baseline.py
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import isbn_sql

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books.parquet")
DEFAULT_DERIVED = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books_derived.parquet")
DEFAULT_REPORTS = ROOT / "reports"

USABLE_MIN_CHARS = 100   # 이 미만은 플레이스홀더로 간주 (Google Books 측정에서 확인된 함정)

TEXT_FIELDS = [
    ("BOOK_INTRODUCTION", "책소개"),
    ("BOOK_TB_CNT", "목차"),
    ("BOOK_SUMMARY", "요약"),
]
URL_FIELDS = [
    ("BOOK_INTRODUCTION_URL", "책소개URL"),
    ("BOOK_TB_CNT_URL", "목차URL"),
    ("BOOK_SUMMARY_URL", "요약URL"),
]

def pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 2) if whole else 0.0


def build_derived(con: duckdb.DuckDBPyConnection, source: Path, target: Path) -> None:
    """파생 컬럼을 붙인 Parquet 을 만든다. Phase 1 표본 추출이 이 파일을 쓴다."""
    isbn_sql.install(con)   # norm_isbn13 / isbn_kind 매크로

    intro = "length(trim(coalesce(BOOK_INTRODUCTION,'')))"
    toc = "length(trim(coalesce(BOOK_TB_CNT,'')))"
    summary = "length(trim(coalesce(BOOK_SUMMARY,'')))"

    con.execute(f"""
        COPY (
            SELECT
                EA_ISBN,
                norm_isbn13(EA_ISBN)                         AS isbn13_norm,
                isbn_kind(EA_ISBN)                           AS isbn_kind,
                TITLE, AUTHOR, PUBLISHER,
                PUBLISH_PREDATE,
                TRY_CAST(substr(PUBLISH_PREDATE, 1, 4) AS INTEGER) AS pub_year,
                EA_ADD_CODE,
                CASE WHEN EA_ADD_CODE ~ '^[0-9]{{5}}$'
                     THEN substr(EA_ADD_CODE, 1, 1) END      AS add_audience,
                CASE WHEN EA_ADD_CODE ~ '^[0-9]{{5}}$'
                     THEN substr(EA_ADD_CODE, 2, 1) END      AS add_form,
                CASE WHEN EA_ADD_CODE ~ '^[0-9]{{5}}$'
                     THEN substr(EA_ADD_CODE, 3, 3) END      AS add_kdc3,
                KDC, SUBJECT, CIP_YN, EBOOK_YN,
                nullif(trim(PRE_PRICE), '')                  AS pre_price,
                nullif(trim(PUBLISHER), '')                  AS publisher_nz,
                {intro}                                      AS intro_len,
                {toc}                                        AS toc_len,
                {summary}                                    AS summary_len,
                nullif(trim(BOOK_INTRODUCTION_URL), '')      AS intro_url,
                nullif(trim(BOOK_TB_CNT_URL), '')            AS toc_url,
                nullif(trim(BOOK_SUMMARY_URL), '')           AS summary_url,
                ({intro} >= {USABLE_MIN_CHARS}
                 OR {toc} >= {USABLE_MIN_CHARS}
                 OR {summary} >= {USABLE_MIN_CHARS})         AS has_usable_text
            FROM '{source.as_posix()}'
        ) TO '{target.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--derived", type=Path, default=DEFAULT_DERIVED)
    parser.add_argument("--scope", default="nl_baseline")
    args = parser.parse_args()

    DEFAULT_REPORTS.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET memory_limit='4GB'")

    print("파생 컬럼 생성 중...")
    started = time.time()
    build_derived(con, args.input, args.derived)
    print(f"  완료 ({time.time() - started:.0f}초) -> {args.derived}")
    src = f"'{args.derived.as_posix()}'"

    total = con.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
    out: list[str] = []
    add = out.append
    add("Phase 0 — 국립중앙도서관 전수 기준선")
    add("=" * 78)
    add(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    add(f"입력: {args.input}")
    add(f"전체 레코드: {total:,}건")
    add(f"사용가능 텍스트 기준: {USABLE_MIN_CHARS}자 이상")
    add("")

    # ---------- 0-1 ISBN ----------
    add("[0-1] EA_ISBN 형식과 정규화")
    rows = con.execute(f"""
        SELECT isbn_kind, count(*) c FROM {src} GROUP BY 1 ORDER BY c DESC
    """).fetchall()
    for kind, count in rows:
        add(f"  {kind:<20} {count:>10,}건 {pct(count, total):>6.2f}%")
    normalized, unique_norm = con.execute(f"""
        SELECT count(isbn13_norm), count(DISTINCT isbn13_norm) FROM {src}
    """).fetchone()
    add(f"  {'-' * 44}")
    add(f"  정규화 성공          {normalized:>10,}건 {pct(normalized, total):>6.2f}%")
    add(f"  정규화 실패          {total - normalized:>10,}건 {pct(total - normalized, total):>6.2f}%")
    add(f"  고유 ISBN13          {unique_norm:>10,}건 (중복 {normalized - unique_norm:,}건)")
    add("")

    # ---------- 0-2 연도 ----------
    add("[0-2] 발간연도 분포 (전수 실측)")
    buckets = con.execute(f"""
        SELECT CASE
                 WHEN pub_year IS NULL THEN 'NULL'
                 WHEN pub_year < 2000 THEN '~1999'
                 WHEN pub_year < 2005 THEN '2000-04'
                 WHEN pub_year < 2010 THEN '2005-09'
                 WHEN pub_year < 2015 THEN '2010-14'
                 WHEN pub_year < 2020 THEN '2015-19'
                 WHEN pub_year < 2025 THEN '2020-24'
                 ELSE '2025-' END AS bucket,
               count(*) c,
               sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END) t
        FROM {src} GROUP BY 1
    """).fetchall()
    order = ["~1999", "2000-04", "2005-09", "2010-14", "2015-19", "2020-24", "2025-", "NULL"]
    lookup = {b: (c, t) for b, c, t in buckets}
    add(f"  {'구간':<10}{'건수':>12}{'비중':>8}{'텍스트보유':>12}{'보유율':>9}")
    add("  " + "-" * 51)
    for label in order:
        if label not in lookup:
            continue
        count, text = lookup[label]
        add(f"  {label:<10}{count:>12,}{pct(count, total):>7.1f}%{text:>12,}{pct(text, count):>8.1f}%")
    add("")

    # ---------- 0-3 텍스트 합집합 ----------
    add("[0-3] 텍스트 필드 합집합 — 보완 전 기준선 (최우선 항목)")
    add(f"  {'필드':<14}{'>=1자':>12}{'보유율':>9}{'>=100자':>12}{'보유율':>9}")
    add("  " + "-" * 56)
    for column, label in [("intro_len", "책소개"), ("toc_len", "목차"), ("summary_len", "요약")]:
        any_c, use_c = con.execute(f"""
            SELECT sum(CASE WHEN {column} > 0 THEN 1 ELSE 0 END),
                   sum(CASE WHEN {column} >= {USABLE_MIN_CHARS} THEN 1 ELSE 0 END)
            FROM {src}
        """).fetchone()
        add(f"  {label:<14}{any_c:>12,}{pct(any_c, total):>8.2f}%{use_c:>12,}{pct(use_c, total):>8.2f}%")
    for column, label in [("intro_url", "책소개URL"), ("toc_url", "목차URL"), ("summary_url", "요약URL")]:
        c = con.execute(f"SELECT count({column}) FROM {src}").fetchone()[0]
        add(f"  {label:<14}{c:>12,}{pct(c, total):>8.2f}%{'-':>12}{'-':>9}")
    union_any, union_use = con.execute(f"""
        SELECT sum(CASE WHEN intro_len>0 OR toc_len>0 OR summary_len>0
                        OR intro_url IS NOT NULL OR toc_url IS NOT NULL
                        OR summary_url IS NOT NULL THEN 1 ELSE 0 END),
               sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END)
        FROM {src}
    """).fetchone()
    add("  " + "-" * 56)
    add(f"  {'5필드 합집합':<14}{union_any:>12,}{pct(union_any, total):>8.2f}%"
        f"{union_use:>12,}{pct(union_use, total):>8.2f}%")
    add(f"  (합집합은 URL 포함 기준. >=100자 열은 본문 텍스트만 센 값)")
    add("")

    # ---------- 0-4 EA_ADD_CODE ----------
    add("[0-4] EA_ADD_CODE 분류 복원")
    kdc_ok, kdc_col, subj = con.execute(f"""
        SELECT count(add_kdc3),
               sum(CASE WHEN nullif(trim(KDC),'') IS NOT NULL THEN 1 ELSE 0 END),
               sum(CASE WHEN nullif(trim(SUBJECT),'') IS NOT NULL THEN 1 ELSE 0 END)
        FROM {src}
    """).fetchone()
    add(f"  {'출처':<26}{'유효건수':>12}{'결측률':>9}")
    add("  " + "-" * 47)
    add(f"  {'기존 KDC 컬럼':<26}{kdc_col:>12,}{100 - pct(kdc_col, total):>8.2f}%")
    add(f"  {'SUBJECT 컬럼':<26}{subj:>12,}{100 - pct(subj, total):>8.2f}%")
    add(f"  {'EA_ADD_CODE[2:5] 복원':<26}{kdc_ok:>12,}{100 - pct(kdc_ok, total):>8.2f}%")
    if kdc_col:
        add(f"  -> 분류 확보 {kdc_col:,} → {kdc_ok:,}건, {kdc_ok / kdc_col:.1f}배")
    add("")

    # ---------- 0-5 연도 x CIP_YN ----------
    add("[0-5] 연도 x CIP_YN 교차표 (텍스트 보유율)")
    add(f"  {'구간':<10}{'CIP=Y':>18}{'CIP=N':>18}{'CIP 빈값':>18}")
    add("  " + "-" * 64)
    for label in order[:-1]:
        cells = []
        for state in ["Y", "N", ""]:
            cond = ("trim(coalesce(CIP_YN,'')) = ''" if state == ""
                    else f"trim(CIP_YN) = '{state}'")
            row = con.execute(f"""
                SELECT count(*), sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END)
                FROM {src}
                WHERE {cond} AND {bucket_filter(label)}
            """).fetchone()
            n, t = row[0], row[1] or 0
            cells.append(f"{n:,}건 {pct(t, n):.1f}%" if n >= 30 else f"n={n}")
        add(f"  {label:<10}{cells[0]:>18}{cells[1]:>18}{cells[2]:>18}")
    add("")

    # ---------- 0-6 URL 확장자 ----------
    add("[0-6] 텍스트 URL 확장자 분포 (.txt 즉시 사용 / .jpg OCR 필요)")
    for column, label in [("intro_url", "책소개URL"), ("toc_url", "목차URL"), ("summary_url", "요약URL")]:
        rows = con.execute(f"""
            SELECT lower(regexp_extract({column}, '\\.([a-zA-Z0-9]+)$', 1)) ext, count(*) c
            FROM {src} WHERE {column} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 5
        """).fetchall()
        subtotal = sum(c for _, c in rows)
        parts = " / ".join(f"{e or '(없음)'} {pct(c, subtotal):.1f}%" for e, c in rows)
        add(f"  {label:<12} n={subtotal:>9,}  {parts}")
    add("")

    # ---------- 0-7 층화 보조축 후보 ----------
    add("[0-7] 층화 보조축 후보 비교")
    add("  선정 기준: 전 연대에서 보유율이 높고(안정성), 텍스트 보유율 격차가 큰 것(판별력)")
    add(f"  {'후보':<22}{'값보유율':>10}{'최고그룹':>22}{'최저그룹':>22}{'판별력':>9}")
    add("  " + "-" * 85)
    for expr, label in [
        ("CASE WHEN trim(coalesce(CIP_YN,'')) = '' THEN NULL ELSE trim(CIP_YN) END", "CIP_YN"),
        ("add_audience", "EA_ADD_CODE[0] 독자대상"),
        ("add_form", "EA_ADD_CODE[1] 발행형태"),
        ("CASE WHEN pre_price IS NULL THEN 'N' ELSE 'Y' END", "PRE_PRICE 유무"),
        ("CASE WHEN publisher_nz IS NULL THEN 'N' ELSE 'Y' END", "PUBLISHER 유무"),
        ("nullif(trim(coalesce(EBOOK_YN,'')),'')", "EBOOK_YN"),
    ]:
        rows = con.execute(f"""
            SELECT {expr} g, count(*) n,
                   sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END) t
            FROM {src} WHERE {expr} IS NOT NULL GROUP BY 1 HAVING count(*) >= 1000
        """).fetchall()
        if not rows:
            continue
        covered = sum(n for _, n, _ in rows)
        scored = sorted(((g, pct(t, n), n) for g, n, t in rows), key=lambda x: -x[1])
        best, worst = scored[0], scored[-1]
        ratio = best[1] / worst[1] if worst[1] else float("inf")
        # 최소 그룹이 전체의 5% 미만이면 비율이 불안정하다. 판별력으로 읽으면 안 된다.
        smallest = min(n for _, _, n in scored)
        warn = "  <- 소수그룹 왜곡" if smallest < covered * 0.05 else ""
        add(f"  {label:<22}{pct(covered, total):>9.1f}%"
            f"{best[0] + ' ' + format(best[1], '.1f') + '% (n=' + format(best[2], ',') + ')':>22}"
            f"{worst[0] + ' ' + format(worst[1], '.1f') + '% (n=' + format(worst[2], ',') + ')':>22}"
            f"{ratio:>8.1f}배{warn}")
    add("")

    # ---------- 0-8 텍스트 집중도 ----------
    add("[0-8] 텍스트 보유 건의 연대 집중도 — 이번 측정의 최대 발견")
    rows = con.execute(f"""
        SELECT CASE WHEN pub_year < 2015 THEN '2014년 이전' ELSE '2015년 이후' END g,
               count(*) n, sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END) t
        FROM {src} GROUP BY 1 ORDER BY 1
    """).fetchall()
    text_total = sum(t for _, _, t in rows)
    add(f"  {'구간':<12}{'레코드':>12}{'텍스트보유':>12}{'구간내보유율':>13}{'전체텍스트중':>13}")
    add("  " + "-" * 62)
    for group, n, t in rows:
        add(f"  {group:<12}{n:>12,}{t:>12,}{pct(t, n):>12.2f}%{pct(t, text_total):>12.1f}%")
    add("")
    add("  국중 자체 텍스트는 2015년 이후 자료에만 사실상 존재한다.")
    add("  2014년 이전 91만건 중 텍스트 보유는 131건뿐이다.")
    add("  따라서 2015년 이전 구간은 외부 소스에 100% 의존한다.")
    add("")

    # ---------- 0-9 URL 회수 가능 풀 ----------
    add("[0-9] 본문 없이 URL 만 있는 건 — API 쿼터 없이 회수 가능한 풀")
    add(f"  {'구간':<10}{'레코드':>11}{'본문보유':>10}{'URL만보유':>11}{'회수후':>10}")
    add("  " + "-" * 52)
    grand_url = 0
    for label in order[:-1]:
        n, t, u = con.execute(f"""
            SELECT count(*),
                   sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END),
                   sum(CASE WHEN NOT has_usable_text AND (intro_url IS NOT NULL
                        OR toc_url IS NOT NULL OR summary_url IS NOT NULL)
                       THEN 1 ELSE 0 END)
            FROM {src} WHERE {bucket_filter(label)}
        """).fetchone()
        grand_url += u or 0
        add(f"  {label:<10}{n:>11,}{t or 0:>10,}{u or 0:>11,}{pct((t or 0) + (u or 0), n):>9.1f}%")
    add("  " + "-" * 52)
    add(f"  {'합계':<10}{total:>11,}{union_use:>10,}{grand_url:>11,}"
        f"{pct(union_use + grand_url, total):>9.1f}%")
    add("")
    ext = con.execute(f"""
        SELECT lower(regexp_extract(coalesce(intro_url, toc_url, summary_url),
                                    '\.([a-zA-Z0-9]+)$', 1)) e, count(*) c
        FROM {src}
        WHERE NOT has_usable_text AND (intro_url IS NOT NULL
              OR toc_url IS NOT NULL OR summary_url IS NOT NULL)
        GROUP BY 1 ORDER BY c DESC LIMIT 4
    """).fetchall()
    ext_total = sum(c for _, c in ext)
    add("  확장자: " + " / ".join(f"{e or '(없음)'} {c:,}건 {pct(c, ext_total):.1f}%" for e, c in ext))
    txt_count = next((c for e, c in ext if e == "txt"), 0)
    add(f"  -> .txt {txt_count:,}건은 OCR 없이 즉시 회수 가능하다.")
    add(f"  -> 회수하면 텍스트 보유가 {union_use:,}건({pct(union_use, total):.2f}%) 에서 "
        f"{union_use + txt_count:,}건({pct(union_use + txt_count, total):.2f}%) 으로 늘어난다.")
    add("  -> 이 회수는 nl.go.kr 정적 파일 요청이라 API 쿼터를 쓰지 않는다.")
    add("")

    # ---------- CSV ----------
    csv_path = DEFAULT_REPORTS / f"missing_report_{args.scope}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as sink:
        writer = csv.writer(sink)
        writer.writerow(["year_bucket", "record_count", "share_percent",
                         "intro_ge1", "toc_ge1", "summary_ge1",
                         "union5_with_url", "usable_text_ge100",
                         "usable_rate_percent"])
        for label in order[:-1]:
            row = con.execute(f"""
                SELECT count(*),
                       sum(CASE WHEN intro_len>0 THEN 1 ELSE 0 END),
                       sum(CASE WHEN toc_len>0 THEN 1 ELSE 0 END),
                       sum(CASE WHEN summary_len>0 THEN 1 ELSE 0 END),
                       sum(CASE WHEN intro_len>0 OR toc_len>0 OR summary_len>0
                                OR intro_url IS NOT NULL OR toc_url IS NOT NULL
                                OR summary_url IS NOT NULL THEN 1 ELSE 0 END),
                       sum(CASE WHEN has_usable_text THEN 1 ELSE 0 END)
                FROM {src} WHERE {bucket_filter(label)}
            """).fetchone()
            n = row[0]
            writer.writerow([label, n, pct(n, total), row[1], row[2], row[3],
                             row[4], row[5], pct(row[5] or 0, n)])

    summary_path = DEFAULT_REPORTS / f"data_quality_summary_{args.scope}.txt"
    summary_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))
    print(f"\n생성: {summary_path}")
    return 0


def bucket_filter(label: str) -> str:
    ranges = {
        "~1999": "pub_year < 2000", "2000-04": "pub_year BETWEEN 2000 AND 2004",
        "2005-09": "pub_year BETWEEN 2005 AND 2009", "2010-14": "pub_year BETWEEN 2010 AND 2014",
        "2015-19": "pub_year BETWEEN 2015 AND 2019", "2020-24": "pub_year BETWEEN 2020 AND 2024",
        "2025-": "pub_year >= 2025",
    }
    return ranges.get(label, "TRUE")


if __name__ == "__main__":
    raise SystemExit(main())
