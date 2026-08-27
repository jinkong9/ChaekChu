#!/usr/bin/env python3
"""정보나루 파일럿 v2 — IP 등록 확인 + 남은 층 측정을 동시에.

IP 등록 여부는 500건을 넘겨봐야 알 수 있다. 어차피 쿼터를 쓸 것이므로
가치 높은 층부터 처리하면서 차단 시점을 기록한다.

층 우선순위 (모집단 x 카카오 약점 순)
  D  정보나루 전용 329,200  카카오 K 28.0%  <- 최우선
  C  2015+       215,668  카카오 K 90.0%
  B  2007-14     225,178  카카오 K 65.3%
  E  대출 상위     (교차)   카카오 K 90.7%

A층은 이미 측정 완료(K=64.7%, n=102).

차단 감지: '500건 이상' 에러가 나오면 그 시점 호출 수를 기록하고 즉시 중단한다.
  - 500 근처에서 차단 -> IP 미등록
  - 500 넘겨서 계속 -> IP 등록 적용됨
"""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DATA = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\data4library")
ENV = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\.env")
KAKAO_RAW = DATA / "kakao_pilot_raw.jsonl"
OUT = DATA / "d4l_pilot_v2.jsonl"
BASE = "http://data4library.kr/api/"
WORKERS = 8            # 차단 시점을 정확히 보려면 과도한 동시성은 피한다
PER = 120
USABLE_MIN = 100
ORDER = ["D", "C", "B", "E"]
STRATUM_POP = {"A": 146109, "B": 225178, "C": 215668, "D": 329200}

lock = threading.Lock()
state = {"calls": 0, "blocked_at": None, "stop": False}


def load_key() -> str:
    raw = ENV.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949", "replace")
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("정보나루") and "=" in line:
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("정보나루 키 없음")


def call(key: str, endpoint: str, params: dict) -> dict:
    if state["stop"]:
        return {"__skip__": True}
    params = {**params, "authKey": key, "format": "json"}
    url = BASE + endpoint + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "b102-d4l/2.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
            with lock:
                state["calls"] += 1
                n = state["calls"]
            error = (payload.get("response", {}) or {}).get("error") or ""
            if "500건" in error or "IP" in error:
                with lock:
                    if state["blocked_at"] is None:
                        state["blocked_at"] = n
                        print(f"\n  *** 차단 발생: 누적 {n}호출 째 — \"{error}\"", flush=True)
                    state["stop"] = True
                return {"__blocked__": True}
            return payload
        except HTTPError as error:
            if error.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(1 + attempt)
                continue
            return {"__http__": error.code}
        except (URLError, TimeoutError, json.JSONDecodeError):
            if attempt < 2:
                time.sleep(1 + attempt)
    return {"__error__": "exhausted"}


def probe(key: str, row: dict) -> dict | None:
    if state["stop"]:
        return None
    isbn = row["isbn13"]
    detail = call(key, "srchDtlList", {"isbn13": isbn, "loaninfoYN": "N"})
    if detail.get("__blocked__") or detail.get("__skip__"):
        return None
    books = ((detail.get("response", {}) or {}).get("detail")) or []
    book = books[0].get("book", {}) if books else {}
    description = (book.get("description") or "").strip()

    keywords: list = []
    if not state["stop"]:
        kw = call(key, "keywordList", {"isbn13": isbn, "additionalYN": "Y"})
        if not (kw.get("__blocked__") or kw.get("__skip__")):
            items = ((kw.get("response", {}) or {}).get("items")) or []
            keywords = [(i.get("item", {}).get("word"), i.get("item", {}).get("weight"))
                        for i in items]
    return {
        "stratum": row["stratum"], "isbn13": isbn, "loans": row["loans"],
        "pub_year": row.get("pub_year"),
        "kakao_len": row["contents_len"], "kakao_matched": row["matched"],
        "d4l_matched": bool(book), "d4l_desc_len": len(description),
        "d4l_bookname": book.get("bookname"),
        "kw_count": len(keywords), "kw_top": keywords[:8],
        "description": description[:400],
    }


