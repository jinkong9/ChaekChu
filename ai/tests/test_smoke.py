from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.smoke import run_smoke
from recommendation.tag_batch import TAXONOMY_VERSION


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def test_smoke_without_sidecar_reports_missing_tags_but_completes() -> None:
    report = run_smoke(SOURCE)

    assert report["status"] == "PASS"
    assert report["tags"] == {
        "status": "NOT_PROVIDED",
        "sidecarRows": 0,
        "taggedRows": 0,
        "missingRows": 4,
        "lowConfidenceRows": 0,
        "outOfInputRows": 0,
        "coverage": 0.0,
    }
    assert report["recommendedMetrics"]["evaluatedQueries"] > 0


def test_smoke_rejects_sidecar_from_another_snapshot(tmp_path: Path) -> None:
    sidecar = tmp_path / "tags.jsonl"
    sidecar.write_text(
        json.dumps(
            {
                "isbn13": "9780000000001",
                "inputHash": "wrong",
                "taxonomyVersion": TAXONOMY_VERSION,
                "tagVersion": "d4l-tags-v1",
                "tagCodes": [],
                "tagScores": {},
                "tagConfidence": {},
                "lowConfidence": False,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="inputHash"):
        run_smoke(SOURCE, tag_sidecar_path=sidecar, tag_version="d4l-tags-v1")
