from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.embedding import HashingTextEmbedder
from recommendation.embedding_batch import EmbeddingBatchConfig, EmbeddingBatchRunner, InMemoryVersionedIndexStore
from recommendation.normalization import normalized_input_hash
from recommendation.tag_batch import TAXONOMY_VERSION
from recommendation.tag_index import load_validated_tag_sidecar


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def _record(source: Path, isbn13: str, *, tag_version: str = "tags-test-v1", codes: list[str] | None = None) -> dict:
    codes = ["FIC"] if codes is None else codes
    scores = {code: 0.9 for code in codes}
    return {
        "isbn13": isbn13,
        "inputHash": normalized_input_hash(source),
        "taxonomyVersion": TAXONOMY_VERSION,
        "tagVersion": tag_version,
        "status": "SUCCESS" if codes else "MISSING",
        "tags": [],
        "tagCodes": codes,
        "tagScores": scores,
        "tagConfidence": scores,
        "lowConfidence": False,
        "gmsError": None,
    }


def _write_sidecar(path: Path, *records: dict) -> None:
    path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")


def test_validated_sidecar_rejects_snapshot_version_and_taxonomy_mismatch(tmp_path: Path) -> None:
    path = tmp_path / "tags.jsonl"
    record = _record(SOURCE, "9780000000001")
    _write_sidecar(path, record)

    loaded = load_validated_tag_sidecar(
        path,
        expected_input_hash=normalized_input_hash(SOURCE),
        expected_tag_version="tags-test-v1",
    )
    assert loaded.records["9780000000001"].tag_codes == ("FIC",)

    record["inputHash"] = "different-snapshot"
    _write_sidecar(path, record)
    with pytest.raises(ValueError, match="inputHash"):
        load_validated_tag_sidecar(path, expected_input_hash=normalized_input_hash(SOURCE), expected_tag_version="tags-test-v1")

    record["inputHash"] = normalized_input_hash(SOURCE)
    record["taxonomyVersion"] = "book-taxonomy-v0"
    _write_sidecar(path, record)
    with pytest.raises(ValueError, match="taxonomyVersion"):
        load_validated_tag_sidecar(path, expected_input_hash=normalized_input_hash(SOURCE), expected_tag_version="tags-test-v1")


def test_validated_sidecar_rejects_duplicate_and_unknown_codes(tmp_path: Path) -> None:
    path = tmp_path / "tags.jsonl"
    first = _record(SOURCE, "9780000000001")
    _write_sidecar(path, first, first)
    with pytest.raises(ValueError, match="duplicate isbn13"):
        load_validated_tag_sidecar(path, expected_input_hash=normalized_input_hash(SOURCE), expected_tag_version="tags-test-v1")

    unknown = _record(SOURCE, "9780000000002", codes=["NOT_A_TAG"])
    _write_sidecar(path, unknown)
    with pytest.raises(ValueError, match="unknown tag code"):
        load_validated_tag_sidecar(path, expected_input_hash=normalized_input_hash(SOURCE), expected_tag_version="tags-test-v1")


def test_embedding_batch_copies_matching_tags_and_reports_missing_or_out_of_input_rows(tmp_path: Path) -> None:
    sidecar = tmp_path / "tags.jsonl"
    matching = _record(SOURCE, "9780000000001")
    missing = _record(SOURCE, "9780000000002", codes=[])
    extra = _record(SOURCE, "9780000000099")
    _write_sidecar(sidecar, matching, missing, extra)
    validated = load_validated_tag_sidecar(
        sidecar,
        expected_input_hash=normalized_input_hash(SOURCE),
        expected_tag_version="tags-test-v1",
    )

    store = InMemoryVersionedIndexStore()
    report = EmbeddingBatchRunner(
        embedder=HashingTextEmbedder(dimension=8),
        store=store,
        config=EmbeddingBatchConfig(index_version="index-with-tags-v1", tag_version="tags-test-v1", batch_size=2),
        tag_payloads=validated.records,
        tag_sidecar_hash=validated.file_hash,
    ).run(SOURCE)

    tagged = store.get("index-with-tags-v1", "9780000000001")
    untagged = store.get("index-with-tags-v1", "9780000000002")
    assert report["status"] == "PROMOTED"
    assert report["tagSidecarRows"] == 3
    assert report["taggedRows"] == 1
    assert report["missingTagRows"] == 3
    assert report["outOfInputTagRows"] == 1
    assert tagged is not None and tagged.payload["tagCodes"] == ["FIC"]
    assert tagged.payload["tagScores"] == {"FIC": 0.9}
    assert untagged is not None and untagged.payload["tagCodes"] == []
