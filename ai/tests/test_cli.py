from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from recommendation.api import app
from recommendation.cli import create_parser, main, run
from recommendation.config import ConfigError, load_config
from recommendation.d4l import load_d4l_jsonl
from recommendation.baseline import evaluate_content, recommend_content
from recommendation.validation import validate_d4l_jsonl


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "local.toml"
FIXTURE = ROOT / "tests" / "fixtures" / "books.jsonl"
D4L_FIXTURE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def parse(*arguments: str):
    return create_parser().parse_args(["--config", str(CONFIG), *arguments])


@pytest.mark.parametrize("command", ["build", "evaluate"])
def test_commands_create_artifact(command: str, tmp_path: Path) -> None:
    output = tmp_path / f"{command}.json"
    result = run(parse(command, "--input", str(FIXTURE), "--output", str(output)))

    artifact = json.loads(result.read_text(encoding="utf-8"))
    assert artifact["command"] == command
    assert artifact["schemaVersion"] == 1
    assert len(artifact["inputHash"]) == 64
    assert len(artifact["artifactHash"]) == 64


def test_recommend_includes_user_id(tmp_path: Path) -> None:
    output = tmp_path / "recommend.json"
    run(
        parse(
            "recommend",
            "--input",
            str(FIXTURE),
            "--output",
            str(output),
            "--user-id",
            "fixture-user",
        )
    )
    assert json.loads(output.read_text(encoding="utf-8"))["userId"] == "fixture-user"


