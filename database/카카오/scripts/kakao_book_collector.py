#!/usr/bin/env python3
"""Resumable Kakao Book Search collector using book-per-line raw parts."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from kakao_book_common import (
    merge_normalize_and_report,
    parse_isbn,
    raw_book,
    utc_now,
    write_json,
)


API_URL = "https://dapi.kakao.com/v3/search/book"


def load_dotenv(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def parse_args() -> argparse.Namespace:
    here = Path(__file__).resolve()
    parser = argparse.ArgumentParser(description="카카오 도서 검색 API 파트 수집기")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--query", action="append", help="검색어. 여러 번 지정 가능")
    source.add_argument("--input-jsonl", type=Path, help="ISBN을 읽을 JSONL 파일")
    parser.add_argument("--isbn-field", default="EA_ISBN", help="입력 JSONL ISBN 필드명")
    parser.add_argument("--limit", type=int, default=0, help="입력 ISBN 최대 처리 수. 0이면 전체")
    parser.add_argument("--size", type=int, default=50, choices=range(1, 51), metavar="1..50")
    parser.add_argument("--part-size", type=int, default=500, help="Raw 파트당 검색어/ISBN 수")
    parser.add_argument("--delay", type=float, default=0.2, help="성공 요청 사이 대기 초")
    parser.add_argument("--retries", type=int, default=3, help="일시 오류 재시도 횟수")
    parser.add_argument(
        "--output-dir", type=Path, default=here.parents[1],
        help="카카오 데이터 루트. 기본: database/카카오",
    )
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument("--merge-only", action="store_true", help="API 호출 없이 완료 파트만 병합")
    parser.add_argument("--merge-scope", choices=("isbn", "query"), default="isbn", help="merge-only 대상")
    args = parser.parse_args()
    if not args.merge_only and not args.query and not args.input_jsonl:
        parser.error("--query 또는 --input-jsonl이 필요합니다.")
    if args.part_size < 1:
        parser.error("--part-size는 1 이상이어야 합니다.")
    return args


def read_isbn_queries(path: Path, field: str, limit: int) -> Iterable[str]:
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"입력 JSONL {line_no}행이 올바른 JSON이 아닙니다.") from exc
            isbn10, isbn13, valid, _ = parse_isbn(record.get(field))
            query = isbn13 or isbn10
            if valid and query and query not in seen:
                seen.add(query)
                yield query
                if limit and len(seen) >= limit:
                    return


def request_books(
    api_key: str,
    query: str,
    page: int,
    size: int,
    target: str | None,
) -> tuple[int, dict[str, Any]]:
    params: dict[str, Any] = {"query": query, "page": page, "size": size}
    if target:
        params["target"] = target
    request = Request(
        f"{API_URL}?{urlencode(params)}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def load_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, list) else []


def collect_part(
    *,
    api_key: str,
    queries: list[str],
    target: str | None,
    scope: str,
    part_number: int,
    parts_dir: Path,
    page_size: int,
    retries: int,
    delay: float,
    unresolved: list[dict[str, Any]],
    count_cache: dict[str, dict[str, Any]],
) -> tuple[Path | None, int, int]:
    name = f"{scope}_{part_number:06d}"
    final_path = parts_dir / f"{name}.jsonl"
    done_path = parts_dir / f"{name}.done.json"
    temp_path = parts_dir / f"{name}.part"
    if final_path.exists() and done_path.exists():
        metadata = json.loads(done_path.read_text(encoding="utf-8"))
        print(f"[건너뜀] {name} - {metadata.get('document_count', 0):,}건")
        return final_path, 0, int(metadata.get("document_count", 0))

    temp_path.unlink(missing_ok=True)
    request_count = 0
    document_count = 0
    failed = False
    quota_exhausted = False
    unresolved_before = len(unresolved)
    print(f"[수집] {name} - 입력 {len(queries):,}건")

    with temp_path.open("w", encoding="utf-8") as raw_handle:
        for query_index, query in enumerate(queries, 1):
            page = 1
            query_documents = 0
            while page <= 50:
                payload: dict[str, Any] | None = None
                status: int | None = None
                last_error = ""
                attempts = 0
                for attempt in range(retries + 1):
                    attempts += 1
                    request_count += 1
                    try:
                        status, payload = request_books(api_key, query, page, page_size, target)
                        break
                    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
                        status = getattr(error, "code", None)
                        last_error = str(error)
                        if attempt < retries and status != 429:
                            time.sleep(min(2 ** attempt, 8))
                        if status == 429:
                            quota_exhausted = True
                            break
                if payload is None:
                    unresolved.append({
                        "scope": scope, "part": name, "query": query, "target": target,
                        "page": page, "http_status": status, "error": last_error,
                        "attempts": attempts, "last_attempt_at": utc_now(),
                    })
                    failed = True
                    break

                collected_at = utc_now()
                documents = payload.get("documents", [])
                for document in documents:
                    if not isinstance(document, dict):
                        continue
                    raw_handle.write(json.dumps(raw_book(
                        document,
                        query=query,
                        target=target,
                        page=page,
                        collected_at=collected_at,
                        http_status=int(status or 200),
                    ), ensure_ascii=False) + "\n")
                    document_count += 1
                    query_documents += 1

                meta = payload.get("meta", {})
                if meta.get("is_end", True):
                    count_cache[query] = {
                        "target": target,
                        "total_count": int(meta.get("total_count", query_documents) or 0),
                        "page_count": page,
                        "document_count": query_documents,
                    }
                    break
                page += 1
                time.sleep(delay)

            print(f"\r  {query_index:,}/{len(queries):,} | 도서 {document_count:,}건", end="", flush=True)
            if quota_exhausted:
                break
            if delay > 0:
                time.sleep(delay)
    print()

    if quota_exhausted:
        temp_path.unlink(missing_ok=True)
        print(f"[미완료] {name} - 429 응답을 metadata/unresolved_ranges.json에 기록")
        return None, request_count, 0

    temp_path.replace(final_path)
    part_unresolved = len(unresolved) - unresolved_before
    write_json(done_path, {
        "name": name,
        "scope": scope,
        "status": "completed_with_unresolved" if failed else "completed",
        "input_count": len(queries),
        "request_count": request_count,
        "document_count": document_count,
        "unresolved_request_count": part_unresolved,
        "completed_at": utc_now(),
        "stop_reason": "completed",
    })
    return final_path, request_count, document_count


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[3]
    load_dotenv(project_root / ".env")
    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not args.merge_only and not api_key:
        print("KAKAO_REST_API_KEY가 .env 또는 환경 변수에 필요합니다.", file=sys.stderr)
        return 2

    output = args.output_dir.resolve()
    for directory in ("raw/parts", "processed", "samples", "reports", "metadata"):
        (output / directory).mkdir(parents=True, exist_ok=True)

    if args.input_jsonl:
        queries = list(read_isbn_queries(args.input_jsonl, args.isbn_field, args.limit))
        target = "isbn"
        scope = "isbn"
        input_description = {"type": "jsonl_isbn", "path": str(args.input_jsonl), "field": args.isbn_field}
    elif args.query:
        queries = list(dict.fromkeys(args.query))
        target = None
        scope = "query"
        input_description = {"type": "search_query", "queries": queries}
    else:
        queries = []
        target = None
        scope = args.merge_scope
        input_description = {"type": "merge_only"}

    metadata_dir = output / "metadata"
    parts_dir = output / "raw" / "parts"
    unresolved_path = metadata_dir / "unresolved_ranges.json"
    cache_path = metadata_dir / "range_count_cache.json"
    unresolved = load_json_list(unresolved_path)
    count_cache: dict[str, dict[str, Any]] = {}
    if cache_path.exists():
        loaded_cache = json.loads(cache_path.read_text(encoding="utf-8"))
        if isinstance(loaded_cache, dict):
            count_cache = loaded_cache

    part_plan = [
        {"name": f"{scope}_{index // args.part_size + 1:06d}", "input_count": len(queries[index:index + args.part_size])}
        for index in range(0, len(queries), args.part_size)
    ]
    if not args.merge_only:
        write_json(metadata_dir / "range_plan.json", {
            "created_at": utc_now(),
            "api": "Kakao Book Search",
            "endpoint": API_URL,
            "scope": scope,
            "raw_record_unit": "one book document per JSONL line",
            "input": input_description,
            "query_count": len(queries),
            "page_size": args.size,
            "part_size": args.part_size,
            "parts": part_plan,
        })

    total_requests = 0
    if not args.merge_only:
        for offset in range(0, len(queries), args.part_size):
            part_number = offset // args.part_size + 1
            _, request_count, _ = collect_part(
                api_key=str(api_key),
                queries=queries[offset:offset + args.part_size],
                target=target,
                scope=scope,
                part_number=part_number,
                parts_dir=parts_dir,
                page_size=args.size,
                retries=args.retries,
                delay=args.delay,
                unresolved=unresolved,
                count_cache=count_cache,
            )
            total_requests += request_count
            write_json(unresolved_path, unresolved)
            write_json(cache_path, count_cache)

    stamp = datetime.now().strftime("%Y%m%d")
    result = merge_normalize_and_report(
        parts=parts_dir.glob(f"{scope}_*.jsonl"),
        merged_path=output / "processed" / f"books_merged_{stamp}.jsonl",
        processed_path=output / "processed" / f"books_normalized_{stamp}.jsonl",
        sample_jsonl_path=output / "samples" / "sample_books.jsonl",
        sample_pretty_path=output / "samples" / "sample_books.pretty.json",
        report_path=output / "reports" / f"missing_report_{scope}.csv",
        summary_path=output / "reports" / f"data_quality_summary_{scope}.txt",
        database_path=metadata_dir / f"{scope}_merge.sqlite3",
        unresolved=unresolved,
        scope=scope,
        sample_size=args.sample_size,
    )
    write_json(unresolved_path, unresolved)
    write_json(cache_path, count_cache)
    print(f"완료 파트: {result['part_count']:,}")
    print(f"고유 도서: {result['unique_count']:,}, 이번 실행 HTTP 요청: {total_requests:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
