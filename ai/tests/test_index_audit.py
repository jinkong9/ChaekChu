from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError, URLError
import uuid

import pytest

from recommendation import cli
from recommendation.config import ConfigError
from recommendation.index_audit import IndexAuditConfig, QdrantIndexAuditor


class _Response:
    def __init__(self, payload: dict):
        self.payload = payload

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def _config(**overrides) -> IndexAuditConfig:
    values = {
        "base_url": "http://qdrant:6333",
        "book_alias": "books_active",
        "tag_alias": "tags_active",
        "index_version": "index-v1",
        "tag_version": "tags-v1",
        "dimension": 4,
        "api_key": "secret-test-key",
    }
    values.update(overrides)
    return IndexAuditConfig(**values)


def _fake_qdrant(
    *, book_index_version="index-v1", book_tag_version="tags-v1", book_dimension=4,
    collection_dimension=4, missing_tags=(),
):
    config = _config()
    tags = ("FICTION", "SCIENCE")
    book_point = {
        "id": "book-point",
        "vector": [0.1] * book_dimension,
        "payload": {
            "isbn13": "9780000000001",
            "indexVersion": book_index_version,
            "tagVersion": book_tag_version,
            "active": True,
        },
    }
    tag_points = []
    for code in tags:
        if code in missing_tags:
            continue
        tag_points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{config.index_version}:tag:{code}")),
            "vector": [0.2] * 4,
            "payload": {
                "tagCode": code,
                "indexVersion": config.index_version,
                "tagVersion": config.tag_version,
            },
        })
    requests: list[tuple[str, str, dict | None]] = []

    def opener(request, timeout):
        body = json.loads(request.data.decode("utf-8")) if request.data else None
        requests.append((request.method, request.full_url, body))
        if request.full_url.endswith("/collections/aliases"):
            return _Response({"result": {"aliases": [
                {"alias_name": "books_active", "collection_name": "books_v1"},
                {"alias_name": "tags_active", "collection_name": "tags_v1"},
            ]}})
        if request.method == "GET" and "/collections/" in request.full_url:
            dimension = collection_dimension if "/books_v1" in request.full_url else 4
            return _Response({"result": {
                "config": {"params": {"vectors": {"size": dimension, "distance": "Cosine"}}},
                "points_count": 1,
                "status": "green",
            }})
        if request.full_url.endswith("/points/scroll"):
            return _Response({"result": {"points": [book_point]}})
        if request.full_url.endswith("/points") and request.method == "POST":
            requested = set(body["ids"])
            return _Response({"result": [point for point in tag_points if point["id"] in requested]})
        raise AssertionError(f"unexpected request: {request.method} {request.full_url}")

    return config, tags, requests, opener


def test_audit_passes_and_never_mutates_qdrant_or_returns_api_key() -> None:
    config, tags, requests, opener = _fake_qdrant()

    report = QdrantIndexAuditor(config, opener=opener).audit(tag_codes=tags)

    assert report["status"] == "PASS"
    assert report["failureCount"] == 0
    assert report["indexVersion"] == "index-v1"
    assert report["tagVersion"] == "tags-v1"
    assert all(method in {"GET", "POST"} for method, _url, _body in requests)
    assert all(not any(word in json.dumps(check) for word in ("secret-test-key",)) for check in report["checks"])
    assert any(url.endswith("/points/scroll") for _method, url, _body in requests)


def test_audit_reports_book_tag_version_mismatch_and_missing_tag() -> None:
    config, tags, _requests, opener = _fake_qdrant(book_tag_version="old-tags", missing_tags={"SCIENCE"})

    report = QdrantIndexAuditor(config, opener=opener).audit(tag_codes=tags)

    failures = {check["code"] for check in report["checks"] if check["status"] == "FAIL"}
    assert report["status"] == "FAIL"
    assert "TAG_VERSION_MISMATCH" in failures
    assert "TAG_POINT_MISSING" in failures


def test_audit_reports_book_index_version_mismatch() -> None:
    config, tags, _requests, opener = _fake_qdrant(book_index_version="previous-index")

    report = QdrantIndexAuditor(config, opener=opener).audit(tag_codes=tags)

    assert report["status"] == "FAIL"
    assert any(check["code"] == "INDEX_VERSION_MISMATCH" for check in report["checks"])


def test_audit_reports_dimension_mismatch() -> None:
    config, tags, _requests, opener = _fake_qdrant(collection_dimension=1536)

    report = QdrantIndexAuditor(config, opener=opener).audit(tag_codes=tags)

    assert report["status"] == "FAIL"
    assert any(check["code"] == "DIMENSION_MISMATCH" for check in report["checks"])


def test_audit_reports_qdrant_unauthorized_without_leaking_response() -> None:
    def opener(request, timeout):
        raise HTTPError(request.full_url, 401, "unauthorized", {}, None)

    report = QdrantIndexAuditor(_config(), opener=opener).audit(tag_codes=("FICTION",))

    assert report["status"] == "FAIL"
    assert report["checks"][0]["code"] == "QDRANT_UNAUTHORIZED"
    assert "secret-test-key" not in json.dumps(report)


def test_audit_reports_qdrant_connection_failure() -> None:
    def opener(request, timeout):
        raise URLError("connection refused")

    report = QdrantIndexAuditor(_config(), opener=opener).audit(tag_codes=("FICTION",))

    assert report["status"] == "FAIL"
    assert report["checks"][0]["code"] == "QDRANT_UNAVAILABLE"


def test_audit_cli_does_not_need_dataset_or_runtime_config(tmp_path: Path, monkeypatch) -> None:
    output = tmp_path / "audit.json"

    class _Auditor:
        def __init__(self, config):
            assert config.index_version == "index-v1"

        def audit(self, *, tag_codes):
            return {"status": "PASS", "checks": [], "auditedTagCodes": list(tag_codes)}

    monkeypatch.setattr(cli, "QdrantIndexAuditor", _Auditor)
    monkeypatch.setenv("QDRANT_URL", "http://qdrant:6333")
    monkeypatch.setenv("AI_INDEX_VERSION", "index-v1")
    monkeypatch.setenv("AI_TAG_VERSION", "tags-v1")
    monkeypatch.setenv("EMBEDDING_DIMENSION", "4")
    args = cli.create_parser().parse_args(["--config", str(tmp_path / "not-present.toml"), "audit-index", "--tag-code", "FICTION", "--output", str(output)])

    result = cli.run(args)

    report = json.loads(result.read_text(encoding="utf-8"))
    assert result == output
    assert report["indexAudit"]["status"] == "PASS"
    assert report["indexAudit"]["auditedTagCodes"] == ["FICTION"]


def test_audit_cli_writes_failure_report_before_returning_nonzero(tmp_path: Path, monkeypatch) -> None:
    output = tmp_path / "audit-failed.json"

    class _Auditor:
        def __init__(self, config):
            pass

        def audit(self, *, tag_codes):
            return {"status": "FAIL", "checks": [{"code": "BOOK_ALIAS_MISSING"}]}

    monkeypatch.setattr(cli, "QdrantIndexAuditor", _Auditor)
    monkeypatch.setenv("QDRANT_URL", "http://qdrant:6333")
    monkeypatch.setenv("AI_INDEX_VERSION", "index-v1")
    monkeypatch.setenv("AI_TAG_VERSION", "tags-v1")
    args = cli.create_parser().parse_args(["audit-index", "--output", str(output)])

    with pytest.raises(ConfigError, match="index audit failed"):
        cli.run(args)

    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["indexAudit"]["status"] == "FAIL"
