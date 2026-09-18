from datetime import date

import pytest
from fastapi.testclient import TestClient

from recommendation.api import IndexedBookDnaProfileEngine, app, configure_book_dna_profile_engine
from recommendation.book_dna import BookDnaRecord, UserBookSeed, build_book_dna_profile


def _seed(isbn: str, *, status: str = "READ", rating: int | None = 5) -> UserBookSeed:
    return UserBookSeed(isbn, status=status, rating=rating, finished_date=date(2026, 1, 1))  # type: ignore[arg-type]


def test_profile_score_contract_stays_bounded_and_axes_are_normalized() -> None:
    records = {
        "9780000000001": BookDnaRecord(
            "9780000000001", vector=(1.0, 0.0), tag_codes=("FICTION", "FAMILY"), class_no="813.7"
        ),
        "9780000000002": BookDnaRecord(
            "9780000000002", vector=(0.0, 1.0), tag_codes=("SCIENCE", "TECH"), class_no="400"
        ),
    }
    profile = build_book_dna_profile(
        [_seed("9780000000001", rating=5), _seed("9780000000002", rating=3)],
        records,
        today=date(2026, 1, 1),
    )

    assert profile.status == "READY"
    assert {item.code for item in profile.axes} == {
        "FICTION", "ESSAY", "HUMANITIES", "BUSINESS", "SCIENCE", "ART_HISTORY"
    }
    assert sum(item.score for item in profile.axes) == pytest.approx(100.0)
    for score in (*profile.axes, *profile.metrics, *profile.keywords):
        assert 0.0 <= score.score <= 100.0
    assert set(profile.evidence.top_tags) == {"FICTION", "FAMILY", "SCIENCE", "TECH"}


def test_only_wish_books_do_not_create_read_evidence_or_profile_type() -> None:
    profile = build_book_dna_profile(
        [_seed("9780000000001", status="WISH", rating=None)],
        {"9780000000001": BookDnaRecord("9780000000001", tag_codes=("FICTION",), class_no="813")},
        today=date(2026, 1, 1),
    )

    assert profile.status == "READY"
    assert profile.based_on_count == 0
    assert profile.evidence.read_book_count == 0
    assert profile.evidence.rated_book_count == 0


class _EmptyRecordStore:
    def get_book_dna_record(self, isbn13: str, index_version: str) -> BookDnaRecord | None:
        return None


class _EmptyEngine:
    model_version = "embedding-test-v1"
    index_version = "index-test-v1"
    tag_version = "tags-test-v1"

    def profile(self, request):
        return IndexedBookDnaProfileEngine(
            record_store=_EmptyRecordStore(),
            index_version=self.index_version,
            model_version=self.model_version,
            tag_version=self.tag_version,
        ).profile(request)


def test_endpoint_returns_insufficient_data_for_empty_or_unresolved_books() -> None:
    previous = getattr(app.state, "book_dna_engine", None)
    configure_book_dna_profile_engine(_EmptyEngine())
    try:
        response = TestClient(app).post(
            "/internal/v1/dna/profile",
            json={
                "requestId": "dna-quality-empty",
                "userId": "quality-user",
                "declaredTags": ["FICTION"],
                "books": [{"isbn13": "9780000000001", "status": "READ"}],
            },
        )
    finally:
        if previous is None:
            app.state._state.pop("book_dna_engine", None)
        else:
            configure_book_dna_profile_engine(previous)

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["status"] == "INSUFFICIENT_DATA"
    assert body["profile"]["basedOnCount"] == 0
    assert body["unresolvedIsbns"] == ["9780000000001"]
    assert all(item["score"] == 0.0 for item in body["profile"]["axes"])


@pytest.mark.parametrize(
    "declared_tags",
    [
        ["fiction"],
        ["FICTION", "FICTION"],
    ],
)
def test_endpoint_rejects_noncanonical_or_duplicate_declared_tags(declared_tags: list[str]) -> None:
    response = TestClient(app).post(
        "/internal/v1/dna/profile",
        json={
            "requestId": "dna-quality-invalid-tags",
            "userId": "quality-user",
            "declaredTags": declared_tags,
            "books": [],
        },
    )

    assert response.status_code == 422
