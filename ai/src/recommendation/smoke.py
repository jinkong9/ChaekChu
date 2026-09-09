from __future__ import annotations

from pathlib import Path
from typing import Any

from recommendation.d4l import load_d4l_jsonl
from recommendation.normalization import normalized_input_hash
from recommendation.quality import evaluate_weight_grid
from recommendation.tag_index import load_validated_tag_sidecar
from recommendation.validation import validate_d4l_jsonl


def _tag_report(books, sidecar) -> dict[str, Any]:
    source_isbns = {book.isbn13 for book in books}
    if sidecar is None:
        return {
            "status": "NOT_PROVIDED",
            "sidecarRows": 0,
            "taggedRows": 0,
            "missingRows": len(books),
            "lowConfidenceRows": 0,
            "outOfInputRows": 0,
            "coverage": 0.0,
        }
    source_records = [sidecar.records[isbn13] for isbn13 in source_isbns if isbn13 in sidecar.records]
    tagged_rows = sum(bool(record.tag_codes) for record in source_records)
    return {
        "status": "VALID",
        "sidecarRows": len(sidecar.records),
        "taggedRows": tagged_rows,
        "missingRows": len(books) - tagged_rows,
        "lowConfidenceRows": sum(record.low_confidence for record in source_records),
        "outOfInputRows": len(set(sidecar.records) - source_isbns),
        "coverage": round(tagged_rows / len(books), 6) if books else 0.0,
        "inputHash": sidecar.input_hash,
        "tagVersion": sidecar.tag_version,
        "taxonomyVersion": sidecar.taxonomy_version,
        "sidecarHash": sidecar.file_hash,
    }


def run_smoke(
    input_path: Path,
    *,
    tag_sidecar_path: Path | None = None,
    tag_version: str = "d4l-tags-v1",
    k: int = 5,
    recall_k: int = 10,
) -> dict[str, Any]:
    """Run deterministic source, tag, and recommendation quality checks."""
    input_hash = normalized_input_hash(input_path)
    validation = validate_d4l_jsonl(input_path)
    books = load_d4l_jsonl(input_path)
    sidecar = None
    if tag_sidecar_path is not None:
        sidecar = load_validated_tag_sidecar(
            tag_sidecar_path,
            expected_input_hash=input_hash,
            expected_tag_version=tag_version,
        )
    tag_codes = {isbn13: frozenset(record.tag_codes) for isbn13, record in sidecar.records.items()} if sidecar else None
    tuning = evaluate_weight_grid(
        books,
        tag_codes_by_isbn=tag_codes,
        input_hash=input_hash,
        k=k,
        recall_k=recall_k,
    )
    recommended = next(
        report for report in tuning["weightConfigs"] if report["name"] == tuning["recommendedConfig"]
    )
    return {
        "smokeVersion": "d4l-recommendation-smoke-v1",
        "status": "PASS" if validation["blockingErrors"] == 0 else "FAIL",
        "inputHash": input_hash,
        "rows": len(books),
        "validation": validation,
        "tags": _tag_report(books, sidecar),
        "tuning": tuning,
        "recommendedMetrics": recommended["metrics"],
    }


__all__ = ["run_smoke"]
