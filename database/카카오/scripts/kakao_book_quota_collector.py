#!/usr/bin/env python3
"""Resumable title-query crawl using the shared Kakao book data contract."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from kakao_book_common import (
    merge_normalize_and_report,
    raw_book,
    utc_now,
    write_json,
)


API_URL = "https://dapi.kakao.com/v3/search/book"
HANGUL_BASE = 0xAC00
CHOSUNG = 19
JUNGSUNG = 21
JONGSUNG = (0, 1, 4, 8, 16, 17, 19, 21)
STATE_VERSION = 2


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
    parser = argparse.ArgumentParser(description="카카오 도서 검색 일일 쿼터 파트 수집기")
    parser.add_argument("--max-requests", type=int, default=29999, help="이번 실행의 최대 HTTP 요청 수")
    parser.add_argument("--page-size", type=int, default=50, choices=range(1, 51), metavar="1..50")
    parser.add_argument("--part-size", type=int, default=1000, help="완료 Raw 파트당 HTTP 요청 수")
    parser.add_argument("--delay", type=float, default=0.10)
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--output-dir", type=Path, default=root)
    parser.add_argument("--sample-size", type=int, default=10)
    args = parser.parse_args()
    if args.max_requests < 1 or args.part_size < 1:
        parser.error("--max-requests와 --part-size는 1 이상이어야 합니다.")
    return args


def generated_title_queries() -> Iterator[str]:
    for final in JONGSUNG:
        for medial in range(JUNGSUNG):
            for initial in range(CHOSUNG):
                yield chr(HANGUL_BASE + ((initial * JUNGSUNG + medial) * 28) + final)


def api_request(api_key: str, query: str, page: int, page_size: int) -> tuple[int, dict[str, Any]]:
    params = urlencode({"query": query, "target": "title", "sort": "accuracy", "page": page, "size": page_size})
    request = Request(
        f"{API_URL}?{params}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": STATE_VERSION,
            "query_index": 0,
            "page": 1,
            "total_request_count": 0,
            "raw_records": 0,
            "part_number": 1,
            "part_requests": 0,
            "part_documents": 0,
            "started_at": utc_now(),
        }
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("schema_version") != STATE_VERSION:
        raise ValueError("호환되지 않는 상태 파일입니다. 새 output-dir에서 v2 수집을 시작하세요.")
    return state


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
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
    parts_dir = output / "raw" / "parts"
    metadata_dir = output / "metadata"
    state_path = metadata_dir / "title_crawl_v2.runtime.json"
    unresolved_path = metadata_dir / "unresolved_ranges.json"
    cache_path = metadata_dir / "range_count_cache.json"

    try:
        state = load_state(state_path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    unresolved = load_json(unresolved_path, [])
    if not isinstance(unresolved, list):
        unresolved = []
    count_cache = load_json(cache_path, {})
    if not isinstance(count_cache, dict):
        count_cache = {}
    queries = list(generated_title_queries())

    write_json(metadata_dir / "range_plan.json", {
        "created_at": utc_now(),
        "api": "Kakao Book Search",
        "endpoint": API_URL,
        "scope": "quota_crawl",
        "strategy": "deterministic Korean syllable title queries",
        "raw_record_unit": "one book document per JSONL line",
        "target": "title",
        "sort": "accuracy",
        "page_size": args.page_size,
        "part_size_requests": args.part_size,
        "max_requests_this_run": args.max_requests,
        "query_count": len(queries),
        "query_generation": {
            "initial_consonants": CHOSUNG,
            "medial_vowels": JUNGSUNG,
            "final_variants": list(JONGSUNG),
        },
        "note": "검색 API 순회이므로 전체 카탈로그 완전성을 보장하지 않는다.",
    })

    def persist_state() -> None:
        state["updated_at"] = utc_now()
        write_json(state_path, state)
        write_json(unresolved_path, unresolved)
        write_json(cache_path, count_cache)

    part_name = f"title_{int(state['part_number']):06d}"
    temp_path = parts_dir / f"{part_name}.part"
    raw_handle = temp_path.open("a", encoding="utf-8")
    batch_requests = 0
    stop_reason = "batch_request_limit"

    def complete_part() -> None:
        nonlocal raw_handle, temp_path, part_name
        raw_handle.close()
        final_path = parts_dir / f"{part_name}.jsonl"
        temp_path.replace(final_path)
        write_json(parts_dir / f"{part_name}.done.json", {
            "name": part_name,
            "scope": "quota_crawl",
            "status": "completed",
            "request_count": int(state["part_requests"]),
            "document_count": int(state["part_documents"]),
            "completed_at": utc_now(),
            "stop_reason": "part_size_reached",
        })
        state["part_number"] += 1
        state["part_requests"] = 0
        state["part_documents"] = 0
        part_name = f"title_{int(state['part_number']):06d}"
        temp_path = parts_dir / f"{part_name}.part"
        raw_handle = temp_path.open("a", encoding="utf-8")

    try:
        while batch_requests < args.max_requests and state["query_index"] < len(queries):
            query = queries[state["query_index"]]
            page = int(state["page"])
            if page > 50:
                state["query_index"] += 1
                state["page"] = 1
                continue

            payload: dict[str, Any] | None = None
            status: int | None = None
            last_error = ""
            attempts = 0
            quota_exhausted = False
            for attempt in range(args.retries + 1):
                if batch_requests >= args.max_requests:
                    break
                attempts += 1
                batch_requests += 1
                state["total_request_count"] += 1
                state["part_requests"] += 1
                try:
                    status, payload = api_request(api_key, query, page, args.page_size)
                    break
                except HTTPError as error:
                    status = error.code
                    last_error = f"HTTP {error.code}: {error.reason}"
                    if error.code == 429:
                        quota_exhausted = True
                        break
                except (URLError, TimeoutError, json.JSONDecodeError) as error:
                    last_error = str(error)
                if attempt < args.retries:
                    time.sleep(min(2 ** attempt, 16))

            if payload is None:
                if batch_requests >= args.max_requests and not quota_exhausted:
                    stop_reason = "batch_request_limit"
                    persist_state()
                    break
                unresolved.append({
                    "scope": "quota_crawl", "part": part_name, "query": query,
                    "target": "title", "page": page, "http_status": status,
                    "error": last_error or "request limit reached before response",
                    "attempts": attempts, "last_attempt_at": utc_now(),
                })
                if quota_exhausted:
                    stop_reason = "http_429"
                    persist_state()
                    break
                state["query_index"] += 1
                state["page"] = 1
                persist_state()
                continue

            collected_at = utc_now()
            documents = payload.get("documents", [])
            for document in documents:
                if not isinstance(document, dict):
                    continue
                raw_handle.write(json.dumps(raw_book(
                    document,
                    query=query,
                    target="title",
                    page=page,
                    collected_at=collected_at,
                    http_status=int(status or 200),
                ), ensure_ascii=False) + "\n")
                state["raw_records"] += 1
                state["part_documents"] += 1
            raw_handle.flush()

            meta = payload.get("meta", {})
            if meta.get("is_end", True):
                count_cache[query] = {
                    "target": "title",
                    "total_count": int(meta.get("total_count", 0) or 0),
                    "page_count": page,
                }
                state["query_index"] += 1
                state["page"] = 1
            else:
                state["page"] += 1

            if state["part_requests"] >= args.part_size:
                complete_part()
            if batch_requests % 50 == 0:
                print(
                    f"requests={batch_requests:,} total={state['total_request_count']:,} "
                    f"raw={state['raw_records']:,}",
                    flush=True,
                )
            persist_state()
            time.sleep(args.delay)

        if state["query_index"] >= len(queries):
            stop_reason = "query_plan_completed"
            if state["part_requests"] > 0:
                complete_part()
            if not raw_handle.closed:
                raw_handle.close()
            temp_path.unlink(missing_ok=True)
            state_path.unlink(missing_ok=True)
        else:
            persist_state()
    finally:
        if not raw_handle.closed:
            raw_handle.close()

    stamp = datetime.now().strftime("%Y%m%d")
    result = merge_normalize_and_report(
        parts=parts_dir.glob("title_*.jsonl"),
        merged_path=output / "processed" / f"books_merged_quota_{stamp}.jsonl",
        processed_path=output / "processed" / f"books_normalized_quota_{stamp}.jsonl",
        sample_jsonl_path=output / "samples" / "sample_books.jsonl",
        sample_pretty_path=output / "samples" / "sample_books.pretty.json",
        report_path=output / "reports" / "missing_report_quota_crawl.csv",
        summary_path=output / "reports" / "data_quality_summary_quota_crawl.txt",
        database_path=metadata_dir / "title_merge.sqlite3",
        unresolved=unresolved,
        scope="quota_crawl",
        sample_size=args.sample_size,
    )
    print(
        f"stop={stop_reason} batch_requests={batch_requests:,} "
        f"completed_parts={result['part_count']:,} unique={result['unique_count']:,}"
    )
    return 3 if stop_reason == "http_429" else 0


if __name__ == "__main__":
    raise SystemExit(main())
