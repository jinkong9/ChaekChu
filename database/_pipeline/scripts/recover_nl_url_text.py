#!/usr/bin/env python3
"""국중 텍스트 URL 회수 — BOOK_INTRODUCTION_URL 등의 .txt 파일을 받아 본문으로 만든다.

배경
  국중은 책소개를 본문 필드(BOOK_INTRODUCTION)에 넣거나 URL만 주거나 둘 중 하나다.
  둘은 상호 배타적이다(99.9% 실측). 지금까지의 '텍스트 보유 6.95%'는 본문 필드만
  센 값이라, URL 만 있는 레코드는 텍스트가 있는데도 없다고 세고 있었다.

  URL 은 nl.go.kr 정적 파일이라 **API 쿼터와 무관**하다. 카카오·정보나루가 막혀도 돈다.

대상 (국중 전수, 본문 미보유 레코드)
  책소개URL  .txt 93,487  (.jpg 21,634 은 OCR 필요 — 이번 범위 밖)
  목차URL    .txt 90,899  (.jpg 13,305)
  요약URL    .txt 22,766  (.jpg  4,062)

산출
  nl_url_text.csv   isbn13, field, url, chars, text   (증분 저장, 재개 가능)

실행
    py scripts/recover_nl_url_text.py                    # 전체
    py scripts/recover_nl_url_text.py --fields intro     # 책소개만
    py scripts/recover_nl_url_text.py --limit 1000       # 시험
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError

import duckdb

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

NL = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books_derived.parquet")
OUT = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_url_text.csv")
WORKERS = 10          # 실측 포화 지점 (분당 ~1,900건). 공공 서버라 더 올리지 않는다.
MIN_CHARS = 20        # 이 미만은 회수 실패로 간주
MAX_CHARS = 100_000   # 책소개/목차가 이보다 길면 비정상(전문 스캔 등). 잘라서 저장한다
FIELDS = {"intro": "intro_url", "toc": "toc_url", "summary": "summary_url"}

lock = threading.Lock()
csv.field_size_limit(50_000_000)  # 회수 텍스트에 10MB 초과 사례 존재


def clean(raw: bytes) -> str:
    """인코딩 자동 판별 후 공백 정리.

    국중 파일은 utf-8/cp949 가 주류지만 UTF-16 등 제3의 인코딩도 섞여 있다.
    실측: 무판별 fallback 을 쓰면 1.0% 행에 대체문자(U+FFFD)가 박힌다.
    판별에 실패하면 빈 문자열을 돌려 회수 실패로 처리한다 — 깨진 텍스트를
    임베딩에 넣는 것보다 없는 편이 낫다.
    """
    # BOM 이 있으면 그것을 우선 신뢰한다
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        candidates = ("utf-16", "utf-32")
    else:
        candidates = ("utf-8-sig", "utf-8", "cp949", "utf-16")
    for encoding in candidates:
        try:
            text = raw.decode(encoding)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        return ""
    # 판별에 성공해도 대체문자가 많으면 잘못 읽은 것이다
    if text.count("\ufffd") > len(text) * 0.02:
        return ""
    # HTML 오류 페이지가 돌아오는 경우가 있어 걸러낸다
    if re.search(r"<html|<!DOCTYPE", text[:400], re.I):
        return ""
    text = " ".join(text.split())
    # 실측: 1,960만 자(19MB) 짜리 파일이 존재한다. 책소개가 아니라 본문 전문으로 보인다.
    # 임베딩 입력으로 쓸 수 없고 CSV 필드 상한도 넘기므로 잘라 둔다.
    return text[:MAX_CHARS]


def fetch(url: str, retries: int = 2) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return clean(response.read())
        except HTTPError as error:
            if error.code in (500, 502, 503) and attempt < retries:
                time.sleep(1 + attempt)
                continue
            return ""
        except (URLError, TimeoutError):
            if attempt < retries:
                time.sleep(1 + attempt)
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fields", default="intro,toc,summary",
                        help="회수할 필드 (intro/toc/summary, 콤마 구분)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args()

    con = duckdb.connect()
    con.execute("SET memory_limit='4GB'")

    # 재개: 이미 회수한 (isbn13, field) 는 건너뛴다
    done: set[tuple[str, str]] = set()
    if OUT.exists():
        with OUT.open("r", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                done.add((row["isbn13"], row["field"]))
        print(f"기존 회수 {len(done):,}건 — 재개 모드", flush=True)

    targets: list[tuple[str, str, str]] = []
    for name in [f.strip() for f in args.fields.split(",") if f.strip()]:
        column = FIELDS.get(name)
        if not column:
            continue
        rows = con.execute(f"""
            SELECT isbn13_norm, '{name}', {column} FROM '{NL.as_posix()}'
            WHERE isbn13_norm IS NOT NULL AND NOT has_usable_text
              AND {column} LIKE '%.txt'
        """).fetchall()
        targets.extend(r for r in rows if (r[0], r[1]) not in done)
    if args.limit:
        targets = targets[:args.limit]
    print(f"회수 대상 {len(targets):,}건 (동시성 {args.workers})", flush=True)
    if not targets:
        print("대상 없음")
        return 0

    new_file = not OUT.exists()
    sink = OUT.open("a", encoding="utf-8", newline="")
    writer = csv.writer(sink)
    if new_file:
        writer.writerow(["isbn13", "field", "url", "chars", "text"])

    counters = {"ok": 0, "empty": 0, "done": 0}
    started = time.time()

    def work(item: tuple[str, str, str]) -> None:
        isbn, field, url = item
        text = fetch(url)
        with lock:
            counters["done"] += 1
            if len(text) >= MIN_CHARS:
                counters["ok"] += 1
                writer.writerow([isbn, field, url, len(text), text])
            else:
                counters["empty"] += 1
            n = counters["done"]
            if n % 5000 == 0:
                sink.flush()
                elapsed = time.time() - started
                rate = n / elapsed * 60
                remain = (len(targets) - n) / rate if rate else 0
                print(f"  {n:,}/{len(targets):,}  성공 {counters['ok']:,}  "
                      f"{rate:,.0f}건/분  남은 {remain:.0f}분", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(work, targets))
    sink.close()

    elapsed = time.time() - started
    print("")
    print("=== 회수 완료 ===")
    print(f"  시도      {counters['done']:,}건  ({elapsed/60:.1f}분)")
    print(f"  성공      {counters['ok']:,}건  ({100*counters['ok']/max(counters['done'],1):.1f}%)")
    print(f"  실패/빈값  {counters['empty']:,}건")
    print(f"  출력      {OUT}  ({OUT.stat().st_size/1024/1024:.1f} MB)")

    stats = con.execute(f"""
        SELECT field, count(*), median(CAST(chars AS INT)), max(CAST(chars AS INT))
        FROM read_csv('{OUT.as_posix()}', header=true,
                      columns={{'isbn13':'VARCHAR','field':'VARCHAR','url':'VARCHAR',
                                'chars':'VARCHAR','text':'VARCHAR'}})
        GROUP BY field ORDER BY 2 DESC
    """).fetchall()
    print("\n  필드별 회수 결과 (누적):")
    for field, count, med, mx in stats:
        print(f"    {field:<10}{count:>9,}건  중앙 {int(med):>6,}자  최대 {int(mx):,}자")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