def main() -> int:
    key = load_key()
    rows = [json.loads(l) for l in KAKAO_RAW.read_text(encoding="utf-8").splitlines() if l.strip()]
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r["stratum"], []).append(r)

    targets = []
    for code in ORDER:
        targets.extend(by.get(code, [])[:PER])
    print(f"대상 {len(targets)}건 (순서 {'->'.join(ORDER)}, 층당 {PER})")
    print(f"ISBN 당 2호출 -> 최대 {len(targets)*2}호출 예정")
    print(f"IP 미등록이면 500호출 근처에서 차단될 것\n", flush=True)

    started = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = [r for r in pool.map(lambda r: probe(key, r), targets) if r]
    elapsed = time.time() - started

    with OUT.open("w", encoding="utf-8") as sink:
        for r in results:
            sink.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\n수집 {len(results)}건 / 호출 {state['calls']} / {elapsed:.0f}초")
    if state["blocked_at"]:
        verdict = ("IP 미등록 (또는 미반영)" if state["blocked_at"] < 700
                   else f"IP 등록 적용됨 — 상한이 {state['blocked_at']}건 근처")
        print(f"차단 시점: {state['blocked_at']}호출  ->  판정: {verdict}")
    else:
        print(f"차단 없음 — {state['calls']}호출 완주. IP 등록 적용된 것으로 보임")

    print(f"\n{'층':<4}{'n':>5}{'매칭':>7}{'D4L K':>8}{'카카오K':>9}{'합집합':>8}"
          f"{'D4L단독':>9}{'키워드':>8}")
    print("-" * 60)
    union_by, k_by = {}, {}
    # A층 기존 결과 병합
    prior = DATA / "data4library_pilot_raw.jsonl"
    if prior.exists():
        for line in prior.read_text(encoding="utf-8").splitlines():
            if line.strip():
                results.append(json.loads(line))
    for code in ["A"] + ORDER:
        g = [r for r in results if r["stratum"] == code]
        if len(g) < 20:
            if g:
                print(f"{code:<4}{len(g):>5}  (표본 부족 — 차단으로 중단)")
            continue
        n = len(g)
        matched = sum(1 for r in g if r["d4l_matched"])
        dk = sum(1 for r in g if r["d4l_desc_len"] >= USABLE_MIN) / n
        kk = sum(1 for r in g if r["kakao_len"] >= USABLE_MIN) / n
        un = sum(1 for r in g if r["kakao_len"] >= USABLE_MIN
                 or r["d4l_desc_len"] >= USABLE_MIN) / n
        only = sum(1 for r in g if r["d4l_desc_len"] >= USABLE_MIN
                   and r["kakao_len"] < USABLE_MIN) / n
        kw = sum(1 for r in g if r["kw_count"] > 0) / n
        union_by[code], k_by[code] = un, dk
        print(f"{code:<4}{n:>5}{100*matched/n:>6.0f}%{100*dk:>7.1f}%{100*kk:>8.1f}%"
              f"{100*un:>7.1f}%{100*only:>8.1f}%p{100*kw:>7.1f}%")

    have = [c for c in STRATUM_POP if c in union_by]
    if have:
        pop = sum(STRATUM_POP[c] for c in have)
        uh = sum(union_by[c] * STRATUM_POP[c] for c in have) / pop
        dh = sum(k_by[c] * STRATUM_POP[c] for c in have) / pop
        print(f"\n측정된 층({','.join(have)}) 기준 — 정보나루 K {100*dh:.1f}% / "
              f"카카오∪정보나루 {100*uh:.1f}%")
        if len(have) == 4:
            total, text_have, need = 948537, 102939, 845598
            cov = (text_have + need * uh) / total
            print(f"L1 후보 최종 커버리지 전망: {int(text_have+need*uh):,}건 ({100*cov:.1f}%)")
        else:
            print(f"(전체 4개 층 중 {len(have)}개만 측정 — 최종 전망은 보류)")
    print(f"저장: {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
