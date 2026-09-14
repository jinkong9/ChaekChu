from __future__ import annotations

import json
from dataclasses import replace
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

    result = TagGenerator(gms_provider=Provider(), rule_confidence_threshold=0.95).generate(book)

    by_code = {tag.code: tag for tag in result.tags}
    assert by_code["FIC"].source == "RULE"
    assert by_code["FANTASY"].source == "GMS"
    assert "UNKNOWN" not in by_code
    assert result.gms_attempts == 1
    assert result.gms_error is None


def test_confident_rule_tags_skip_gms_and_are_reported() -> None:
    book = load_d4l_jsonl(FIXTURE)[0]
    calls = 0

    class Provider:
        def generate(self, _book):
            nonlocal calls
            calls += 1
            return {"FANTASY": 1.0}

    result = TagGenerator(gms_provider=Provider()).generate(book)

    assert calls == 0
    assert result.gms_attempts == 0
    assert result.gms_skipped is True
    assert result.gms_skip_reason == "RULE_CONFIDENT"
    assert all(tag.source == "RULE" for tag in result.tags)


def test_rule_tagger_derives_loan_signal_tags_locally() -> None:
    book = load_d4l_jsonl(FIXTURE)[0]
    trending = replace(
        book,
        loan_history=(
            ("2026년 01월", 10, 1),
            ("2026년 02월", 10, 1),
            ("2026년 03월", 10, 1),
            ("2026년 04월", 25, 1),
        ),
    )
    steady = replace(
        book,
        loan_history=(
            ("2026년 01월", 10, 1),
            ("2026년 02월", 11, 1),
            ("2026년 03월", 9, 1),
            ("2026년 04월", 10, 1),
        ),
    )

    trending_tags = {tag.code: tag for tag in RuleBasedTagger().generate(trending)}
    steady_tags = {tag.code: tag for tag in RuleBasedTagger().generate(steady)}

    assert trending_tags["TRENDING"].source == "RULE"
    assert trending_tags["TRENDING"].confidence >= 0.85
    assert steady_tags["STEADY"].source == "RULE"
    assert steady_tags["STEADY"].confidence >= 0.85


def test_tag_batch_report_counts_skipped_rows_and_keeps_sidecar_metadata(tmp_path: Path) -> None:
    calls = 0

    class Provider:
        def generate(self, _book):
            nonlocal calls
            calls += 1
            return {"FANTASY": 1.0}

    output = tmp_path / "tags.jsonl"
    report = TagBatchRunner(
        generator=TagGenerator(gms_provider=Provider()),
        tag_version="d4l-tags-selective-test-v1",
    ).run(FIXTURE, output)

    assert calls == 0
    assert report["gmsAttempts"] == 0
    assert report["gmsSkippedRows"] == 4
    assert report["ruleConfidenceThreshold"] == 0.85
    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert all(record["gmsSkipped"] is True for record in records)
    assert all(record["gmsSkipReason"] == "RULE_CONFIDENT" for record in records)


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


