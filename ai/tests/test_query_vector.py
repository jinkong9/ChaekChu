from __future__ import annotations

import pytest

from recommendation.query_vector import (
    DEFAULT_TAG_CODES,
    InMemoryQueryVectorStore,
    QueryVectorBuilder,
    QueryVectorReason,
    QueryVectorStatus,
)
from recommendation.tag_batch import TAXONOMY


def test_online_default_tag_codes_are_exactly_the_batch_taxonomy() -> None:
    # 손으로 복사한 목록이 taxonomy 확장 때 빠져 새 태그가 unknown 으로 버려지던 문제를 막는다
    assert DEFAULT_TAG_CODES == frozenset(definition.code for definition in TAXONOMY)
    assert {"HUMANITIES", "ART", "SOCIETY", "POETRY", "TRAVEL", "TECH"} <= DEFAULT_TAG_CODES


def _builder() -> QueryVectorBuilder:
    return QueryVectorBuilder(
        InMemoryQueryVectorStore(
            index_version="d4l-index-v1",
            book_vectors={"9780000000001": (1.0, 0.0), "9780000000002": (0.0, 1.0)},
            tag_vectors={"FANTASY": (1.0, 1.0), "GROWTH": (0.0, 2.0)},
        ),
        index_version="d4l-index-v1",
        allowed_tag_codes={"FANTASY", "GROWTH"},
    )


def test_seed_and_tag_vectors_are_combined_by_request_weights() -> None:
    result = _builder().build(
        seed_isbns=["9780000000001"],
        tags={"FANTASY": 1},
        weights={"semantic": 0.75, "tagMatch": 0.25},
    )

    assert result.status is QueryVectorStatus.PERSONALIZED
    assert result.reason is QueryVectorReason.READY
    assert result.query_vector == (1.0, 0.25)
    assert result.used_seed_isbns == ("9780000000001",)
    assert result.used_tag_codes == ("FANTASY",)


def test_same_inputs_and_index_version_are_deterministic() -> None:
    first = _builder().build(seed_isbns=["9780000000002", "9780000000001"], tags={"GROWTH": 0.5, "FANTASY": 1})
    second = _builder().build(seed_isbns=["9780000000002", "9780000000001"], tags={"GROWTH": 0.5, "FANTASY": 1})

    assert first == second


def test_unknown_and_missing_sources_are_recorded_without_gms_call() -> None:
    builder = QueryVectorBuilder(
        InMemoryQueryVectorStore(
            index_version="d4l-index-v1",
            book_vectors={"9780000000001": (1.0, 0.0)},
            tag_vectors={},
        ),
        index_version="d4l-index-v1",
        allowed_tag_codes={"FANTASY", "ROMANCE"},
    )
    result = builder.build(
        seed_isbns=["9780000000099", "9780000000001"],
        tags={"UNKNOWN": 1, "ROMANCE": 1},
    )

    assert result.status is QueryVectorStatus.PERSONALIZED
    assert result.query_vector == (1.0, 0.0)
    assert result.missing_seed_isbns == ("9780000000099",)
    assert result.unknown_tag_codes == ("UNKNOWN",)
    assert result.missing_tag_codes == ("ROMANCE",)


def test_no_seed_or_tag_switches_to_cold_start() -> None:
    result = _builder().build(mode="COLD_START")

    assert result.status is QueryVectorStatus.COLD_START
    assert result.reason is QueryVectorReason.NO_SEED_OR_TAG
    assert result.query_vector is None


def test_missing_seed_and_zero_weight_tag_have_no_usable_vector() -> None:
    result = _builder().build(seed_isbns=["9780000000099"], tags={"FANTASY": 0})

    assert result.status is QueryVectorStatus.COLD_START
    assert result.reason is QueryVectorReason.NO_USABLE_VECTOR
    assert result.missing_seed_isbns == ("9780000000099",)


def test_invalid_weights_and_vector_dimensions_are_rejected() -> None:
    with pytest.raises(ValueError, match="unknown query weights"):
        _builder().build(weights={"taste": 1})
    with pytest.raises(ValueError, match="non-negative"):
        _builder().build(tags={"FANTASY": -1})

    broken = QueryVectorBuilder(
        InMemoryQueryVectorStore(
            index_version="d4l-index-v1",
            book_vectors={"9780000000001": (1.0, 0.0)},
            tag_vectors={"FANTASY": (1.0, 0.0, 0.0)},
        ),
        index_version="d4l-index-v1",
        allowed_tag_codes={"FANTASY"},
    )
    with pytest.raises(ValueError, match="same dimension"):
        broken.build(seed_isbns=["9780000000001"], tags={"FANTASY": 1})
