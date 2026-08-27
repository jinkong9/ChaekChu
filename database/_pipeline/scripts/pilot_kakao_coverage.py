#!/usr/bin/env python3
"""[파일럿] 카카오 도서 API 의 description 보강 능력 측정.

남은 최대 미지수 K 를 닫는다: L1 후보 중 텍스트 미보유분을 카카오가 얼마나 채우는가.

모집단 (1,660개관 실측 기준)
  L1 후보 (누적 대출 72+)              948,537
    ├ 텍스트 보유 (국중 본문)            32,427   3.4%  <- 보강 불필요
    ├ URL 만 보유 (국중, 회수 가능)       93,813   9.9%  <- 별도 트랙(API 0회)
    ├ 국중매칭·텍스트없음               493,106  52.0%  <- 보강 대상
    └ 정보나루 전용 (국중에 없음)         329,200  34.7%  <- 보강 대상

층화 (각 층 SAMPLE_PER 건, 시드 고정)
  A  국중매칭·텍스트없음·~2006      146,109   구간 리스크(판본 분산)
  B  국중매칭·텍스트없음·2007-2014  225,178
  C  국중매칭·텍스트없음·2015+      215,668
  D  정보나루 전용                  329,200   국중 서지조차 없는 구간
  E  텍스트없음 중 대출 상위          (교차)    노출 가중 커버리지 검증

지표
  매칭률          카카오가 그 ISBN 을 아는가
  contents 보유율  매칭 건 중 소개문이 있는가
  사용가능(>=100자) 플레이스홀더 배제 후
  무조건부 확보율   매칭률 x 사용가능 비율  <- K

사후층화: 층별 모집단 크기로 가중해 전체 K 를 추정한다(E 는 교차층이라 제외).

실행:
    py scripts/pilot_kakao_coverage.py --per 150
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\data4library")
NL = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books_derived.parquet")
ENV = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\.env")
REPORTS = ROOT / "reports"
RAW_OUT = DATA / "kakao_pilot_raw.jsonl"

API = "https://dapi.kakao.com/v3/search/book"
USABLE_MIN = 100          # 이 미만은 플레이스홀더로 간주 (Google Books 에서 확인된 함정)
LOAN_THRESHOLD = 72       # L1 필터: 수요 99% 유지 임계
SEED = 20260826

# (층 코드, 설명, 모집단 크기, SQL 조건)
STRATA = [
    ("A", "국중매칭·텍스트없음·~2006", 146109, "m AND NOT tx AND pub_year < 2007"),
    ("B", "국중매칭·텍스트없음·2007-2014", 225178,
     "m AND NOT tx AND pub_year BETWEEN 2007 AND 2014"),
    ("C", "국중매칭·텍스트없음·2015+", 215668, "m AND NOT tx AND pub_year >= 2015"),
    ("D", "정보나루 전용(국중 없음)", 329200, "NOT m"),
]
POOLED = ["A", "B", "C", "D"]   # 사후층화 대상 (E 는 교차층이라 제외)


def load_key() -> str:
    raw = ENV.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949", "replace")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() in ("카카오", "KAKAO", "KAKAO_REST_API_KEY"):
            return value.strip().strip("\"'")
    raise SystemExit("카카오 키를 .env 에서 찾지 못했습니다.")


def query(key: str, isbn: str, retries: int = 3) -> dict:
    url = API + "?" + urllib.parse.urlencode({"target": "isbn", "query": isbn, "size": 5})
    request = urllib.request.Request(
        url, headers={"Authorization": "KakaoAK " + key,
                      "User-Agent": "b102-kakao-pilot/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code == 429:
                time.sleep(2 ** attempt)
                continue
            return {"__http__": error.code,
                    "__body__": error.read().decode("utf-8", "replace")[:200]}
        except (URLError, TimeoutError):
            time.sleep(1 + attempt)
    return {"__error__": "retries-exhausted"}


def pick_doc(payload: dict, isbn: str) -> dict | None:
    """요청 ISBN 과 실제로 일치하는 문서만 채택 (다른 판본 반환 방지)."""
    for doc in payload.get("documents") or []:
        tokens = (doc.get("isbn") or "").replace("-", "").split()
        if isbn in tokens:
            return doc
    return None


def sample(con: duckdb.DuckDBPyConnection, per: int) -> list[dict]:
    con.execute(f"CREATE OR REPLACE VIEW L AS SELECT * FROM '{(DATA/'loans_by_isbn.parquet').as_posix()}'")
    con.execute(f"""CREATE OR REPLACE VIEW N AS
        SELECT DISTINCT ON(isbn13_norm) isbn13_norm i, pub_year, TITLE,
               has_usable_text tx
        FROM '{NL.as_posix()}' WHERE isbn13_norm IS NOT NULL""")
    con.execute(f"""CREATE OR REPLACE VIEW C AS
        SELECT L.isbn13, L.loans, L.holder_libs, n.pub_year, n.TITLE,
               coalesce(n.tx, false) tx, (n.i IS NOT NULL) m
        FROM L LEFT JOIN N n ON L.isbn13 = n.i
        WHERE L.loans >= {LOAN_THRESHOLD}""")

    rows: list[dict] = []
    for code, label, pop, cond in STRATA:
        got = con.execute(f"""
            SELECT isbn13, loans, pub_year, TITLE FROM C
            WHERE {cond} ORDER BY hash(isbn13 || '{SEED}') LIMIT {per}
        """).fetchall()
        for isbn, loans, year, title in got:
            rows.append({"stratum": code, "label": label, "pop": pop,
                         "isbn13": isbn, "loans": loans,
                         "pub_year": year, "nl_title": title})
    # E: 텍스트없음 전체에서 대출 상위
    for isbn, loans, year, title in con.execute(f"""
        SELECT isbn13, loans, pub_year, TITLE FROM C
        WHERE NOT tx ORDER BY loans DESC LIMIT {per}
    """).fetchall():
        rows.append({"stratum": "E", "label": "텍스트없음·대출 상위", "pop": 0,
                     "isbn13": isbn, "loans": loans,
                     "pub_year": year, "nl_title": title})
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per", type=int, default=150, help="층당 표본 수")
    parser.add_argument("--sleep", type=float, default=0.06)
    args = parser.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)
    key = load_key()
    con = duckdb.connect()
    con.execute("SET memory_limit='6GB'")

    targets = sample(con, args.per)
    print(f"표본 {len(targets)}건 (층당 {args.per}, 시드 {SEED})", flush=True)

    results: list[dict] = []
    started = time.time()
    with RAW_OUT.open("w", encoding="utf-8") as sink:
        for index, row in enumerate(targets, start=1):
            payload = query(key, row["isbn13"])
            doc = pick_doc(payload, row["isbn13"]) if "documents" in payload else None
            contents = (doc or {}).get("contents") or ""
            record = {
                **row,
                "matched": doc is not None,
                "contents_len": len(contents.strip()),
                "kakao_title": (doc or {}).get("title"),
                "kakao_publisher": (doc or {}).get("publisher"),
                "kakao_datetime": (doc or {}).get("datetime"),
                "has_thumbnail": bool((doc or {}).get("thumbnail")),
                "price": (doc or {}).get("price"),
                "status": (doc or {}).get("status"),
                "api_error": payload.get("__http__") or payload.get("__error__"),
                "contents": contents[:400],
            }
            results.append(record)
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            if index % 100 == 0:
                print(f"  {index}/{len(targets)}  ({time.time()-started:.0f}초)", flush=True)
            if args.sleep:
                time.sleep(args.sleep)

    # ---------- 집계 ----------
    out: list[str] = []
    add = out.append
    add("카카오 description 보강 파일럿")
    add("=" * 84)
    add(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    add(f"표본 {len(results)}건 / 층당 {args.per} / 시드 {SEED}")
    add(f"L1 후보 모집단: 948,537건 (누적 대출 {LOAN_THRESHOLD}+)")
    add(f"사용가능 기준: contents >= {USABLE_MIN}자")
    add("")
    add(f"  {'층':<4}{'설명':<26}{'n':>5}{'매칭':>7}{'매칭률':>8}"
        f"{'소개보유':>9}{'사용가능':>9}{'K(무조건부)':>12}")
    add("  " + "-" * 82)

    by_stratum: dict[str, dict] = {}
    for code, label, pop, _ in STRATA + [("E", "텍스트없음·대출 상위", 0, "")]:
        group = [r for r in results if r["stratum"] == code]
        if not group:
            continue
        n = len(group)
        matched = [r for r in group if r["matched"]]
        usable = [r for r in matched if r["contents_len"] >= USABLE_MIN]
        any_c = [r for r in matched if r["contents_len"] > 0]
        k = len(usable) / n if n else 0
        by_stratum[code] = {"n": n, "pop": pop, "matched": len(matched),
                            "any": len(any_c), "usable": len(usable), "k": k}
        add(f"  {code:<4}{label:<26}{n:>5}{len(matched):>7}"
            f"{100*len(matched)/n:>7.1f}%{100*len(any_c)/max(len(matched),1):>8.1f}%"
            f"{100*len(usable)/max(len(matched),1):>8.1f}%{100*k:>11.1f}%")
    add("")

    # 사후층화 K
    pool_pop = sum(by_stratum[c]["pop"] for c in POOLED if c in by_stratum)
    k_hat = sum(by_stratum[c]["k"] * by_stratum[c]["pop"]
                for c in POOLED if c in by_stratum) / pool_pop
    add("[사후층화 추정] 보강 대상 822,306건 기준")
    for c in POOLED:
        if c not in by_stratum:
            continue
        s = by_stratum[c]
        add(f"  {c}  가중 {s['pop']/pool_pop:>5.1%} x K {100*s['k']:>5.1f}%"
            f"  = 기여 {100*s['k']*s['pop']/pool_pop:>5.2f}%p")
    add(f"  -> 통합 K = {100*k_hat:.1f}%")
    add("")

    # 최종 커버리지 전망
    total_cand = 948537
    have_text = 32427
    have_url = 93813
    need = 822306
    add("[L1 후보 948,537건의 최종 텍스트 커버리지 전망]")
    add(f"  국중 본문 보유          {have_text:>9,}  {100*have_text/total_cand:>5.1f}%")
    add(f"  + URL 회수 (API 0회)   {have_url:>9,}  {100*have_url/total_cand:>5.1f}%")
    add(f"  + 카카오 (K={100*k_hat:.1f}%)      {int(need*k_hat):>9,}  "
        f"{100*need*k_hat/total_cand:>5.1f}%")
    add(f"  {'-'*46}")
    total_cov = (have_text + have_url + need * k_hat) / total_cand
    add(f"  합계                  {int(have_text+have_url+need*k_hat):>9,}  "
        f"{100*total_cov:>5.1f}%")
    add("")

    # 품질 점검
    lens = sorted(r["contents_len"] for r in results if r["matched"] and r["contents_len"] > 0)
    if lens:
        add("[contents 길이 분포 (매칭+보유)]")
        add(f"  n={len(lens)} 최소 {lens[0]} / 25% {lens[len(lens)//4]} / "
            f"중앙 {lens[len(lens)//2]} / 75% {lens[3*len(lens)//4]} / 최대 {lens[-1]}")
        short = [x for x in lens if x < USABLE_MIN]
        add(f"  {USABLE_MIN}자 미만(플레이스홀더 의심) {len(short)}건 "
            f"({100*len(short)/len(lens):.1f}%)")
    errors = Counter(r["api_error"] for r in results if r["api_error"])
    if errors:
        add(f"  API 오류: {dict(errors)}")
    add("")
    add("[사례 — 층별 매칭 성공 2건]")
    for code in ["A", "B", "C", "D", "E"]:
        for r in [x for x in results if x["stratum"] == code and x["matched"]][:2]:
            add(f"  {code} {r['isbn13']} 대출{r['loans']:>6} {r['contents_len']:>5}자  "
                f"{(r['kakao_title'] or '')[:34]}")

    path = REPORTS / "data_quality_summary_kakao_pilot.txt"
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))
    print(f"\n생성: {path}")
    print(f"원본: {RAW_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
