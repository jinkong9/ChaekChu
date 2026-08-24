#!/usr/bin/env python3
"""Collect Kakao Book Search data while preserving every documented book field."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://dapi.kakao.com/v3/search/book"
BOOK_FIELDS = (
    "title", "contents", "url", "isbn", "datetime", "authors", "publisher",
    "translators", "price", "sale_price", "thumbnail", "status",
)


def load_dotenv(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'") )


def parse_args() -> argparse.Namespace:
    here = Path(__file__).resolve()
    parser = argparse.ArgumentParser(description="카카오 도서 검색 API 수집기")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--query", action="append", help="검색어. 여러 번 지정 가능")
    source.add_argument("--input-jsonl", type=Path, help="ISBN을 읽을 JSONL 파일")
    parser.add_argument("--isbn-field", default="EA_ISBN", help="입력 JSONL ISBN 필드명 (기본: EA_ISBN)")
    parser.add_argument("--limit", type=int, default=0, help="입력 ISBN 최대 처리 수. 0이면 전체")
    parser.add_argument("--size", type=int, default=50, choices=range(1, 51), metavar="1..50")
    parser.add_argument("--delay", type=float, default=0.2, help="요청 사이 대기 초 (기본: 0.2)")
    parser.add_argument("--retries", type=int, default=3, help="일시 오류 재시도 횟수")
    parser.add_argument(
        "--output-dir", type=Path, default=here.parents[1],
        help="카카오 데이터 루트. 기본: database/카카오",
    )
    parser.add_argument("--sample-size", type=int, default=10, help="저장할 샘플 레코드 수")
    return parser.parse_args()


def cleaned_isbns(value: Any) -> tuple[str | None, str | None]:
    isbn10 = isbn13 = None
    for token in str(value or "").split():
        normalized = re.sub(r"[^0-9Xx]", "", token).upper()
        if len(normalized) == 13 and normalized.isdigit():
            isbn13 = normalized
        elif len(normalized) == 10 and re.fullmatch(r"[0-9]{9}[0-9X]", normalized):
            isbn10 = normalized
    return isbn10, isbn13


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
            isbn10, isbn13 = cleaned_isbns(record.get(field))
            query = isbn13 or isbn10
            if query and query not in seen:
                seen.add(query)
                yield query
                if limit and len(seen) >= limit:
                    return


def request_books(api_key: str, query: str, page: int, size: int, target: str | None) -> tuple[int, dict[str, Any]]:
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


def normalized_book(document: dict[str, Any], query: str, collected_at: str) -> dict[str, Any]:
    isbn10, isbn13 = cleaned_isbns(document.get("isbn"))
    result: dict[str, Any] = {field: document.get(field) for field in BOOK_FIELDS}
    result.update({
        "isbn10_normalized": isbn10,
        "isbn13_normalized": isbn13,
        "source": "kakao_book_search",
        "source_query": query,
        "collected_at": collected_at,
    })
    # API array fields are normalized to empty arrays; numeric price fields use -1 when absent.
    for array_field in ("authors", "translators"):
        result[array_field] = result[array_field] or []
    for number_field in ("price", "sale_price"):
        result[number_field] = result[number_field] if result[number_field] is not None else -1
    for string_field in ("title", "contents", "url", "isbn", "datetime", "publisher", "thumbnail", "status"):
        result[string_field] = result[string_field] or ""
    return result


def record_key(book: dict[str, Any]) -> str:
    return (
        f"isbn13:{book['isbn13_normalized']}" if book["isbn13_normalized"] else
        f"isbn10:{book['isbn10_normalized']}" if book["isbn10_normalized"] else
        "fallback:" + "|".join((book["title"], ",".join(book["authors"]), book["publisher"]))
    )


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[3]
    load_dotenv(project_root / ".env")
    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not api_key:
        print("KAKAO_REST_API_KEY가 .env 또는 환경 변수에 필요합니다.", file=sys.stderr)
        return 2

    output = args.output_dir.resolve()
    for name in ("raw", "processed", "samples", "reports", "metadata"):
        (output / name).mkdir(parents=True, exist_ok=True)

    if args.input_jsonl:
        queries = list(read_isbn_queries(args.input_jsonl, args.isbn_field, args.limit))
        target = "isbn"
        input_description = {"type": "jsonl_isbn", "path": str(args.input_jsonl), "field": args.isbn_field}
    else:
        queries = list(dict.fromkeys(args.query))
        target = None
        input_description = {"type": "search_query", "queries": queries}

    stamp = datetime.now().strftime("%Y%m%d")
    collected_at = datetime.now(timezone.utc).isoformat()
    raw_path = output / "raw" / f"books_raw_{stamp}.jsonl"
    processed_path = output / "processed" / f"books_normalized_{stamp}.jsonl"
    unresolved: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    request_count = 0

    write_json(output / "metadata" / "range_plan.json", {
        "created_at": collected_at,
        "api": "Kakao Book Search",
        "endpoint": API_URL,
        "input": input_description,
        "query_count": len(queries),
        "page_size": args.size,
        "note": "카카오 책 검색 일간 쿼터를 초과하지 않도록 실행 범위를 조절한다.",
    })

    with raw_path.open("w", encoding="utf-8") as raw_handle:
        for query_index, query in enumerate(queries, 1):
            page = 1
            while page <= 50:
                for attempt in range(args.retries + 1):
                    try:
                        status, payload = request_books(api_key, query, page, args.size, target)
                        break
                    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
                        if attempt == args.retries:
                            unresolved.append({"query": query, "page": page, "error": str(exc), "attempts": attempt + 1})
                            payload = None
                            status = getattr(exc, "code", None)
                            break
                        time.sleep(min(2 ** attempt, 8))
                request_count += 1
                if payload is None:
                    break
                raw_record = {
                    "collected_at": datetime.now(timezone.utc).isoformat(),
                    "request": {"query": query, "page": page, "size": args.size, "target": target},
                    "http_status": status,
                    "response": payload,
                }
                raw_handle.write(json.dumps(raw_record, ensure_ascii=False) + "\n")
                documents.extend(normalized_book(doc, query, collected_at) for doc in payload.get("documents", []))
                if payload.get("meta", {}).get("is_end", True):
                    break
                page += 1
                time.sleep(args.delay)
            print(f"[{query_index}/{len(queries)}] {query}", file=sys.stderr)

    deduplicated: dict[str, dict[str, Any]] = {}
    for book in documents:
        deduplicated.setdefault(record_key(book), book)
    normalized = list(deduplicated.values())
    with processed_path.open("w", encoding="utf-8") as processed_handle:
        for book in normalized:
            processed_handle.write(json.dumps(book, ensure_ascii=False) + "\n")

    sample = normalized[:args.sample_size]
    sample_base = output / "samples" / "sample_books"
    with (sample_base.with_suffix(".jsonl")).open("w", encoding="utf-8") as handle:
        for book in sample:
            handle.write(json.dumps(book, ensure_ascii=False) + "\n")
    write_json(sample_base.with_suffix(".pretty.json"), sample)

    missing = Counter()
    for book in normalized:
        for field in BOOK_FIELDS + ("isbn10_normalized", "isbn13_normalized"):
            if book.get(field) in (None, "", [], -1):
                missing[field] += 1
    with (output / "reports" / "missing_report_latest.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["field", "missing_count", "total_count", "missing_rate"])
        for field in BOOK_FIELDS + ("isbn10_normalized", "isbn13_normalized"):
            total = len(normalized)
            writer.writerow([field, missing[field], total, f"{(missing[field] / total * 100) if total else 0:.2f}%"])
    (output / "reports" / "data_quality_summary_latest.txt").write_text(
        "카카오 도서 검색 데이터 품질 요약\n"
        + "=" * 62 + "\n"
        + f"생성 시각(UTC): {collected_at}\n"
        + f"검색어/ISBN 입력 수: {len(queries):,}\n"
        + f"API 호출 수: {request_count:,}\n"
        + f"원본 도서 레코드 수: {len(documents):,}\n"
        + f"ISBN/서지 기준 중복 제거 후: {len(normalized):,}\n"
        + f"중복 제거 수: {len(documents) - len(normalized):,}\n"
        + f"미해결 요청 수: {len(unresolved):,}\n",
        encoding="utf-8",
    )
    write_json(output / "metadata" / "unresolved_ranges.json", unresolved)
    print(f"raw: {raw_path}")
    print(f"processed: {processed_path}")
    print(f"records: {len(normalized):,}, requests: {request_count:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
