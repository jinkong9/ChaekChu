"""Deterministic, distribution-aware dataset selection for the MVP."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, TextIO


SELECTION_VERSION = "mvp-stratified-v1"
ISBN13_PATTERN = re.compile(r"^97[89]\d{10}$")


def _open_text(path: Path, mode: str) -> TextIO:
    if path.suffix == ".gz":
        return gzip.open(path, mode, encoding="utf-8")  # type: ignore[return-value]
    return path.open(mode, encoding="utf-8")


def class_major(value: Any) -> str:
    parts = [part.strip() for part in str(value or "").split(">") if part.strip()]
    return parts[0] if parts else "unknown"


def publication_year_bucket(value: Any) -> str:
    try:
        year = int(str(value)[:4])
    except (TypeError, ValueError):
        return "unknown"
    if year < 2000:
        return "<2000"
    if year < 2010:
        return "2000-2009"
    if year < 2020:
        return "2010-2019"
    return "2020+"


def _loan_total(record: dict[str, Any]) -> int:
    try:
        return max(0, int(record.get("loan_total") or 0))
    except (TypeError, ValueError):
        return 0


def _record_preference(record: dict[str, Any]) -> tuple[int, int, str]:
    non_empty = sum(bool(str(record.get(field) or "").strip()) for field in ("authors", "publisher", "pub_year", "class_no", "class_nm"))
    return _loan_total(record), non_empty, str(record.get("isbn13") or "")


def _allocate_targets(counts: dict[str, int], limit: int) -> dict[str, int]:
    total = min(limit, sum(counts.values()))
    if total <= 0:
        return {key: 0 for key in counts}
    denominator = sum(counts.values())
    targets = {key: min(count, math.floor(total * count / denominator)) for key, count in counts.items()}
    remaining = total - sum(targets.values())
    order = sorted(
        counts,
        key=lambda key: (-(total * counts[key] / denominator - targets[key]), key),
    )
    while remaining:
        changed = False
        for key in order:
            if targets[key] < counts[key]:
                targets[key] += 1
                remaining -= 1
                changed = True
                if not remaining:
                    break
        if not changed:
            break
    return targets


def _distribution(records: Iterable[dict[str, Any]]) -> dict[str, dict[str, int]]:
    classes: Counter[str] = Counter()
    years: Counter[str] = Counter()
    for record in records:
        classes[class_major(record.get("class_nm"))] += 1
        years[publication_year_bucket(record.get("pub_year"))] += 1
    return {"classMajor": dict(sorted(classes.items())), "publicationYear": dict(sorted(years.items()))}


def select_dataset(input_path: Path, output_path: Path, report_path: Path, *, limit: int = 100_000) -> dict[str, Any]:
    if limit < 1:
        raise ValueError("limit must be positive")
    if not input_path.is_file():
        raise FileNotFoundError(input_path)

    rows = 0
    invalid_json_rows = 0
    missing_isbn_rows = 0
    missing_title_rows = 0
    by_isbn: dict[str, dict[str, Any]] = {}
    with _open_text(input_path, "rt") as stream:
        for line in stream:
            if not line.strip():
                continue
            rows += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                invalid_json_rows += 1
                continue
            isbn = str(record.get("isbn13") or "").strip()
            title = str(record.get("bookname") or "").strip()
            if not ISBN13_PATTERN.fullmatch(isbn):
                missing_isbn_rows += 1
                continue
            if not title:
                missing_title_rows += 1
                continue
            current = by_isbn.get(isbn)
            if current is None or _record_preference(record) > _record_preference(current):
                by_isbn[isbn] = record

    records = list(by_isbn.values())
    strata: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        key = f"{class_major(record.get('class_nm'))}::{publication_year_bucket(record.get('pub_year'))}"
        strata[key].append(record)
    counts = {key: len(value) for key, value in strata.items()}
    targets = _allocate_targets(counts, limit)
    selected: list[dict[str, Any]] = []
    for key in sorted(strata):
        selected.extend(sorted(strata[key], key=lambda record: (-_loan_total(record), str(record.get("isbn13"))))[: targets[key]])
    selected.sort(key=lambda record: str(record.get("isbn13")))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with _open_text(output_path, "wt") as stream:
        for record in selected:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")

    report = {
        "schemaVersion": 1,
        "selectionVersion": SELECTION_VERSION,
        "status": "SUCCESS",
        "inputPath": str(input_path),
        "outputPath": str(output_path),
        "limit": limit,
        "inputRows": rows,
        "invalidJsonRows": invalid_json_rows,
        "missingIsbnRows": missing_isbn_rows,
        "missingTitleRows": missing_title_rows,
        "eligibleUniqueRows": len(records),
        "selectedRows": len(selected),
        "omittedRows": max(0, len(records) - len(selected)),
        "selectionCriteria": {
            "strata": "classMajor x publicationYearBucket",
            "withinStratum": "loan_total descending, isbn13 ascending",
            "duplicateIsbn": "keep highest loan_total, then richest metadata",
        },
        "stratumInputCounts": dict(sorted(counts.items())),
        "stratumSelectedCounts": {
            key: value for key, value in sorted(((key, targets[key]) for key in targets), key=lambda item: item[0]) if value
        },
        "inputDistribution": _distribution(records),
        "selectedDistribution": _distribution(selected),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Select a deterministic, distribution-aware MVP dataset.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=100_000)
    args = parser.parse_args()
    report = select_dataset(args.input, args.output, args.report, limit=args.limit)
    print(json.dumps({"status": report["status"], "selectedRows": report["selectedRows"], "report": str(args.report)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
