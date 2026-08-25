#!/usr/bin/env python3
"""Shared storage, ISBN normalization, merge, and reporting for Kakao books."""

from __future__ import annotations

import csv
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator


BOOK_FIELDS = (
    "title", "contents", "url", "isbn", "datetime", "authors", "publisher",
    "translators", "price", "sale_price", "thumbnail", "status",
)
NORMALIZED_FIELDS = BOOK_FIELDS + (
    "isbn_raw", "isbn10_normalized", "isbn13_normalized", "isbn_valid",
    "isbn_type", "source", "source_query", "source_target", "source_page",
    "collected_at",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def isbn10_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", value):
        return False
    total = sum((10 - index) * int(char) for index, char in enumerate(value[:9]))
    total += 10 if value[-1] == "X" else int(value[-1])
    return total % 11 == 0


def isbn13_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{13}", value):
        return False
    total = sum(
        int(char) * (1 if index % 2 == 0 else 3)
        for index, char in enumerate(value[:12])
    )
    return (10 - total % 10) % 10 == int(value[-1])


def isbn10_to_13(value: str) -> str | None:
    if not isbn10_is_valid(value):
        return None
    prefix = "978" + value[:9]
    total = sum(
        int(char) * (1 if index % 2 == 0 else 3)
        for index, char in enumerate(prefix)
    )
    return prefix + str((10 - total % 10) % 10)


def parse_isbn(value: Any) -> tuple[str | None, str | None, bool, str]:
    raw = str(value or "").strip()
    isbn10 = isbn13 = None
    for token in raw.split():
        candidate = re.sub(r"[^0-9Xx]", "", token).upper()
        if len(candidate) == 13 and isbn13_is_valid(candidate):
            isbn13 = candidate
        elif len(candidate) == 10 and isbn10_is_valid(candidate):
            isbn10 = candidate

    if isbn10 and isbn13:
        isbn_type = "BOTH"
    elif isbn13:
        isbn_type = "ISBN13"
    elif isbn10:
        isbn_type = "ISBN10"
    elif raw:
        isbn_type = "INVALID"
    else:
        isbn_type = "MISSING"

    normalized13 = isbn13 or (isbn10_to_13(isbn10) if isbn10 else None)
    return isbn10, normalized13, bool(isbn10 or isbn13), isbn_type


def raw_book(
    document: dict[str, Any],
    *,
    query: str,
    target: str | None,
    page: int,
    collected_at: str,
    http_status: int = 200,
) -> dict[str, Any]:
    """Return one API book document with collection metadata only."""
    result = dict(document)
    result.update({
        "_source_query": query,
        "_source_target": target,
        "_source_page": page,
        "_http_status": http_status,
        "_collected_at": collected_at,
    })
    return result


def normalize_book(
    document: dict[str, Any],
    *,
    query: str,
    target: str | None,
    page: int,
    collected_at: str,
) -> dict[str, Any]:
    isbn_raw = str(document.get("isbn") or "")
    isbn10, isbn13, isbn_valid, isbn_type = parse_isbn(isbn_raw)
    result: dict[str, Any] = {field: document.get(field) for field in BOOK_FIELDS}

    for field in ("authors", "translators"):
        result[field] = result[field] if isinstance(result[field], list) else []
    for field in ("title", "contents", "url", "isbn", "datetime", "publisher", "thumbnail", "status"):
        result[field] = result[field] if isinstance(result[field], str) else ""
    for field in ("price", "sale_price"):
        if isinstance(result[field], bool) or not isinstance(result[field], (int, float)):
            result[field] = None

    result.update({
        "isbn_raw": isbn_raw,
        "isbn10_normalized": isbn10,
        "isbn13_normalized": isbn13,
        "isbn_valid": isbn_valid,
        "isbn_type": isbn_type,
        "source": "kakao_book_search",
        "source_query": query,
        "source_target": target,
        "source_page": page,
        "collected_at": collected_at,
    })
    return result


def record_key(book: dict[str, Any]) -> str:
    if book.get("isbn13_normalized"):
        return f"isbn13:{book['isbn13_normalized']}"
    if book.get("isbn10_normalized"):
        return f"isbn10:{book['isbn10_normalized']}"
    authors = book.get("authors") if isinstance(book.get("authors"), list) else []
    return "fallback:" + "|".join((
        str(book.get("title") or "").strip(),
        ",".join(str(author) for author in authors),
        str(book.get("publisher") or "").strip(),
        str(book.get("datetime") or ""),
    ))


def iter_raw_books(record: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Read v2 book-per-line records and legacy request-envelope records."""
    response = record.get("response")
    if isinstance(response, dict) and isinstance(response.get("documents"), list):
        request = record.get("request") if isinstance(record.get("request"), dict) else {}
        collected_at = str(record.get("collected_at") or utc_now())
        status = int(record.get("http_status") or 200)
        for document in response["documents"]:
            if isinstance(document, dict):
                yield raw_book(
                    document,
                    query=str(request.get("query") or ""),
                    target=request.get("target"),
                    page=int(request.get("page") or 1),
                    collected_at=collected_at,
                    http_status=status,
                )
        return
    yield record


def normalize_raw_record(record: dict[str, Any]) -> dict[str, Any]:
    document = {key: value for key, value in record.items() if not key.startswith("_")}
    query = str(record.get("_source_query") or record.get("source_query") or "")
    target = record.get("_source_target", record.get("source_target"))
    if target is None and parse_isbn(query)[2]:
        target = "isbn"
    return normalize_book(
        document,
        query=query,
        target=target,
        page=int(record.get("_source_page") or record.get("source_page") or 1),
        collected_at=str(record.get("_collected_at") or record.get("collected_at") or utc_now()),
    )


def _is_missing(value: Any) -> bool:
    return value is None or value == "" or value == []


def _invalid_reason(field: str, value: Any, record: dict[str, Any]) -> str | None:
    if field == "isbn_raw" and value and not record.get("isbn_valid"):
        return "ISBN checksum or format is invalid"
    if field in ("price", "sale_price") and isinstance(value, (int, float)) and value < 0:
        return "negative price"
    if field == "datetime" and value:
        try:
            datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return "invalid ISO-8601 datetime"
    return None


class FieldStats:
    def __init__(self, fields: Iterable[str] = NORMALIZED_FIELDS):
        self.fields = tuple(fields)
        self.total = 0
        self.data = {
            field: {
                "present": 0, "null": 0, "blank": 0, "empty_array": 0,
                "zero": 0, "invalid": 0, "types": Counter(),
                "valid_examples": [], "invalid_examples": [],
            }
            for field in self.fields
        }

    def add(self, record: dict[str, Any]) -> None:
        self.total += 1
        for field in self.fields:
            row = self.data[field]
            if field not in record:
                continue
            row["present"] += 1
            value = record[field]
            row["types"][type(value).__name__] += 1
            if value is None:
                row["null"] += 1
            elif value == "":
                row["blank"] += 1
            elif value == []:
                row["empty_array"] += 1
            if value == 0 and not isinstance(value, bool):
                row["zero"] += 1

            reason = _invalid_reason(field, value, record)
            if reason:
                row["invalid"] += 1
                if len(row["invalid_examples"]) < 3:
                    row["invalid_examples"].append(f"{value!r} ({reason})")
            elif not _is_missing(value) and len(row["valid_examples"]) < 3:
                row["valid_examples"].append(json.dumps(value, ensure_ascii=False))

    def report(self) -> list[dict[str, Any]]:
        rows = []
        for field in self.fields:
            data = self.data[field]
            key_missing = self.total - data["present"]
            missing = key_missing + data["null"] + data["blank"] + data["empty_array"]
            rows.append({
                "field": field,
                "total_count": self.total,
                "key_present_count": data["present"],
                "key_missing_count": key_missing,
                "null_count": data["null"],
                "blank_count": data["blank"],
                "empty_array_count": data["empty_array"],
                "invalid_count": data["invalid"],
                "effective_missing_count": missing,
                "effective_missing_rate_percent": round(missing / self.total * 100, 2) if self.total else 0.0,
                "zero_count": data["zero"],
                "zero_rate_percent": round(data["zero"] / self.total * 100, 2) if self.total else 0.0,
                "types": " | ".join(f"{name}:{count}" for name, count in sorted(data["types"].items())),
                "example_valid_values": " | ".join(data["valid_examples"]),
                "example_invalid_values": " | ".join(data["invalid_examples"]),
            })
        return sorted(rows, key=lambda row: (-row["effective_missing_rate_percent"], row["field"]))


def merge_normalize_and_report(
    *,
    parts: Iterable[Path],
    merged_path: Path | None,
    processed_path: Path,
    sample_jsonl_path: Path,
    sample_pretty_path: Path,
    report_path: Path,
    summary_path: Path,
    database_path: Path,
    unresolved: list[dict[str, Any]],
    scope: str,
    sample_size: int = 10,
) -> dict[str, int]:
    part_paths = sorted({path.resolve() for path in parts if path.exists()})
    if not part_paths:
        return {
            "part_count": 0,
            "raw_count": 0,
            "unique_count": 0,
            "duplicate_count": 0,
            "malformed_count": 0,
            "invalid_isbn_count": 0,
        }
    database_path.parent.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(database_path)
    database.execute("DROP TABLE IF EXISTS books")
    database.execute(
        "CREATE TABLE books (sequence INTEGER PRIMARY KEY AUTOINCREMENT, "
        "dedupe_key TEXT UNIQUE NOT NULL, raw_payload TEXT NOT NULL, payload TEXT NOT NULL)"
    )

    raw_count = 0
    malformed_count = 0
    for part in part_paths:
        with part.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    outer = json.loads(line)
                except json.JSONDecodeError:
                    malformed_count += 1
                    continue
                if not isinstance(outer, dict):
                    malformed_count += 1
                    continue
                for raw_record in iter_raw_books(outer):
                    raw_count += 1
                    book = normalize_raw_record(raw_record)
                    database.execute(
                        "INSERT OR IGNORE INTO books(dedupe_key, raw_payload, payload) VALUES (?, ?, ?)",
                        (
                            record_key(book),
                            json.dumps(raw_record, ensure_ascii=False),
                            json.dumps(book, ensure_ascii=False),
                        ),
                    )
        database.commit()

    unique_count = int(database.execute("SELECT COUNT(*) FROM books").fetchone()[0])
    stats = FieldStats()
    samples: list[dict[str, Any]] = []
    if merged_path is not None:
        merged_path.parent.mkdir(parents=True, exist_ok=True)
        with merged_path.open("w", encoding="utf-8") as merged_output:
            for (raw_payload,) in database.execute("SELECT raw_payload FROM books ORDER BY sequence"):
                merged_output.write(raw_payload + "\n")
    processed_path.parent.mkdir(parents=True, exist_ok=True)
    with processed_path.open("w", encoding="utf-8") as output:
        for (payload,) in database.execute("SELECT payload FROM books ORDER BY sequence"):
            book = json.loads(payload)
            output.write(json.dumps(book, ensure_ascii=False) + "\n")
            stats.add(book)
            if len(samples) < sample_size:
                samples.append(book)

    sample_jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    with sample_jsonl_path.open("w", encoding="utf-8") as sample_file:
        for book in samples:
            sample_file.write(json.dumps(book, ensure_ascii=False) + "\n")
    write_json(sample_pretty_path, samples)

    report = stats.report()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8-sig") as report_file:
        if report:
            writer = csv.DictWriter(report_file, fieldnames=list(report[0].keys()))
            writer.writeheader()
            writer.writerows(report)

    invalid_isbn = stats.data["isbn_raw"]["invalid"]
    summary_path.write_text(
        "카카오 도서 검색 데이터 품질 요약\n"
        + "=" * 70 + "\n"
        + f"생성 시각(UTC): {utc_now()}\n"
        + f"수집 범위: {scope}\n"
        + f"병합 대상 완료 파트 수: {len(part_paths):,}\n"
        + f"Raw 도서 레코드 수: {raw_count:,}\n"
        + f"정규화·중복 제거 후: {unique_count:,}\n"
        + f"중복 제거 수: {raw_count - unique_count:,}\n"
        + f"잘못된 JSON 행 수: {malformed_count:,}\n"
        + f"유효하지 않은 ISBN 수: {invalid_isbn:,}\n"
        + f"미해결 요청 수: {len(unresolved):,}\n\n"
        + "[결측률 높은 필드 TOP 20]\n"
        + "\n".join(
            f"{row['field']}: {row['effective_missing_count']:,}/{row['total_count']:,} "
            f"({row['effective_missing_rate_percent']:.2f}%)"
            for row in report[:20]
        )
        + "\n",
        encoding="utf-8",
    )
    database.close()
    return {
        "part_count": len(part_paths),
        "raw_count": raw_count,
        "unique_count": unique_count,
        "duplicate_count": raw_count - unique_count,
        "malformed_count": malformed_count,
        "invalid_isbn_count": invalid_isbn,
    }
