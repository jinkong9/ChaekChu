from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.d4l import load_d4l_jsonl
from recommendation.quality import evaluate_weight_grid, load_tag_sidecar


ROOT = Path(__file__).resolve().parents[1]
D4L_FIXTURE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def test_weight_grid_is_deterministic_and_selects_a_config() -> None:
    books = load_d4l_jsonl(D4L_FIXTURE)

    first = evaluate_weight_grid(books, input_hash="fixture-hash")
    second = evaluate_weight_grid(books, input_hash="fixture-hash")

    assert first == second
    assert first["weightTuningVersion"] == "d4l-weight-tuning-v1"
    assert first["semanticAlgorithm"] == "tfidf-content-v1-proxy"
    assert first["recommendedConfig"] in {item["name"] for item in first["weightConfigs"]}
    assert first["recommendedWeights"] == next(
        item["weights"] for item in first["weightConfigs"] if item["name"] == first["recommendedConfig"]
    )
    for item in first["weightConfigs"]:
        metrics = item["metrics"]
        assert 0.0 <= metrics["pAt5"] <= 1.0
        assert 0.0 <= metrics["recallAt10"] <= 1.0
        assert 0.0 <= metrics["coverage"] <= 1.0
        assert 0.0 <= metrics["diversityAt5"] <= 1.0
        assert set(metrics["featureAvailability"]) == {"semantic", "tagMatch", "coLoan", "trending", "steady"}


def test_tag_sidecar_enables_tag_match_feature(tmp_path: Path) -> None:
    sidecar = tmp_path / "tags.jsonl"
    sidecar.write_text(
        "\n".join(
            json.dumps({"isbn13": isbn, "tagCodes": ["FIC"]}, ensure_ascii=False)
            for isbn in (
                "9780000000001",
                "9780000000002",
                "9780000000003",
                "9780000000004",
            )
        )
        + "\n",
        encoding="utf-8",
    )

    tags = load_tag_sidecar(sidecar)
    report = evaluate_weight_grid(load_d4l_jsonl(D4L_FIXTURE), tag_codes_by_isbn=tags)

    assert report["tagSidecarRows"] == 4
    assert all(item["metrics"]["featureAvailability"]["tagMatch"] == 1.0 for item in report["weightConfigs"])


@pytest.mark.parametrize(
    "kwargs",
    [
        {"k": 0},
        {"k": 5, "recall_k": 4},
        {"weight_configs": []},
        {"weight_configs": [{"name": "invalid", "weights": {"semantic": 1.0}}]},
    ],
)
def test_weight_grid_rejects_invalid_configuration(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        evaluate_weight_grid(load_d4l_jsonl(D4L_FIXTURE), **kwargs)
