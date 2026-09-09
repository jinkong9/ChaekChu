#!/usr/bin/env python3
"""세그먼트(연령×성별) 인기 대출 도서 — 정보나루 loanItemSrch.

홈 링(`popular-ring.json`)과 온보딩 그리드, V1 `book_loaned_top20` 의 원천이다.
프론트 시안의 원천 파일(segment_popular_500.json)이 저장소·로컬 어디에도 없어 다시 만든다 (2026-09-09).

호출: 연령 6구간 × 성별 2 = 12회 (하루 쿼터 29,023 중 12). 창은 직전 3개월.
  age   14(→'10' 14~19세) · 20 · 30 · 40 · 50 · 60      gender  0 남 → 'M' · 1 여 → 'F'
  V1 book_loaned_top20.age_group 은 VARCHAR(2): '10' '20' '30' '40' '50' '60'

출력
  data4library/segment_popular_<YYYYMM>.jsonl   원본 doc 그대로 (세그먼트 필드 포함)
  load/book_loaned_top20.csv                     isbn13,gender,age_group,ranking,loan_count,period  (+ 참고용 bookname, cover_url)

실행:  py scripts/fetch_segment_popular.py [--top 100] [--start 2026-06-01 --end 2026-08-31]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA") or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
API = "https://data4library.kr/api/loanItemSrch"
AGES = [("14", "10"), ("20", "20"), ("30", "30"), ("40", "40"), ("50", "50"), ("60", "60")]
GENDERS = [("0", "M"), ("1", "F")]


def load_key() -> str:
    for line in (BASE / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("정보나루="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(".env 에 정보나루 키가 없다")


def fetch(key: str, age: str, gender: str, start: str, end: str, size: int) -> list[dict]:
    q = urllib.parse.urlencode({"authKey": key, "startDt": start, "endDt": end, "age": age, "gender": gender,
                                "pageNo": 1, "pageSize": size, "format": "json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            resp = data.get("response") or {}
            if "error" in resp:
                raise RuntimeError(resp["error"])
            return [d["doc"] for d in resp.get("docs", []) if "doc" in d]
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f"  재시도 {attempt+1}: {type(e).__name__}", flush=True)
            time.sleep(3)
    return []


def main() -> int:
    ap = argparse.ArgumentParser()
    today = date.today()
    # 직전 3개 완결 월: 오늘이 9월이면 6/1 ~ 8/31
    end_m = today.month - 1 or 12
    end_y = today.year if today.month > 1 else today.year - 1
    import calendar
    default_end = date(end_y, end_m, calendar.monthrange(end_y, end_m)[1])
    sm = end_m - 2 if end_m > 2 else end_m + 10
    sy = end_y if end_m > 2 else end_y - 1
    default_start = date(sy, sm, 1)
    ap.add_argument("--start", default=default_start.isoformat())
    ap.add_argument("--end", default=default_end.isoformat())
    ap.add_argument("--top", type=int, default=100)
    args = ap.parse_args()
    period = args.end[:7].replace("-", "")
    key = load_key()

    raw_path = BASE / "data4library" / f"segment_popular_{period}.jsonl"
    load_dir = BASE / "load"; load_dir.mkdir(exist_ok=True)
    csv_path = load_dir / "book_loaned_top20.csv"

    n_rows = 0
    with raw_path.open("w", encoding="utf-8") as raw, csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")   # LF 고정 — psql \copy 종료 줄과 섞이지 않게
        w.writerow(["isbn13", "gender", "age_group", "ranking", "loan_count", "period", "bookname", "cover_url"])
        for age_param, age_group in AGES:
            for g_param, g in GENDERS:
                docs = fetch(key, age_param, g_param, args.start, args.end, args.top)
                seen = set()
                for d in docs:
                    isbn = "".join(ch for ch in (d.get("isbn13") or "") if ch.isdigit())
                    if len(isbn) != 13 or isbn in seen:
                        continue
                    seen.add(isbn)
                    d["_segment"] = {"age": age_group, "gender": g, "startDt": args.start, "endDt": args.end}
                    raw.write(json.dumps(d, ensure_ascii=False) + "\n")
                    w.writerow([isbn, g, age_group, int(d.get("ranking") or 0), int(d.get("loan_count") or 0), period,
                                (d.get("bookname") or "").strip(), (d.get("bookImageURL") or "").strip()])
                    n_rows += 1
                print(f"  {age_group}대 {g}: {len(docs):>3}건  1위 「{(docs[0].get('bookname') if docs else '-')[:30]}」", flush=True)
                time.sleep(0.5)
    print(f"\n{n_rows} 행 → {csv_path}\n원본 → {raw_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
