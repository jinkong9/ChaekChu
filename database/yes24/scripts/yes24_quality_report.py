#!/usr/bin/env python3
"""YES24 상세 수집 JSONL의 품질 리포트와 저장소용 샘플을 생성한다."""

from __future__ import annotations

import argparse
import copy
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORTS = ROOT / "reports"
DEFAULT_SAMPLES = ROOT / "samples"

FIELDS = [
    "sortOrder",
    "itemId",
    "title",
    "subTitle",
    "author",
    "goodsType",
    "goodsSortNm",
    "adultYn",
    "publisher",
    "isbn10",
    "isbn13",
    "shopPrice",
    "salePrice",
    "publishDate",
    "itemStatus",
    "originalTitle",
    "originalTranslation",
    "yesPoint",
    "salePoint",
    "fixedBookPriceYn",
    "pages",
    "weight",
    "width",
    "length",
    "height",
    "itemFormat",
    "starScore",
    "cover",
    "link",
    "addOnLink",
    "mobileLink",
    "eBookLink",
    "ebookId",
    "upDown",
    "contentDetail.bookIntroduction",
    "contentDetail.bookSummary",
    "contentDetail.tableOfContents",
    "series",
]


def nested_value(record: dict[str, Any], field: str) -> Any:
    value: Any = record
    for part in field.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def is_missing(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def example_value(field: str, value: Any) -> str:
    if field.startswith("contentDetail.") and isinstance(value, str):
        return f"<text length={len(value)}>"
    if isinstance(value, (list, dict)):
        return f"<{type(value).__name__} length={len(value)}>"
    text = str(value).replace("\r", " ").replace("\n", " ")
    return text[:120]


def repository_sample(item: dict[str, Any]) -> dict[str, Any]:
    """긴 소개·목차 본문은 저장소 샘플에서 길이 메타데이터로 대체한다."""
    sample = copy.deepcopy(item)
    content = sample.get("contentDetail")
    if isinstance(content, dict):
        for field in ("bookIntroduction", "bookSummary", "tableOfContents"):
            value = content.get(field)
            if isinstance(value, str) and value:
                content[field] = f"<omitted from repository sample; length={len(value)}>"
    return sample


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YES24 수집 결과 품질 리포트를 생성합니다.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--scope", default="collected")
    parser.add_argument("--reports-dir", type=Path, default=DEFAULT_REPORTS)
    parser.add_argument("--samples-dir", type=Path, default=DEFAULT_SAMPLES)
    parser.add_argument("--sample-size", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f"입력 파일을 찾을 수 없습니다: {args.input}")

    status_counts: Counter[str] = Counter()
    missing_counts: Counter[str] = Counter()
    zero_counts: Counter[str] = Counter()
    examples: dict[str, str] = {}
    request_isbns: list[str] = []
    response_isbns: list[str] = []
    item_ids: list[int] = []
    samples: list[dict[str, Any]] = []
    item_count = 0
    exact_matches = 0
    mismatches = 0

    with args.input.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{args.input}:{line_number} JSON 파싱 실패: {exc}") from exc
            status = str(record.get("status", "unknown"))
            status_counts[status] += 1
            request_isbn = str((record.get("request") or {}).get("isbn13") or "")
            if request_isbn:
                request_isbns.append(request_isbn)
            if status != "success":
                continue

            data = (record.get("response") or {}).get("data") or {}
            items = data.get("items") if isinstance(data, dict) else []
            for item in items if isinstance(items, list) else []:
                if not isinstance(item, dict):
                    continue
                item_count += 1
                response_isbn = str(item.get("isbn13") or "")
                if response_isbn:
                    response_isbns.append(response_isbn)
                item_id = item.get("itemId")
                if isinstance(item_id, int):
                    item_ids.append(item_id)
                if request_isbn and response_isbn:
                    if request_isbn == response_isbn:
                        exact_matches += 1
                    else:
                        mismatches += 1

                for field in FIELDS:
                    value = nested_value(item, field)
                    if is_missing(value):
                        missing_counts[field] += 1
                    else:
                        examples.setdefault(field, example_value(field, value))
                    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
                        zero_counts[field] += 1

                if len(samples) < args.sample_size:
                    samples.append(repository_sample(item))

    args.reports_dir.mkdir(parents=True, exist_ok=True)
    args.samples_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    missing_path = args.reports_dir / f"missing_report_{args.scope}.csv"
    with missing_path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=["field", "total", "missing_count", "missing_rate_pct", "zero_count", "example"],
        )
        writer.writeheader()
        for field in FIELDS:
            missing = missing_counts[field]
            writer.writerow(
                {
                    "field": field,
                    "total": item_count,
                    "missing_count": missing,
                    "missing_rate_pct": f"{(missing / item_count * 100) if item_count else 0:.4f}",
                    "zero_count": zero_counts[field],
                    "example": examples.get(field, ""),
                }
            )

    summary_path = args.reports_dir / f"data_quality_summary_{args.scope}.txt"
    unique_requests = len(set(request_isbns))
    unique_response_isbns = len(set(response_isbns))
    unique_item_ids = len(set(item_ids))
    summary_lines = [
        "YES24 detail collection data quality summary",
        f"generated_at_utc={generated_at}",
        f"input_file={args.input.resolve()}",
        f"result_records={sum(status_counts.values())}",
        f"success_records={status_counts['success']}",
        f"not_found_records={status_counts['not_found']}",
        f"invalid_isbn_records={status_counts['invalid_isbn']}",
        f"api_error_records={status_counts['api_error']}",
        f"request_error_records={status_counts['request_error']}",
        f"response_items={item_count}",
        f"unique_request_isbn13={unique_requests}",
        f"duplicate_request_isbn13={len(request_isbns) - unique_requests}",
        f"unique_response_isbn13={unique_response_isbns}",
        f"duplicate_response_isbn13={len(response_isbns) - unique_response_isbns}",
        f"unique_item_ids={unique_item_ids}",
        f"duplicate_item_ids={len(item_ids) - unique_item_ids}",
        f"exact_request_response_isbn_matches={exact_matches}",
        f"request_response_isbn_mismatches={mismatches}",
        f"exact_match_rate_pct={(exact_matches / (exact_matches + mismatches) * 100) if exact_matches + mismatches else 0:.4f}",
        "",
        "Key field missing rates",
    ]
    for field in (
        "title",
        "author",
        "publisher",
        "isbn13",
        "publishDate",
        "pages",
        "cover",
        "contentDetail.bookIntroduction",
        "contentDetail.bookSummary",
        "contentDetail.tableOfContents",
    ):
        rate = (missing_counts[field] / item_count * 100) if item_count else 0
        summary_lines.append(f"{field}={rate:.4f}%")
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    jsonl_path = args.samples_dir / "sample_yes24_books.jsonl"
    with jsonl_path.open("w", encoding="utf-8", newline="\n") as output:
        for item in samples:
            output.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    pretty_path = args.samples_dir / "sample_yes24_books.pretty.json"
    pretty_path.write_text(
        json.dumps(samples, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"summary={summary_path}")
    print(f"missing_report={missing_path}")
    print(f"sample_jsonl={jsonl_path}")
    print(f"sample_pretty={pretty_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
