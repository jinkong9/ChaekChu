#!/usr/bin/env python3
"""[파일럿] 정보나루 API 의 보강 능력 측정 — description / 키워드 / 협업필터링.

카카오 파일럿(K=50.9%)에서 남은 약점 구간을 정보나루가 메우는지 본다.
  A ~2006      카카오 K 22.7%  <- 최대 약점
  D 정보나루전용  카카오 K 28.0%
카카오와 **동일 표본**을 써서 직접 비교와 합집합 계산이 가능하게 한다.

측정 엔드포인트
  srchDtlList  isbn13 -> description + 대출 통계(loanInfo)   1호출로 텍스트+수요
  keywordList  isbn13 -> 가중 키워드 (임베딩 입력, 노이즈 없음)
  usageAnalysisList isbn13 -> 함께 대출된 도서 (item-item CF)

지표
  매칭률 / description 보유율 / 사용가능(>=100자) / K(무조건부)
  키워드 보유율·개수 / CF(함께대출) 보유율·개수
  카카오 대비: 단독 우위, 합집합 K

실행:
    py scripts/pilot_data4library_coverage.py --per 120
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\data4library")
ENV = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\.env")
REPORTS = ROOT / "reports"
KAKAO_RAW = DATA / "kakao_pilot_raw.jsonl"
RAW_OUT = DATA / "data4library_pilot_raw.jsonl"

BASE = "http://data4library.kr/api/"
USABLE_MIN = 100
STRATUM_POP = {"A": 146109, "B": 225178, "C": 215668, "D": 329200}
POOLED = ["A", "B", "C", "D"]


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
        if name.strip() in ("정보나루", "DATA4LIBRARY", "DATA4LIBRARY_AUTH_KEY"):
            return value.strip().strip("\"'")
    raise SystemExit("정보나루 키를 .env 에서 찾지 못했습니다.")


def call(key: str, endpoint: str, params: dict, retries: int = 3) -> dict:
    params = {**params, "authKey": key, "format": "json"}
    url = BASE + endpoint + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "b102-d4l-pilot/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except HTTPError as error:
            if error.code in (429, 500, 502, 503):
                time.sleep(2 ** attempt)
                continue
            return {"__http__": error.code}
        except (URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(1 + attempt)
    return {"__error__": "retries-exhausted"}


def extract_detail(payload: dict) -> tuple[dict, int]:
    """(book dict, 전체 대출건수) — 없으면 ({}, 0)"""
    r = payload.get("response", {})
    if r.get("error"):
        return {}, 0
    detail = r.get("detail") or []
    book = detail[0].get("book", {}) if detail else {}
    # loanInfo 는 케이스마다 형태가 다르다(dict / str / 중첩). 방어적으로 판다.
    loan_total = 0
    info = r.get("loanInfo")
    if isinstance(info, list):
        for entry in info:
            if not isinstance(entry, dict):
                continue
            total = entry.get("Total")
            if isinstance(total, dict):
                try:
                    loan_total = int(total.get("loanCnt") or 0)
                except (TypeError, ValueError):
                    loan_total = 0
    return book, loan_total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per", type=int, default=120,
                        help="층당 표본 수 (카카오 파일럿 표본에서 앞에서부터)")
    parser.add_argument("--sleep", type=float, default=0.1)
    parser.add_argument("--skip-cf", action="store_true",
                        help="usageAnalysisList 생략 (호출 수 절감)")
    args = parser.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)
    key = load_key()

    # 카카오와 동일 표본을 쓴다 (직접 비교·합집합 계산 가능)
    kakao = [json.loads(l) for l in
             KAKAO_RAW.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_stratum: dict[str, list] = {}
    for row in kakao:
        by_stratum.setdefault(row["stratum"], []).append(row)
    targets = []
    for code in ["A", "B", "C", "D", "E"]:
        targets.extend(by_stratum.get(code, [])[:args.per])
    print(f"표본 {len(targets)}건 (카카오 파일럿과 동일 ISBN, 층당 {args.per})", flush=True)

    results = []
    started = time.time()
    calls = 0
    with RAW_OUT.open("w", encoding="utf-8") as sink:
        for index, row in enumerate(targets, start=1):
            isbn = row["isbn13"]
            detail_payload = call(key, "srchDtlList", {"isbn13": isbn, "loaninfoYN": "Y"})
            calls += 1
            book, loan_total = extract_detail(detail_payload)
            description = (book.get("description") or "").strip()

            kw_payload = call(key, "keywordList", {"isbn13": isbn, "additionalYN": "Y"})
            calls += 1
            kw_items = (kw_payload.get("response", {}) or {}).get("items") or []
            keywords = [(i.get("item", {}).get("word"), i.get("item", {}).get("weight"))
                        for i in kw_items]

            co_count = 0
            if not args.skip_cf:
                cf_payload = call(key, "usageAnalysisList", {"isbn13": isbn})
                calls += 1
                cf = (cf_payload.get("response", {}) or {})
                co_count = len(cf.get("coLoanBooks") or [])
            record = {
                "stratum": row["stratum"], "isbn13": isbn, "loans": row["loans"],
                "pub_year": row.get("pub_year"),
                "kakao_matched": row["matched"],
                "kakao_len": row["contents_len"],
                "d4l_matched": bool(book),
                "d4l_desc_len": len(description),
                "d4l_bookname": book.get("bookname"),
                "d4l_class_no": book.get("class_no"),
                "d4l_loan_total": loan_total,
                "kw_count": len(keywords),
                "kw_top": keywords[:8],
                "co_loan_count": co_count,
                "description": description[:500],
            }
            results.append(record)
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            if index % 100 == 0:
                print(f"  {index}/{len(targets)}  호출 {calls}  "
                      f"({time.time()-started:.0f}초)", flush=True)
            if args.sleep:
                time.sleep(args.sleep)

    # ---------- 집계 ----------
    out: list[str] = []
    add = out.append
    add("정보나루 API 보강 파일럿 — description / 키워드 / 협업필터링")
    add("=" * 92)
    add(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    add(f"표본 {len(results)}건 (카카오 파일럿과 동일 ISBN) / API 호출 {calls}회")
    add(f"사용가능 기준: description >= {USABLE_MIN}자")
    add("")
    add(f"  {'층':<4}{'n':>5}{'매칭':>7}{'소개보유':>9}{'사용가능':>9}{'K':>8}"
        f"{'키워드보유':>10}{'평균개수':>9}{'함께대출':>9}")
    add("  " + "-" * 78)

    stats: dict[str, dict] = {}
    for code in ["A", "B", "C", "D", "E"]:
        group = [r for r in results if r["stratum"] == code]
        if not group:
            continue
        n = len(group)
        matched = [r for r in group if r["d4l_matched"]]
        usable = [r for r in group if r["d4l_desc_len"] >= USABLE_MIN]
        any_d = [r for r in matched if r["d4l_desc_len"] > 0]
        kw = [r for r in group if r["kw_count"] > 0]
        cf = [r for r in group if r["co_loan_count"] > 0]
        k = len(usable) / n
        stats[code] = {"n": n, "k": k, "matched": len(matched),
                       "kw": len(kw) / n, "cf": len(cf) / n,
                       "kw_avg": sum(r["kw_count"] for r in kw) / max(len(kw), 1)}
        add(f"  {code:<4}{n:>5}{len(matched):>7}"
            f"{100*len(any_d)/max(len(matched),1):>8.1f}%"
            f"{100*len(usable)/max(len(matched),1):>8.1f}%{100*k:>7.1f}%"
            f"{100*len(kw)/n:>9.1f}%{stats[code]['kw_avg']:>8.1f}"
            f"{100*len(cf)/n:>8.1f}%")
    add("")

    pool = sum(STRATUM_POP[c] for c in POOLED if c in stats)
    k_hat = sum(stats[c]["k"] * STRATUM_POP[c] for c in POOLED if c in stats) / pool
    kw_hat = sum(stats[c]["kw"] * STRATUM_POP[c] for c in POOLED if c in stats) / pool
    add(f"[사후층화] 정보나루 단독 K = {100*k_hat:.1f}%  /  키워드 보유 = {100*kw_hat:.1f}%")
    add("")

    # 카카오 대비 / 합집합
    add("[카카오 대비 — 동일 표본 직접 비교]")
    add(f"  {'층':<4}{'카카오K':>9}{'정보나루K':>10}{'합집합K':>9}"
        f"{'정보나루 단독기여':>16}")
    add("  " + "-" * 50)
    union_by: dict[str, float] = {}
    for code in ["A", "B", "C", "D", "E"]:
        group = [r for r in results if r["stratum"] == code]
        if not group:
            continue
        n = len(group)
        kk = sum(1 for r in group if r["kakao_len"] >= USABLE_MIN) / n
        dd = sum(1 for r in group if r["d4l_desc_len"] >= USABLE_MIN) / n
        uu = sum(1 for r in group
                 if r["kakao_len"] >= USABLE_MIN or r["d4l_desc_len"] >= USABLE_MIN) / n
        only = sum(1 for r in group
                   if r["d4l_desc_len"] >= USABLE_MIN and r["kakao_len"] < USABLE_MIN) / n
        union_by[code] = uu
        add(f"  {code:<4}{100*kk:>8.1f}%{100*dd:>9.1f}%{100*uu:>8.1f}%{100*only:>15.1f}%p")
    union_hat = sum(union_by[c] * STRATUM_POP[c] for c in POOLED if c in union_by) / pool
    add(f"  -> 사후층화 합집합 K = {100*union_hat:.1f}%")
    add("")

    total, have_text, have_url, need = 948537, 32427, 93813, 822306
    cov = (have_text + have_url + need * union_hat) / total
    add("[L1 후보 948,537건 최종 텍스트 커버리지 전망 (카카오 ∪ 정보나루)]")
    add(f"  국중 본문 {have_text:,} + URL회수 {have_url:,} "
        f"+ 외부보강 {int(need*union_hat):,}")
    add(f"  = {int(have_text+have_url+need*union_hat):,}건  ({100*cov:.1f}%)")
    add("")

    lens = sorted(r["d4l_desc_len"] for r in results if r["d4l_desc_len"] > 0)
    if lens:
        add("[정보나루 description 길이 분포]")
        add(f"  n={len(lens)} 최소 {lens[0]} / 중앙 {lens[len(lens)//2]} / "
            f"75% {lens[3*len(lens)//4]} / 최대 {lens[-1]}")
        kl = sorted(r["kakao_len"] for r in results if r["kakao_len"] > 0)
        if kl:
            add(f"  (카카오 비교: 중앙 {kl[len(kl)//2]} / 최대 {kl[-1]} — 250자 절단)")
    add("")
    add("[키워드 사례]")
    for r in [x for x in results if x["kw_count"] > 0][:5]:
        words = ", ".join(f"{w}({g})" for w, g in r["kw_top"][:6])
        add(f"  {r['isbn13']} kw{r['kw_count']:>3}  {words}")

    path = REPORTS / "data_quality_summary_data4library_pilot.txt"
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))
    print(f"\n생성: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
