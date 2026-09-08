from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import gzip
import json
from pathlib import Path
import re
from typing import Any, Iterator, TextIO


NORMALIZATION_VERSION = "d4l-feature-normalization-v1"
NORMALIZATION_FIELDS = (
    "isbn13",
    "bookname",
    "authors",
    "publisher",
    "pub_year",
    "class_no",
    "class_nm",
    "add_symbol",
    "loan_total",
    "co_loan",
    "mania_rec",
    "reader_rec",
    "loan_history",
)
RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")
MONTH_PATTERN = re.compile(r"^(\d{4})년 (0[1-9]|1[0-2])월$")


class NormalizationError(ValueError):
    """Raised when a D4L record cannot be deterministically normalized."""


@contextmanager
def _open_text(path: Path) -> Iterator[TextIO]:
    if path.name.lower().endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as file:
            yield file
        return
    with path.open(encoding="utf-8") as file:
        yield file


def _nullable_text(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    return stripped or None


def _normalize_relation(value: Any, field_name: str) -> list[list[str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        return value

    unique: set[tuple[str, str]] = set()
    invalid_items: list[Any] = []
    for position, item in enumerate(value):
        if not isinstance(item, list) or len(item) < 2:
            invalid_items.append(item)
            continue
        identifier = _nullable_text(item[0])
        title = _nullable_text(item[1])
        if not isinstance(identifier, str) or not isinstance(title, str) or not identifier or not title:
            invalid_items.append(item)
            continue
        unique.add((identifier, title))
    normalized = [[identifier, title] for identifier, title in sorted(unique)]
    return [*normalized, *sorted(invalid_items, key=canonical_json_bytes)]


def _month_key(value: str) -> tuple[int, int]:
    match = MONTH_PATTERN.fullmatch(value)
    if match is None:
        raise NormalizationError(f"invalid loan_history month: {value}")
    return int(match.group(1)), int(match.group(2))


def _normalize_loan_history(value: Any) -> list[list[Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        return value

    unique: dict[tuple[int, int], list[Any]] = {}
    invalid_items: list[Any] = []
    for position, item in enumerate(value):
        if not isinstance(item, list) or len(item) < 3:
            invalid_items.append(item)
            continue
        month = _nullable_text(item[0])
        if not isinstance(month, str) or not month:
            invalid_items.append(item)
            continue
        try:
            month_key = _month_key(month)
        except NormalizationError:
            invalid_items.append(item)
            continue
        loan_count, national_rank = item[1], item[2]
        if (
            not isinstance(loan_count, int)
            or isinstance(loan_count, bool)
            or loan_count < 0
            or not isinstance(national_rank, int)
            or isinstance(national_rank, bool)
            or national_rank < 0
        ):
            invalid_items.append(item)
            continue
        unique.setdefault(month_key, [month, loan_count, national_rank])
    return [unique[key] for key in sorted(unique)] + sorted(invalid_items, key=canonical_json_bytes)


def normalize_d4l_record(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise NormalizationError("record must be a JSON object")

    bookname = raw.get("bookname", raw.get("title"))
    loan_total = raw.get("loan_total")
    normalized: dict[str, Any] = {
        "isbn13": _nullable_text(raw.get("isbn13")),
        "bookname": _nullable_text(bookname),
        "authors": _nullable_text(raw.get("authors")),
        "publisher": _nullable_text(raw.get("publisher")),
        "pub_year": _nullable_text(raw.get("pub_year")),
        "class_no": _nullable_text(raw.get("class_no")),
        "class_nm": _nullable_text(raw.get("class_nm")),
        "add_symbol": _nullable_text(raw.get("add_symbol")),
        "loan_total": loan_total,
    }
    for field_name in RELATION_FIELDS:
        normalized[field_name] = _normalize_relation(raw.get(field_name), field_name)
    normalized["loan_history"] = _normalize_loan_history(raw.get("loan_history"))
    return normalized


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=False, separators=(",", ":")).encode("utf-8")


def normalized_record_bytes(raw: Any) -> bytes:
    return canonical_json_bytes(normalize_d4l_record(raw))


def normalized_input_hash(path: Path) -> str:
    digest = sha256()
    digest.update(NORMALIZATION_VERSION.encode("utf-8"))
    digest.update(b"\n")
    digest.update(canonical_json_bytes(list(NORMALIZATION_FIELDS)))
    digest.update(b"\n")
    records = 0
    try:
        with _open_text(path) as file:
            for line_number, line in enumerate(file, start=1):
                if not line.strip():
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    digest.update(b"invalid-json:")
                    digest.update(line.strip().encode("utf-8"))
                    digest.update(b"\n")
                    records += 1
                    continue
                try:
                    record_bytes = normalized_record_bytes(raw)
                except NormalizationError:
                    record_bytes = canonical_json_bytes(raw)
                digest.update(record_bytes)
                digest.update(b"\n")
                records += 1
    except OSError as error:
        raise NormalizationError(error.strerror or "input could not be read") from error
    if records == 0:
        raise NormalizationError("input contains no book records")
    return digest.hexdigest()
