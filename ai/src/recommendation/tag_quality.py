from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
from typing import Any

from recommendation.normalization import normalized_input_hash


class TagQualityError(ValueError):
    """Raised when tag sidecars cannot be compared safely."""


def _load_sidecar(path: Path) -> tuple[dict[str, dict[str, Any]], int]:
    if not path.is_file():
        raise TagQualityError(f"tag sidecar was not found: {path}")
    records: dict[str, dict[str, Any]] = {}
    duplicates = 0
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise TagQualityError("tag sidecar could not be read") from error
    for line_number, line in enumerate(lines, start=1):
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise TagQualityError(f"tag sidecar contains invalid JSON at line {line_number}") from error
        if not isinstance(record, dict) or not isinstance(record.get("isbn13"), str):
            raise TagQualityError(f"tag sidecar record is invalid at line {line_number}")
        isbn13 = record["isbn13"].strip()
        if not isbn13:
            raise TagQualityError(f"tag sidecar ISBN is empty at line {line_number}")
        if isbn13 in records:
            duplicates += 1
        records[isbn13] = record
    return records, duplicates


def _codes(record: dict[str, Any]) -> set[str]:
    raw_codes = record.get("tagCodes")
    if isinstance(raw_codes, list):
        return {code for code in raw_codes if isinstance(code, str) and code}
    raw_tags = record.get("tags")
    if isinstance(raw_tags, list):
        return {
            tag["code"]
            for tag in raw_tags
            if isinstance(tag, dict) and isinstance(tag.get("code"), str) and tag["code"]
        }
    return set()


def _summary(records: dict[str, dict[str, Any]]) -> dict[str, Any]:
    missing = sum(not _codes(record) for record in records.values())
    code_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    tag_assignments = 0
    for record in records.values():
        codes = _codes(record)
        code_counts.update(codes)
        tag_assignments += len(codes)
        raw_tags = record.get("tags")
        if isinstance(raw_tags, list):
            source_counts.update(
                tag["source"]
                for tag in raw_tags
                if isinstance(tag, dict) and isinstance(tag.get("source"), str)
            )
    rows = len(records)
    return {
        "rows": rows,
        "missingRows": missing,
        "coverage": round((rows - missing) / rows, 6) if rows else 0.0,
        "tagAssignments": tag_assignments,
        "tagCodeCounts": dict(sorted(code_counts.items())),
        "sourceCounts": dict(sorted(source_counts.items())),
    }


def compare_tag_sidecars(
    input_path: Path,
    baseline_path: Path,
    candidate_path: Path,
    *,
    max_missing_increase: int = 0,
    max_coverage_drop: float = 0.0,
) -> dict[str, Any]:
    if max_missing_increase < 0:
        raise TagQualityError("max_missing_increase must not be negative")
    if not 0 <= max_coverage_drop <= 1:
        raise TagQualityError("max_coverage_drop must be between 0 and 1")

    expected_input_hash = normalized_input_hash(input_path)
    baseline, baseline_duplicates = _load_sidecar(baseline_path)
    candidate, candidate_duplicates = _load_sidecar(candidate_path)
    baseline_summary = _summary(baseline)
    candidate_summary = _summary(candidate)
    baseline_hashes = {record.get("inputHash") for record in baseline.values()}
    candidate_hashes = {record.get("inputHash") for record in candidate.values()}

    common_isbns = sorted(set(baseline) & set(candidate))
    added_isbns = sorted(set(candidate) - set(baseline))
    removed_isbns = sorted(set(baseline) - set(candidate))
    changed_rows = 0
    retained_assignments = 0
    baseline_common_assignments = 0
    for isbn13 in common_isbns:
        before = _codes(baseline[isbn13])
        after = _codes(candidate[isbn13])
        if before != after:
            changed_rows += 1
        retained_assignments += len(before & after)
        baseline_common_assignments += len(before)

    coverage_delta = round(candidate_summary["coverage"] - baseline_summary["coverage"], 6)
    missing_delta = candidate_summary["missingRows"] - baseline_summary["missingRows"]
    errors: list[str] = []
    if baseline_duplicates or candidate_duplicates:
        errors.append("duplicate ISBN13 exists in a sidecar")
    if baseline_hashes != {expected_input_hash}:
        errors.append("baseline sidecar inputHash does not match the supplied input")
    if candidate_hashes != {expected_input_hash}:
        errors.append("candidate sidecar inputHash does not match the supplied input")
    if added_isbns or removed_isbns:
        errors.append("baseline and candidate ISBN sets differ")
    if missing_delta > max_missing_increase:
        errors.append("candidate missingRows increased beyond the allowed threshold")
    if coverage_delta < -max_coverage_drop:
        errors.append("candidate coverage dropped beyond the allowed threshold")

    return {
        "status": "PASS" if not errors else "FAIL",
        "inputHash": expected_input_hash,
        "baseline": {
            "path": str(baseline_path),
            "duplicates": baseline_duplicates,
            **baseline_summary,
        },
        "candidate": {
            "path": str(candidate_path),
            "duplicates": candidate_duplicates,
            **candidate_summary,
        },
        "comparison": {
            "commonRows": len(common_isbns),
            "addedRows": len(added_isbns),
            "removedRows": len(removed_isbns),
            "changedRows": changed_rows,
            "missingRowsDelta": missing_delta,
            "coverageDelta": coverage_delta,
            "retainedTagAssignments": retained_assignments,
            "baselineCommonTagAssignments": baseline_common_assignments,
            "tagRetention": round(
                retained_assignments / baseline_common_assignments,
                6,
            )
            if baseline_common_assignments
            else 1.0,
        },
        "thresholds": {
            "maxMissingIncrease": max_missing_increase,
            "maxCoverageDrop": max_coverage_drop,
        },
        "blockingErrors": errors,
    }


__all__ = ["TagQualityError", "compare_tag_sidecars"]