def test_gms_tag_provider_parses_batch_response_by_isbn() -> None:
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
                                        "books": [
                                            {"isbn13": "9780000000002", "tags": [{"code": "FANTASY", "confidence": 0.91}]},
                                            {"isbn13": "9780000000001", "tags": [{"code": "FIC", "confidence": 0.93}]},
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
        captured["timeout"] = timeout
        return Response()

    books = load_d4l_jsonl(FIXTURE)[:2]
    provider = GmsTagProvider(
        endpoint="https://gms.example/v1/chat/completions",
        api_key="test-secret",
        model_version="gpt-test",
        opener=opener,
    )

    suggestions = provider.generate_batch(books)

    assert suggestions == {
        "9780000000001": {"FIC": 0.93},
        "9780000000002": {"FANTASY": 0.91},
    }
    request_body = captured["body"]
    assert request_body["model"] == "gpt-test"
    user_content = json.loads(request_body["messages"][1]["content"])
    assert [book["isbn13"] for book in user_content["books"]] == [
        "9780000000001",
        "9780000000002",
    ]
    assert all("description" not in book for book in user_content["books"])


def test_tag_batch_uses_multi_book_provider_and_reports_request_counts(tmp_path: Path) -> None:
    calls: list[tuple[str, ...]] = []

    class EmptyRuleTagger:
        def generate(self, _book):
            return ()

    class BatchProvider:
        def generate_batch(self, books):
            calls.append(tuple(book.isbn13 for book in books))
            return {book.isbn13: {"FANTASY": 0.9} for book in books}

    output = tmp_path / "tags.jsonl"
    report = TagBatchRunner(
        generator=TagGenerator(rule_tagger=EmptyRuleTagger(), gms_provider=BatchProvider()),
        tag_version="d4l-tags-batch-test-v1",
        batch_size=2,
    ).run(FIXTURE, output)

    assert len(calls) == 2
    assert all(len(batch) == 2 for batch in calls)
    assert report["gmsRequests"] == 2
    assert report["gmsBatchRequests"] == 2
    assert report["gmsAttempts"] == 4
    assert report["gmsFailures"] == 0
    assert report["gmsSkippedRows"] == 0
    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert all(record["tagCodes"] == ["FANTASY"] for record in records)


def test_tag_batch_falls_back_to_individual_calls_after_batch_failure(tmp_path: Path) -> None:
    batch_calls = 0
    individual_calls = 0

    class EmptyRuleTagger:
        def generate(self, _book):
            return ()

    class FallbackProvider:
        def generate_batch(self, _books):
            nonlocal batch_calls
            batch_calls += 1
            raise RuntimeError("batch unavailable")

        def generate(self, _book):
            nonlocal individual_calls
            individual_calls += 1
            return {"FANTASY": 0.9}

    output = tmp_path / "tags.jsonl"
    report = TagBatchRunner(
        generator=TagGenerator(
            rule_tagger=EmptyRuleTagger(),
            gms_provider=FallbackProvider(),
            max_retries=1,
        ),
        tag_version="d4l-tags-batch-fallback-test-v1",
        batch_size=2,
    ).run(FIXTURE, output)

    assert batch_calls == 4
    assert individual_calls == 4
    assert report["gmsBatchRequests"] == 4
    assert report["gmsRequests"] == 8
    assert report["gmsFailures"] == 0
    assert report["missingRows"] == 0


def test_gms_rate_limit_or_provider_failure_retries_without_losing_rule_tags() -> None:
    book = load_d4l_jsonl(FIXTURE)[0]
    calls = 0

    class FailingProvider:
        def generate(self, _book):
            nonlocal calls
            calls += 1
            raise RuntimeError("rate limit")

    result = TagGenerator(
        gms_provider=FailingProvider(),
        max_retries=2,
        rule_confidence_threshold=0.95,
    ).generate(book)

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


def test_tag_cache_reuses_results_across_tag_versions(tmp_path: Path) -> None:
    calls = 0

    class EmptyRuleTagger:
        def generate(self, _book):
            return ()

    class Provider:
        def generate_batch(self, books):
            nonlocal calls
            calls += 1
            return {book.isbn13: {"FANTASY": 0.9} for book in books}

    cache = tmp_path / "tags.cache.jsonl"
    first_output = tmp_path / "first.tags.jsonl"
    second_output = tmp_path / "second.tags.jsonl"
    first = TagBatchRunner(
        generator=TagGenerator(rule_tagger=EmptyRuleTagger(), gms_provider=Provider()),
        tag_version="d4l-tags-cache-first-v1",
        batch_size=2,
        cache_path=cache,
    ).run(FIXTURE, first_output)
    second = TagBatchRunner(
        generator=TagGenerator(rule_tagger=EmptyRuleTagger(), gms_provider=Provider()),
        tag_version="d4l-tags-cache-second-v1",
        batch_size=2,
        cache_path=cache,
    ).run(FIXTURE, second_output)

    assert calls == 2
    assert first["cacheWriteRows"] == 4
    assert first["cacheHitRows"] == 0
    assert second["cacheHitRows"] == 4
    assert second["cacheWriteRows"] == 0
    assert second["gmsRequests"] == 0
    records = [json.loads(line) for line in second_output.read_text(encoding="utf-8").splitlines()]
    assert all(record["cacheHit"] is True for record in records)
    assert all(record["gmsSkipReason"] == "CACHE_HIT" for record in records)
