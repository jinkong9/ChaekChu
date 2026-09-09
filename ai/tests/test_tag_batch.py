from __future__ import annotations

import json
from pathlib import Path

from recommendation.tag_batch import GmsTagProvider
from recommendation.d4l import load_d4l_jsonl
from recommendation.tag_batch import (
    RuleBasedTagger,
    TagBatchRunner,
    TagGenerator,
    TAXONOMY,
    TAXONOMY_VERSION,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def test_taxonomy_is_controlled_and_rule_mapping_uses_supported_fields_only() -> None:
    books = load_d4l_jsonl(FIXTURE)
    tags = RuleBasedTagger(reference_year=2026).generate(books[0])

    assert len({definition.code for definition in TAXONOMY}) == len(TAXONOMY)
    assert {tag.code for tag in tags} == {"FIC"}
    assert all(tag.source == "RULE" for tag in tags)
    assert all(0 <= tag.confidence <= 1 for tag in tags)


def test_gms_suggestions_are_filtered_and_rule_evidence_wins_confidence_ties() -> None:
    book = load_d4l_jsonl(FIXTURE)[0]

    class Provider:
        def generate(self, _book):
            return {"FIC": 0.92, "FANTASY": 0.81, "UNKNOWN": 0.99, "NEW_BOOK": 0.8}

    result = TagGenerator(gms_provider=Provider()).generate(book)

    by_code = {tag.code: tag for tag in result.tags}
    assert by_code["FIC"].source == "RULE"
    assert by_code["FANTASY"].source == "GMS"
    assert "UNKNOWN" not in by_code
    assert result.gms_attempts == 1
    assert result.gms_error is None


def test_gms_tag_provider_parses_openai_compatible_json_without_leaking_source() -> None:
    captured: dict[str, object] = {}

    class Response:
        def read(self) -> bytes:
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "tags": [
                                            {"code": "FANTASY", "confidence": 0.91},
                                            {"code": "NOT_ALLOWED", "confidence": 1.0},
                                            {"code": "FIC", "confidence": 1.2},
                                        ]
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def opener(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["authorization"] = request.headers["Authorization"]
        captured["timeout"] = timeout
        return Response()

    book = load_d4l_jsonl(FIXTURE)[0]
    provider = GmsTagProvider(
        endpoint="https://gms.example/v1/chat/completions",
        api_key="test-secret",
        model_version="gpt-test",
        timeout_seconds=4.0,
        opener=opener,
    )

    assert provider.generate(book) == {"FANTASY": 0.91}
    assert captured["authorization"] == "Bearer test-secret"
    assert captured["timeout"] == 4.0
    request_body = captured["body"]
    assert request_body["model"] == "gpt-test"
    assert request_body["temperature"] == 0
    assert "description" not in request_body["messages"][1]["content"]


def test_gms_rate_limit_or_provider_failure_retries_without_losing_rule_tags() -> None:
    book = load_d4l_jsonl(FIXTURE)[0]
    calls = 0

    class FailingProvider:
        def generate(self, _book):
            nonlocal calls
            calls += 1
            raise RuntimeError("rate limit")

    result = TagGenerator(gms_provider=FailingProvider(), max_retries=2).generate(book)

    assert calls == 3
    assert result.gms_attempts == 3
    assert result.gms_error == "rate limit"
    assert result.tags
    assert all(tag.source == "RULE" for tag in result.tags)


def test_tag_batch_writes_versioned_sidecar_and_is_restartable(tmp_path: Path) -> None:
    output = tmp_path / "tags.jsonl"
    runner = TagBatchRunner(generator=TagGenerator(), tag_version="d4l-tags-test-v1")

    first = runner.run(FIXTURE, output)
    first_bytes = output.read_bytes()
    second = runner.run(FIXTURE, output)

    assert first["status"] == "SUCCESS"
    assert first["rows"] == 4
    assert first["succeededRows"] == 4
    assert first["missingRows"] == 0
    assert first["taxonomyVersion"] == TAXONOMY_VERSION
    assert first["sourceDataCommitted"] is False
    assert second["resumedRows"] == 4
    assert second["outputHash"] == first["outputHash"]
    assert output.read_bytes() == first_bytes

    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert all(record["tagVersion"] == "d4l-tags-test-v1" for record in records)
    assert all(record["tagCodes"] == sorted(record["tagCodes"]) for record in records)
    assert all("description" not in record and "keywords" not in record for record in records)
