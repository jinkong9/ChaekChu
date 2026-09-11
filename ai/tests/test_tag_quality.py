from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.normalization import normalized_input_hash
from recommendation.tag_quality import TagQualityError, compare_tag_sidecars


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def _write_sidecar(path: Path, records: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def _record(isbn13: str, codes: list[str]) -> dict[str, object]:
    return {
        "isbn13": isbn13,
        "inputHash": normalized_input_hash(INPUT),
        "tagCodes": codes,
        "tags": [{"code": code, "source": "RULE", "confidence": 0.9} for code in codes],
    }


def test_compare_tag_sidecars_reports_pass_and_retention(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.jsonl"
    candidate = tmp_path / "candidate.jsonl"
    baseline_records = [_record("9780000000001", ["FIC"]), _record("9780000000002", ["FANTASY"])]
    candidate_records = [_record("9780000000001", ["FIC", "GROWTH"]), _record("9780000000002", ["FANTASY"])]
    _write_sidecar(baseline, baseline_records)
    _write_sidecar(candidate, candidate_records)

    report = compare_tag_sidecars(INPUT, baseline, candidate)

    assert report["status"] == "PASS"
    assert report["baseline"]["coverage"] == 1.0
    assert report["candidate"]["tagAssignments"] == 3
    assert report["comparison"]["changedRows"] == 1
    assert report["comparison"]["tagRetention"] == 1.0
    assert report["blockingErrors"] == []


def test_compare_tag_sidecars_fails_when_candidate_coverage_drops(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.jsonl"
    candidate = tmp_path / "candidate.jsonl"
    _write_sidecar(baseline, [_record("9780000000001", ["FIC"]), _record("9780000000002", ["FANTASY"])])
    _write_sidecar(candidate, [_record("9780000000001", []) , _record("9780000000002", ["FANTASY"])])

    report = compare_tag_sidecars(INPUT, baseline, candidate)

    assert report["status"] == "FAIL"
    assert report["comparison"]["missingRowsDelta"] == 1
    assert "candidate missingRows increased beyond the allowed threshold" in report["blockingErrors"]


def test_compare_tag_sidecars_rejects_duplicate_isbn(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.jsonl"
    candidate = tmp_path / "candidate.jsonl"
    records = [_record("9780000000001", ["FIC"]), _record("9780000000001", ["FANTASY"])]
    _write_sidecar(baseline, records)
    _write_sidecar(candidate, [_record("9780000000001", ["FIC"])])

    report = compare_tag_sidecars(INPUT, baseline, candidate)

    assert report["status"] == "FAIL"
    assert "duplicate ISBN13 exists in a sidecar" in report["blockingErrors"]


def test_compare_tag_sidecars_validates_thresholds(tmp_path: Path) -> None:
    with pytest.raises(TagQualityError, match="max_coverage_drop"):
        compare_tag_sidecars(INPUT, tmp_path / "missing-baseline", tmp_path / "missing-candidate", max_coverage_drop=2)