def test_same_seed_and_input_produce_identical_bytes(tmp_path: Path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    run(parse("build", "--input", str(FIXTURE), "--output", str(first)))
    run(parse("build", "--input", str(FIXTURE), "--output", str(second)))
    assert first.read_bytes() == second.read_bytes()


def test_missing_config_does_not_echo_path_or_secret(capsys: pytest.CaptureFixture[str]) -> None:
    secret_path = "secret-token-must-not-leak.toml"
    with pytest.raises(SystemExit) as error:
        main(["--config", secret_path, "build", "--input", str(FIXTURE)])
    assert error.value.code == 2
    assert secret_path not in capsys.readouterr().err


def test_invalid_seed_is_rejected(tmp_path: Path) -> None:
    config = tmp_path / "invalid.toml"
    config.write_text(
        '[runtime]\nseed = -1\noutput_dir = "output"\nlog_file = "logs/test.log"\n',
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="runtime.seed"):
        load_config(config)


def test_d4l_sample_loads_with_expected_source_fields() -> None:
    books = load_d4l_jsonl(D4L_FIXTURE)

    assert len(books) == 4
    assert sum(bool(book.co_loan) for book in books) == 4
    assert sum(bool(book.description) for book in books) == 3


def test_content_recommendation_excludes_query_and_is_deterministic() -> None:
    books = load_d4l_jsonl(D4L_FIXTURE)
    query = "9780000000001"

    first = recommend_content(books, query, limit=3)
    second = recommend_content(books, query, limit=3)

    assert first == second
    assert len(first) == 3
    assert all(item["isbn13"] != query for item in first)


def test_sample_evaluation_reports_content_and_popular_baselines() -> None:
    report = evaluate_content(load_d4l_jsonl(D4L_FIXTURE))

    assert report["evaluatedQueries"] > 0
    assert 0.0 <= report["targetCoverage"] <= 1.0
    assert 0.0 <= report["pAt10"] <= 1.0
    assert 0.0 <= report["popularPAt10"] <= 1.0


def test_different_queries_produce_different_artifact_hashes(tmp_path: Path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    run(
        parse(
            "recommend",
            "--input",
            str(D4L_FIXTURE),
            "--output",
            str(first),
            "--user-id",
            "fixture-user",
            "--query-isbn",
            "9780000000001",
        )
    )
    run(
        parse(
            "recommend",
            "--input",
            str(D4L_FIXTURE),
            "--output",
            str(second),
            "--user-id",
            "fixture-user",
            "--query-isbn",
            "9780000000002",
        )
    )

    assert json.loads(first.read_text(encoding="utf-8"))["artifactHash"] != json.loads(
        second.read_text(encoding="utf-8")
    )["artifactHash"]


def test_d4l_contract_validation_reports_real_sample_quality() -> None:
    report = validate_d4l_jsonl(D4L_FIXTURE)

    assert report["contract"] == "d4l-usage-v1"
    assert report["rows"] == 4
    assert report["status"] == "PASS"
    assert report["blockingErrors"] == 0
    assert report["warnings"] > 0


def test_d4l_contract_validation_detects_duplicate_and_invalid_loan_total(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.jsonl"
    invalid.write_text(
        '{"isbn13":"9780000000002","bookname":"A","loan_total":0}\n'
        '{"isbn13":"9780000000002","bookname":"B","loan_total":-1}\n',
        encoding="utf-8",
    )

    report = validate_d4l_jsonl(invalid)

    assert report["status"] == "FAIL"
    assert report["blockingErrors"] >= 2
    assert report["ruleCounts"]["isbn13_duplicate"] == 1
    assert report["ruleCounts"]["loan_total_invalid"] == 1


def test_validate_command_writes_failure_report_before_exiting(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.jsonl"
    output = tmp_path / "validation.json"
    invalid.write_text('{"isbn13":"bad","bookname":"A","loan_total":-1}\n', encoding="utf-8")

    with pytest.raises(ConfigError, match="blocking error"):
        run(parse("validate", "--input", str(invalid), "--output", str(output)))

    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["validation"]["status"] == "FAIL"
    assert report["validation"]["blockingErrors"] >= 2


def test_recommendation_api_returns_backend_contract() -> None:
    client = TestClient(app)
    response = client.post(
        "/internal/v1/recommendations",
        json={
            "requestId": "req-test-1",
            "userId": "user-test-1",
            "mode": "PERSONALIZED",
            "candidateVersion": "fixture-v1",
            "seedBookIds": ["book-1"],
            "excludeBookIds": ["book-4"],
            "candidates": [
                {
                    "bookId": "book-1",
                    "isbn13": "9780000000001",
                    "title": "달빛 정원",
                    "authors": ["김하늘"],
                    "description": "성장과 정원 이야기",
                    "keywords": ["성장", "정원"],
                    "loan24m": 100,
                    "loan3m": 20,
                },
                {
                    "bookId": "book-2",
                    "isbn13": "9780000000002",
                    "title": "바람의 지도",
                    "authors": ["이바다"],
                    "description": "여행과 성장 이야기",
                    "keywords": ["여행", "성장"],
                    "loan24m": 80,
                    "loan3m": 15,
                },
                {
                    "bookId": "book-3",
                    "isbn13": "9780000000003",
                    "title": "파도 너머",
                    "authors": ["박해빛"],
                    "description": "바다와 우정 이야기",
                    "keywords": ["바다", "우정"],
                    "loan24m": 70,
                    "loan3m": 10,
                },
                {
                    "bookId": "book-4",
                    "isbn13": "9780000000004",
                    "title": "우리가 걷는 길",
                    "authors": ["최새봄"],
                    "description": "관계와 회복 이야기",
                    "keywords": ["관계", "회복"],
                    "loan24m": 60,
                    "loan3m": 8,
                },
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["userId"] == "user-test-1"
    assert body["mode"] == "PERSONALIZED"
    assert body["fallback"] is False
    assert len(body["items"]) == 2
    assert all(item["book"]["bookId"] != "book-4" for item in body["items"])
    assert [item["rank"] for item in body["items"]] == [1, 2]


def test_recommendation_api_rejects_duplicate_candidate_ids() -> None:
    client = TestClient(app)
    payload = {
        "requestId": "req-test-2",
        "userId": "user-test-2",
        "mode": "COLD_START",
        "candidateVersion": "fixture-v1",
        "candidates": [
            {"bookId": "book-1", "isbn13": "9780000000001", "title": "A"},
            {"bookId": "book-1", "isbn13": "9780000000002", "title": "B"},
        ],
    }

    response = client.post("/internal/v1/recommendations", json=payload)

    assert response.status_code == 422

