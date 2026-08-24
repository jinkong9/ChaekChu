#!/usr/bin/env python3
"""Use the remaining Kakao Book Search daily quota for a resumable catalog crawl.

Kakao provides a search API, not a catalog-export API.  This collector therefore
uses a broad, deterministic Korean title-query plan and preserves every response.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://dapi.kakao.com/v3/search/book"
BOOK_FIELDS = (
    "title", "contents", "url", "isbn", "datetime", "authors", "publisher",
    "translators", "price", "sale_price", "thumbnail", "status",
)
HANGUL_BASE = 0xAC00
CHOSUNG = 19
JUNGSUNG = 21
JONGSUNG = (0, 1, 4, 8, 16, 17, 19, 21)  # no-final plus frequent final-consonant variants


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="카카오 도서 검색 일일 쿼터 수집기")
    parser.add_argument("--max-requests", type=int, default=29999,
                        help="이번 배치에서 사용할 최대 HTTP 요청 수. 기본 29,999")
    parser.add_argument("--page-size", type=int, default=50, choices=range(1, 51), metavar="1..50")
    parser.add_argument("--part-size", type=int, default=1000, help="Raw 파트 하나의 최대 요청 수")
    parser.add_argument("--delay", type=float, default=0.10, help="성공 요청 사이 대기 초")
    parser.add_argument("--retries", type=int, default=5, help="일시 오류 재시도 횟수")
    parser.add_argument("--output-dir", type=Path, default=root)
    parser.add_argument("--reset", action="store_true", help="기존 미완료 실행 상태를 지우고 새로 시작")
    return parser.parse_args()


def generated_title_queries() -> Iterator[str]:
    """Interleave initial consonant/vowel/final variants for broad title coverage."""
    for final in JONGSUNG:
        for medial in range(JUNGSUNG):
            for initial in range(CHOSUNG):
                yield chr(HANGUL_BASE + ((initial * JUNGSUNG + medial) * 28) + final)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def isbn10_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", value):
        return False
    total = sum((10 - index) * int(char) for index, char in enumerate(value[:9]))
    total += 10 if value[-1] == "X" else int(value[-1])
    return total % 11 == 0


def isbn13_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{13}", value):
        return False
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(value[:12]))
    return (10 - total % 10) % 10 == int(value[-1])


def isbn10_to_13(value: str) -> str | None:
    if not isbn10_is_valid(value):
        return None
    prefix = "978" + value[:9]
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(prefix))
    return prefix + str((10 - total % 10) % 10)


def parse_isbn(value: Any) -> tuple[str | None, str | None, bool, str]:
    isbn10 = isbn13 = None
    valid = False
    for token in str(value or "").split():
        candidate = re.sub(r"[^0-9Xx]", "", token).upper()
        if len(candidate) == 13 and isbn13_is_valid(candidate):
            isbn13, valid = candidate, True
        elif len(candidate) == 10 and isbn10_is_valid(candidate):
            isbn10, valid = candidate, True
    if isbn13 and isbn10:
        kind = "BOTH"
    elif isbn13:
        kind = "ISBN13"
    elif isbn10:
        kind = "ISBN10"
    else:
        kind = "INVALID_OR_MISSING"
    return isbn10, isbn13 or (isbn10_to_13(isbn10) if isbn10 else None), valid, kind


def normalize(document: dict[str, Any], query: str, collected_at: str) -> dict[str, Any]:
    isbn10, isbn13, isbn_valid, isbn_type = parse_isbn(document.get("isbn"))
    record = {field: document.get(field) for field in BOOK_FIELDS}
    record.update({
        "isbn_raw": document.get("isbn") or "",
        "isbn10": isbn10,
        "isbn13": isbn13,
        "isbn13_normalized": isbn13,
        "isbn_valid": isbn_valid,
        "isbn_type": isbn_type,
        "source": "kakao_book_search",
        "source_query": query,
        "collected_at": collected_at,
    })
    for field in ("authors", "translators"):
        record[field] = record[field] or []
    for field in ("price", "sale_price"):
        record[field] = record[field] if record[field] is not None else None
    for field in ("title", "contents", "url", "isbn", "datetime", "publisher", "thumbnail", "status"):
        record[field] = record[field] or ""
    return record


def dedupe_key(record: dict[str, Any]) -> str:
    if record["isbn13"]:
        return f"isbn13:{record['isbn13']}"
    return "fallback:" + "|".join((
        record["title"].strip(), ",".join(record["authors"]), record["publisher"].strip(), record["datetime"],
    ))


def open_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("CREATE TABLE IF NOT EXISTS books (dedupe_key TEXT PRIMARY KEY, payload TEXT NOT NULL)")
    return connection


def api_request(api_key: str, query: str, page: int, page_size: int) -> dict[str, Any]:
    params = urlencode({"query": query, "target": "title", "sort": "accuracy", "page": page, "size": page_size})
    request = Request(
        f"{API_URL}?{params}", headers={"Authorization": f"KakaoAK {api_key}"}, method="GET"
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def load_state(path: Path, reset: bool) -> dict[str, Any]:
    if reset or not path.exists():
        return {"query_index": 0, "page": 1, "request_count": 0, "raw_records": 0, "started_at": utc_now()}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[3]
    load_dotenv(project_root / ".env")
    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not api_key:
        print("KAKAO_REST_API_KEY가 .env 또는 환경 변수에 필요합니다.", file=sys.stderr)
        return 2

    output = args.output_dir.resolve()
    for directory in ("raw/parts", "processed", "samples", "reports", "metadata"):
        (output / directory).mkdir(parents=True, exist_ok=True)
    state_path = output / "metadata" / "quota_crawl.runtime.json"
    state = load_state(state_path, args.reset)
    database_path = output / "metadata" / "quota_dedupe.sqlite3"
    database = open_database(database_path)
    queries = list(generated_title_queries())
    stamp = datetime.now().strftime("%Y%m%d")
    run_plan = {
        "created_at": utc_now(), "api": "Kakao Book Search", "endpoint": API_URL,
        "strategy": "generated Korean syllable title queries; each query paged until is_end or page 50",
        "target": "title", "sort": "accuracy", "page_size": args.page_size,
        "max_requests_this_batch": args.max_requests,
        "previous_confirmed_request_count_today": 1,
        "daily_quota_target_total": 30000,
        "query_generation": {"initial_consonants": CHOSUNG, "medial_vowels": JUNGSUNG, "final_variants": list(JONGSUNG)},
    }
    write_json(output / "metadata" / "range_plan.json", run_plan)
    unresolved: list[dict[str, Any]] = []
    query_counts: list[dict[str, Any]] = []
    part_number = state["request_count"] // args.part_size + 1
    part_requests = state["request_count"] % args.part_size
    part_path = output / "raw" / "parts" / f"books_raw_part_{part_number:05d}.jsonl"
    raw_handle = part_path.open("a", encoding="utf-8")

    def persist_state() -> None:
        state["updated_at"] = utc_now()
        write_json(state_path, state)

    try:
        while state["request_count"] < args.max_requests and state["query_index"] < len(queries):
            query = queries[state["query_index"]]
            page = state["page"]
            if page > 50:
                state["query_index"] += 1
                state["page"] = 1
                continue
            payload: dict[str, Any] | None = None
            last_error: str | None = None
            for attempt in range(args.retries + 1):
                if state["request_count"] >= args.max_requests:
                    break
                state["request_count"] += 1  # every network attempt consumes a quota request
                try:
                    payload = api_request(api_key, query, page, args.page_size)
                    break
                except HTTPError as error:
                    last_error = f"HTTP {error.code}: {error.reason}"
                    if error.code == 429:
                        unresolved.append({"query": query, "page": page, "error": last_error, "attempts": attempt + 1})
                        persist_state()
                        print("카카오 쿼터/요청 제한(429)을 받아 수집을 중단합니다.", file=sys.stderr)
                        return 3
                except (URLError, TimeoutError, json.JSONDecodeError) as error:
                    last_error = str(error)
                if attempt < args.retries:
                    time.sleep(min(2 ** attempt, 16))
            if payload is None:
                unresolved.append({"query": query, "page": page, "error": last_error, "attempts": args.retries + 1})
                state["query_index"] += 1
                state["page"] = 1
                persist_state()
                continue

            collected_at = utc_now()
            raw_handle.write(json.dumps({
                "collected_at": collected_at,
                "request": {"query": query, "target": "title", "sort": "accuracy", "page": page, "size": args.page_size},
                "response": payload,
            }, ensure_ascii=False) + "\n")
            documents = payload.get("documents", [])
            state["raw_records"] += len(documents)
            for document in documents:
                record = normalize(document, query, collected_at)
                database.execute("INSERT OR IGNORE INTO books(dedupe_key, payload) VALUES (?, ?)",
                                 (dedupe_key(record), json.dumps(record, ensure_ascii=False)))
            database.commit()
            part_requests += 1
            if state["request_count"] % 50 == 0:
                print(f"requests={state['request_count']:,} raw={state['raw_records']:,} unique={database.execute('SELECT COUNT(*) FROM books').fetchone()[0]:,}", flush=True)
                persist_state()
            if part_requests >= args.part_size:
                raw_handle.close()
                write_json(part_path.with_suffix(".done.json"), {
                    "completed_at": utc_now(), "request_count": state["request_count"], "raw_records": state["raw_records"],
                })
                part_number += 1
                part_requests = 0
                part_path = output / "raw" / "parts" / f"books_raw_part_{part_number:05d}.jsonl"
                raw_handle = part_path.open("a", encoding="utf-8")
            if payload.get("meta", {}).get("is_end", True):
                query_counts.append({"query": query, "pages": page, "total_count": payload.get("meta", {}).get("total_count", 0)})
                state["query_index"] += 1
                state["page"] = 1
            else:
                state["page"] += 1
            persist_state()
            time.sleep(args.delay)
    finally:
        raw_handle.close()
        database.commit()

    unique_count = database.execute("SELECT COUNT(*) FROM books").fetchone()[0]
    processed_path = output / "processed" / f"books_normalized_quota_{stamp}.jsonl"
    samples: list[dict[str, Any]] = []
    missing = {field: 0 for field in BOOK_FIELDS + ("isbn10", "isbn13", "isbn13_normalized")}
    with processed_path.open("w", encoding="utf-8") as processed:
        for (payload,) in database.execute("SELECT payload FROM books ORDER BY dedupe_key"):
            record = json.loads(payload)
            processed.write(json.dumps(record, ensure_ascii=False) + "\n")
            if len(samples) < 10:
                samples.append(record)
            for field in missing:
                if record.get(field) in (None, "", []):
                    missing[field] += 1
    with (output / "samples" / "sample_books.jsonl").open("w", encoding="utf-8") as sample_file:
        for record in samples:
            sample_file.write(json.dumps(record, ensure_ascii=False) + "\n")
    write_json(output / "samples" / "sample_books.pretty.json", samples)
    with (output / "reports" / "missing_report_quota_crawl.csv").open("w", newline="", encoding="utf-8-sig") as report:
        writer = csv.writer(report)
        writer.writerow(["field", "missing_count", "total_count", "missing_rate"])
        for field, count in missing.items():
            writer.writerow([field, count, unique_count, f"{(count / unique_count * 100) if unique_count else 0:.2f}%"])
    write_json(output / "metadata" / "range_count_cache.json", query_counts)
    write_json(output / "metadata" / "unresolved_ranges.json", unresolved)
    (output / "reports" / "data_quality_summary_quota_crawl.txt").write_text(
        "카카오 도서 검색 일일 쿼터 수집 품질 요약\n"
        + "=" * 62 + "\n"
        + f"완료 시각(UTC): {utc_now()}\n"
        + f"이번 배치 API 요청 수: {state['request_count']:,}\n"
        + "당일 기존 검증 호출 수: 1\n"
        + f"당일 합산 목표 호출 수: {state['request_count'] + 1:,}\n"
        + f"원본 도서 레코드 수: {state['raw_records']:,}\n"
        + f"ISBN/서지 기준 중복 제거 후: {unique_count:,}\n"
        + f"중복 제거 수: {state['raw_records'] - unique_count:,}\n"
        + f"미해결 요청 수: {len(unresolved):,}\n",
        encoding="utf-8",
    )
    database.close()
    state_path.unlink(missing_ok=True)
    print(f"complete requests={state['request_count']:,} raw={state['raw_records']:,} unique={unique_count:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
