from fastapi.testclient import TestClient

from recommendation.api import (
    IndexedBookDnaProfileEngine,
    app,
    configure_book_dna_profile_engine,
)
from recommendation.book_dna import BookDnaRecord


class FakeBookDnaStore:
    def __init__(self) -> None:
        self.records = {
            "9780000000001": BookDnaRecord(
                "9780000000001",
                vector=(1.0, 0.0),
                tag_codes=("FICTION",),
                class_no="813.7",
            )
        }

    def get_book_dna_record(self, isbn13: str, index_version: str) -> BookDnaRecord | None:
        return self.records.get(isbn13)


def _engine() -> IndexedBookDnaProfileEngine:
    return IndexedBookDnaProfileEngine(
        record_store=FakeBookDnaStore(),
        index_version="d4l-test-v1",
        model_version="embedding-test-v1",
        tag_version="tags-test-v1",
    )


def test_book_dna_profile_endpoint_returns_contract_and_unresolved_isbns() -> None:
    previous = getattr(app.state, "book_dna_engine", None)
    configure_book_dna_profile_engine(_engine())
    try:
        response = TestClient(app).post(
            "/internal/v1/dna/profile",
            json={
                "requestId": "dna-test-1",
                "userId": "user-test-1",
                "declaredTags": ["FICTION"],
                "books": [
                    {
                        "isbn13": "9780000000001",
                        "status": "READ",
                        "rating": 5,
                        "finishedDate": "2026-01-01",
                    },
                    {"isbn13": "9780000000002", "status": "WISH"},
                ],
            },
        )
    finally:
        if previous is None:
            app.state.__dict__.pop("book_dna_engine", None)
        else:
            configure_book_dna_profile_engine(previous)

    assert response.status_code == 200
    body = response.json()
    assert body["requestId"] == "dna-test-1"
    assert body["dnaVersion"] == "book-dna-v1"
    assert body["indexVersion"] == "d4l-test-v1"
    assert body["profile"]["status"] == "READY"
    assert body["profile"]["basedOnCount"] == 1
    assert body["unresolvedIsbns"] == ["9780000000002"]
    assert "userVector" not in body["profile"]
    assert "unresolvedIsbns" not in body["profile"]


def test_book_dna_profile_endpoint_rejects_invalid_seed_shape() -> None:
    previous = getattr(app.state, "book_dna_engine", None)
    configure_book_dna_profile_engine(_engine())
    try:
        response = TestClient(app).post(
            "/internal/v1/dna/profile",
            json={
                "requestId": "dna-test-2",
                "userId": "user-test-2",
                "books": [{"isbn13": "9780000000001", "finishedAt": "2026-01-01"}],
            },
        )
    finally:
        if previous is None:
            app.state.__dict__.pop("book_dna_engine", None)
        else:
            configure_book_dna_profile_engine(previous)

    assert response.status_code == 422


def test_book_dna_profile_endpoint_returns_503_without_runtime_engine() -> None:
    previous = getattr(app.state, "book_dna_engine", None)
    app.state.__dict__.pop("book_dna_engine", None)
    try:
        response = TestClient(app).post(
            "/internal/v1/dna/profile",
            json={"requestId": "dna-test-3", "userId": "user-test-3", "books": []},
        )
    finally:
        if previous is not None:
            configure_book_dna_profile_engine(previous)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "DNA_ENGINE_UNAVAILABLE"
