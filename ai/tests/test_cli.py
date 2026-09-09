from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from recommendation.api import (
    EmptyRecommendationEngine,
    IndexedRecommendationEngine,
    D4LBookInput,
    RecommendationRequest,
    app,
    build_runtime_engine,
    configure_recommendation_engine,
)
from recommendation.cli import create_parser, main, run
from recommendation.config import ConfigError, load_config
from recommendation.dedup import candidate_secondary_key, deduplicate_candidates, join_relation_isbns
from recommendation.d4l import load_d4l_jsonl
from recommendation.baseline import evaluate_content, evaluate_d4l, recommend_content
from recommendation.normalization import NORMALIZATION_VERSION, normalized_input_hash
from recommendation.validation import validate_d4l_jsonl
from recommendation.query_vector import InMemoryQueryVectorStore, QueryVectorBuilder
from recommendation.vector_search import (
    CandidateHit,
    CandidateSearchResponse,
    CandidateSearchService,
    InMemoryVectorIndex,
    SearchStatus,
    VectorRecord,
    QdrantVectorIndex,
    QueryVectorStoreTimeoutError,
)


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
    assert artifact["inputNormalizationVersion"] == NORMALIZATION_VERSION
    assert len(artifact["inputHash"]) == 64
    assert len(artifact["artifactHash"]) == 64


def test_tags_command_writes_sidecar_and_report(tmp_path: Path) -> None:
    sidecar = tmp_path / "tags.jsonl"
    output = tmp_path / "tags-report.json"

    result = run(
        parse(
            "tags",
            "--input",
            str(D4L_FIXTURE),
            "--sidecar",
            str(sidecar),
            "--output",
            str(output),
        )
    )

    artifact = json.loads(result.read_text(encoding="utf-8"))
    assert artifact["command"] == "tags"
    assert artifact["tags"]["rows"] == 4
    assert artifact["tags"]["gmsAttempts"] == 0
    assert sidecar.is_file()


def test_tune_command_writes_weight_report(tmp_path: Path) -> None:
    output = tmp_path / "tune.json"

    result = run(
        parse(
            "tune",
            "--input",
            str(D4L_FIXTURE),
            "--output",
            str(output),
        )
    )

    artifact = json.loads(result.read_text(encoding="utf-8"))
    assert artifact["command"] == "tune"
    assert artifact["tuning"]["weightTuningVersion"] == "d4l-weight-tuning-v1"
    assert artifact["tuning"]["recommendedConfig"]
    assert len(artifact["tuning"]["weightConfigs"]) == 4


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


def test_d4l_input_hash_uses_only_versioned_normalized_features(tmp_path: Path) -> None:
    first = tmp_path / "first.jsonl"
    second = tmp_path / "second.jsonl"
    first.write_text(
        '{"isbn13":"9780000000001","bookname":" A ","authors":"작가",'
        '"loan_total":10,"co_loan":[["9780000000003","C"],["9780000000002","B"]],'
        '"loan_history":[["2026년 02월",2,20],["2026년 01월",1,10]],'
        '"desc":"이 값은 제외","keywords":[["제외",1]]}\n',
        encoding="utf-8",
    )
    second.write_text(
        '{"isbn13":"9780000000001","bookname":"A","authors":"작가",'
        '"loan_total":10,"co_loan":[["9780000000002","B"],["9780000000003","C"]],'
        '"loan_history":[["2026년 01월",1,10],["2026년 02월",2,20]],'
        '"desc":"다른 값","keywords":[["다른값",99]]}\n',
        encoding="utf-8",
    )

    assert normalized_input_hash(first) == normalized_input_hash(second)


def test_d4l_input_hash_is_same_for_plain_and_gzip_input(tmp_path: Path) -> None:
    plain = tmp_path / "d4l.jsonl"
    compressed = tmp_path / "d4l.jsonl.gz"
    plain.write_text(D4L_FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    with gzip.open(compressed, "wt", encoding="utf-8") as file:
        file.write(plain.read_text(encoding="utf-8"))

    assert normalized_input_hash(plain) == normalized_input_hash(compressed)


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
    assert sum(bool(book.mania_rec) for book in books) == 4
    assert sum(bool(book.reader_rec) for book in books) == 4
    assert sum(bool(book.loan_history) for book in books) == 4
    assert sum(bool(book.description) for book in books) == 3


def test_d4l_evaluation_compares_baselines_and_is_reproducible() -> None:
    books = load_d4l_jsonl(D4L_FIXTURE)

    first = evaluate_d4l(books)
    second = evaluate_d4l(books)

    assert first == second
    assert first["evaluationVersion"] == "d4l-ranking-evaluation-v1"
    assert first["targetRelations"] == ["co_loan", "mania_rec", "reader_rec"]
    assert first["targetDenominator"] == 12
    assert first["indexedTargetDenominator"] == 12
    assert first["targetCoverage"] == 1.0
    assert first["edgeCases"] == {
        "emptyRelationQueries": 0,
        "candidateShortageQueries": 4,
        "missingLoanHistoryQueries": 0,
    }
    assert set(first["strategies"]) == {"popularBaseline", "embeddingOnly", "hybrid"}
    for strategy in first["strategies"].values():
        assert 0.0 <= strategy["pAt5"] <= 1.0
        assert 0.0 <= strategy["recallAt10"] <= 1.0
        assert 0.0 <= strategy["coverage"] <= 1.0
        assert 0.0 <= strategy["diversityAt5"] <= 1.0


def test_d4l_evaluation_reports_out_of_index_targets(tmp_path: Path) -> None:
    source = tmp_path / "out-of-index.jsonl"
    source.write_text(
        '{"isbn13":"9780000000001","bookname":"A","loan_total":1,'
        '"co_loan":[["9780000000099","Missing"]],"loan_history":[]}'
        "\n"
        '{"isbn13":"9780000000002","bookname":"B","loan_total":2,'
        '"co_loan":[],"loan_history":[]}\n',
        encoding="utf-8",
    )

    report = evaluate_d4l(load_d4l_jsonl(source))

    assert report["targetDenominator"] == 1
    assert report["indexedTargetDenominator"] == 0
    assert report["outOfIndexTargetCount"] == 1
    assert report["targetCoverage"] == 0.0
    assert report["evaluatedQueries"] == 0
    assert report["relationCoverage"]["co_loan"] == {
        "targets": 1,
        "indexedTargets": 0,
        "outOfIndexTargets": 1,
        "coverage": 0.0,
    }
    assert report["edgeCases"]["emptyRelationQueries"] == 1
    assert report["edgeCases"]["missingLoanHistoryQueries"] == 2


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
    assert report["stats"]["loanTotal"]["count"] == 4
    assert report["stats"]["loanHistory"]["historyRows"] == 8
    assert report["stats"]["loanHistory"]["monthRange"] == {
        "min": "2026년 01월",
        "max": "2026년 02월",
    }
    assert report["stats"]["relations"]["co_loan"]["targetCoverage"] == 1.0
    assert report["derivedFields"]["l1Candidate"] == "not_provided"


def test_d4l_contract_validation_reads_gzip_snapshot(tmp_path: Path) -> None:
    compressed = tmp_path / "d4l_usage.jsonl.gz"
    with gzip.open(compressed, "wt", encoding="utf-8") as file:
        file.write(D4L_FIXTURE.read_text(encoding="utf-8"))

    report = validate_d4l_jsonl(compressed)

    assert report["status"] == "PASS"
    assert report["rows"] == 4
    assert report["stats"]["relations"]["reader_rec"]["edges"] == 4


def test_d4l_loader_reads_gzip_snapshot(tmp_path: Path) -> None:
    compressed = tmp_path / "d4l_usage.jsonl.gz"
    with gzip.open(compressed, "wt", encoding="utf-8") as file:
        file.write(D4L_FIXTURE.read_text(encoding="utf-8"))

    books = load_d4l_jsonl(compressed)

    assert len(books) == 4
    assert books[0].loan_history[-1][0] == "2026년 02월"


def test_d4l_contract_validation_detects_relation_and_history_quality_errors(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.jsonl"
    invalid.write_text(
        '{"isbn13":"9780000000001","bookname":"A","loan_total":1,'
        '"co_loan":[["bad-isbn","B"]],"loan_history":[["2026년 13월",1,1]]}\n',
        encoding="utf-8",
    )

    report = validate_d4l_jsonl(invalid)

    assert report["status"] == "FAIL"
    assert report["ruleCounts"]["relation_isbn_invalid"] == 1
    assert report["ruleCounts"]["loan_history_item_invalid"] == 1


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
            "seedIsbns": ["9780000000001"],
            "excludeIsbns": ["9780000000004"],
            "books": [
                {
                    "isbn13": "9780000000001",
                    "bookname": "달빛 정원",
                    "authors": "김하늘",
                    "publisher": "샘플출판사",
                    "class_no": "813.7",
                    "class_nm": "한국소설",
                    "loan_total": 100,
                    "co_loan": [["9780000000002", "바람의 지도"]],
                    "loan_history": [["2026년 02월", 20, 40]],
                },
                {
                    "isbn13": "9780000000002",
                    "bookname": "바람의 지도",
                    "authors": "이바다",
                    "publisher": "샘플출판사",
                    "class_no": "813.7",
                    "class_nm": "한국소설",
                    "loan_total": 80,
                    "co_loan": [],
                    "loan_history": [["2026년 02월", 15, 30]],
                },
                {
                    "isbn13": "9780000000003",
                    "bookname": "파도 너머",
                    "authors": "박해빛",
                    "publisher": "샘플출판사",
                    "class_no": "813.7",
                    "class_nm": "한국소설",
                    "loan_total": 70,
                    "co_loan": [],
                    "loan_history": [["2026년 02월", 10, 20]],
                },
                {
                    "isbn13": "9780000000004",
                    "bookname": "우리가 걷는 길",
                    "authors": "최새봄",
                    "publisher": "샘플출판사",
                    "class_no": "813.7",
                    "class_nm": "한국소설",
                    "loan_total": 60,
                    "co_loan": [],
                    "loan_history": [["2026년 02월", 8, 16]],
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
    assert all(item["book"]["isbn13"] != "9780000000004" for item in body["items"])
    assert body["items"][0]["reasonType"] == "CO_LOAN"
    assert [item["rank"] for item in body["items"]] == [1, 2]


def test_health_reports_runtime_versions_without_exposing_secrets() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "modelVersion": "d4l-hybrid-v1", "indexVersion": "none"}


def test_runtime_factory_wires_qdrant_only_when_active_index_is_configured() -> None:
    empty = build_runtime_engine({"QDRANT_URL": "http://qdrant:6333", "AI_INDEX_VERSION": "none"})
    assert isinstance(empty, EmptyRecommendationEngine)

    configured = build_runtime_engine(
        {
            "QDRANT_URL": "http://qdrant:6333",
            "QDRANT_API_KEY": "secret-is-not-used-during-construction",
            "QDRANT_COLLECTION": "books_active",
            "QDRANT_TAG_COLLECTION": "tags_active",
            "QDRANT_VECTOR_NAME": "content",
            "QDRANT_TIMEOUT_SECONDS": "1.5",
            "AI_INDEX_VERSION": "d4l-index-v1",
            "AI_MODEL_VERSION": "e5-large-v1",
        }
    )

    assert isinstance(configured, IndexedRecommendationEngine)
    assert isinstance(configured.search_service.adapter, QdrantVectorIndex)
    assert configured.model_version == "e5-large-v1"
    assert configured.index_version == "d4l-index-v1"


def test_recommendation_api_rejects_duplicate_candidate_ids() -> None:
    client = TestClient(app)
    payload = {
        "requestId": "req-test-2",
        "userId": "user-test-2",
        "mode": "COLD_START",
        "books": [
            {"isbn13": "9780000000001", "bookname": "A", "loan_total": 1},
            {"isbn13": "9780000000001", "bookname": "B", "loan_total": 2},
        ],
    }

    response = client.post("/internal/v1/recommendations", json=payload)

    assert response.status_code == 422


def test_candidate_dedup_keeps_richest_representative_per_isbn() -> None:
    sparse = D4LBookInput(isbn13="9780000000001", bookname="같은 책", loan_total=999)
    rich = D4LBookInput(
        isbn13="9780000000001",
        bookname=" 같은 책 ",
        authors="작가",
        publisher="출판사",
        pub_year="2024",
        class_no="813.7",
        class_nm="한국소설",
        loan_total=10,
    )
    same_work_different_isbn = D4LBookInput(isbn13="9780000000002", bookname="같은 책", loan_total=1)

    result = deduplicate_candidates([same_work_different_isbn, sparse, rich])

    assert [book.isbn13 for book in result] == ["9780000000001", "9780000000002"]
    assert result[0] is rich
    assert candidate_secondary_key(result[0]) == ("같은 책", "작가", "813.7", "한국소설")


def test_candidate_dedup_joins_relations_by_exact_isbn_only() -> None:
    relation = [
        [" 9780000000002 ", "같은 책"],
        ["9780000000003", "다른 책"],
        ["9780000000002", "중복 관계"],
    ]

    assert join_relation_isbns(relation, {"9780000000002"}) == ("9780000000002",)
    assert join_relation_isbns(relation, {"9780000000001"}) == ()


def test_recommendation_api_accepts_snapshotless_backend_request() -> None:
    client = TestClient(app)

    response = client.post(
        "/internal/v1/recommendations",
        json={
            "requestId": "req-contract-1",
            "userId": "user-contract-1",
            "mode": "PERSONALIZED",
            "size": 5,
            "seedIsbns": ["9780000000001"],
            "excludeIsbns": ["9780000000004"],
            "tags": [{"code": "FANTASY", "weight": 0.8}],
            "weights": {"semantic": 0.45, "tagMatch": 0.25, "coLoan": 0.15, "trending": 0.1, "steady": 0.05},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requestId"] == "req-contract-1"
    assert body["userId"] == "user-contract-1"
    assert body["fallback"] is True
    assert body["items"] == []
    assert "books" not in body


def test_recommendation_api_rejects_invalid_or_sensitive_backend_fields() -> None:
    client = TestClient(app)
    invalid_tag = {
        "requestId": "req-contract-2",
        "userId": "user-contract-2",
        "mode": "COLD_START",
        "tags": [{"code": "fantasy", "weight": 0.5}],
    }
    sensitive_field = {
        "requestId": "req-contract-3",
        "userId": "user-contract-3",
        "mode": "COLD_START",
        "reviewText": "사용자 감상평은 추천 입력에 포함하지 않는다.",
    }

    assert client.post("/internal/v1/recommendations", json=invalid_tag).status_code == 422
    assert client.post("/internal/v1/recommendations", json=sensitive_field).status_code == 422


def test_indexed_engine_returns_flat_isbn_contract_and_applies_hard_excludes() -> None:
    version = "d4l-test-v1"
    store = InMemoryQueryVectorStore(
        index_version=version,
        book_vectors={"9780000000001": (1.0, 0.0)},
        tag_vectors={"FANTASY": (1.0, 0.0)},
    )
    index = InMemoryVectorIndex(
        [
            VectorRecord(
                "9780000000001",
                (1.0, 0.0),
                {"bookname": "관심 도서", "tagCodes": ["FANTASY"], "loan_total": 100},
                index_version=version,
            ),
            VectorRecord(
                "9780000000002",
                (0.99, 0.01),
                {"bookname": "후보 도서", "tagCodes": ["FANTASY"], "loan_total": 80},
                index_version=version,
            ),
            VectorRecord(
                "9780000000003",
                (0.8, 0.2),
                {"bookname": "두 번째 후보", "tagCodes": [], "loan_total": 60},
                index_version=version,
            ),
        ],
        index_version=version,
    )
    engine = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(store, index_version=version),
        search_service=CandidateSearchService(index),
    )
    previous = getattr(app.state, "recommendation_engine", None)
    configure_recommendation_engine(engine)
    try:
        response = TestClient(app).post(
            "/internal/v1/recommendations",
            json={
                "requestId": "req-contract-4",
                "userId": "user-contract-4",
                "mode": "PERSONALIZED",
                "size": 2,
                "seedIsbns": ["9780000000001"],
                "excludeIsbns": ["9780000000003"],
                "tags": [{"code": "FANTASY", "weight": 1}],
            },
        )
    finally:
        if previous is None:
            app.state.__dict__.pop("recommendation_engine", None)
        else:
            configure_recommendation_engine(previous)

    assert response.status_code == 200
    body = response.json()
    assert body["fallback"] is True  # only one candidate remains after hard filters
    assert [item["isbn13"] for item in body["items"]] == ["9780000000002"]
    assert body["items"][0]["featureScores"]["semantic"] is not None
    assert body["items"][0]["matchedTags"] == ["FANTASY"]
    assert body["items"][0]["primaryReason"]["type"] in {"TAG_MATCH", "SEMANTIC"}
    assert "book" not in body["items"][0]


def test_indexed_engine_cold_start_uses_demand_fallback() -> None:
    version = "d4l-test-v2"
    demand = (
        CandidateHit(
            "9780000000010",
            0.0,
            {"bookname": "인기 후보", "loan_total": 100, "loan_history": [["2026년 02월", 20, 20]]},
        ),
    )
    engine = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(InMemoryQueryVectorStore(index_version=version), index_version=version),
        search_service=CandidateSearchService(InMemoryVectorIndex([], index_version=version)),
        demand_candidates=demand,
    )
    result = engine.recommend(
        RecommendationRequest(
            requestId="req-contract-5",
            userId="user-contract-5",
            mode="COLD_START",
            size=1,
        )
    )

    assert result.fallback is True
    assert [item.isbn13 for item in result.items] == ["9780000000010"]


def test_snapshotless_retry_keeps_recommendation_id_deterministic() -> None:
    request = RecommendationRequest(
        requestId="req-contract-retry",
        userId="user-contract-retry",
        mode="COLD_START",
    )
    first = EmptyRecommendationEngine().recommend(request)
    second = EmptyRecommendationEngine().recommend(request)

    assert first.recommendationId == second.recommendationId
    assert first.requestId == second.requestId


def test_index_timeout_returns_explicit_fallback_response() -> None:
    version = "d4l-timeout-v1"
    store = InMemoryQueryVectorStore(index_version=version, book_vectors={"9780000000020": (1.0, 0.0)})

    class TimeoutSearch:
        def search(self, _request):
            return CandidateSearchResponse(
                status=SearchStatus.TIMEOUT,
                index_version=version,
                requested_limit=100,
                returned_count=0,
                reason="vector store timeout",
            )

    result = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(store, index_version=version),
        search_service=TimeoutSearch(),
    ).recommend(
        RecommendationRequest(
            requestId="req-contract-timeout",
            userId="user-contract-timeout",
            mode="PERSONALIZED",
            seedIsbns=["9780000000020"],
        )
    )

    assert result.fallback is True
    assert result.items == []
    assert result.indexVersion == version


def test_query_vector_timeout_returns_explicit_fallback_response() -> None:
    version = "d4l-query-timeout-v1"

    class TimeoutStore:
        def get_book_vector(self, _isbn13, _index_version):
            raise QueryVectorStoreTimeoutError("query vector timeout")

        def get_tag_vector(self, _code, _index_version):
            return None

    engine = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(TimeoutStore(), index_version=version),
        search_service=CandidateSearchService(InMemoryVectorIndex([], index_version=version)),
    )

    result = engine.recommend(
        RecommendationRequest(
            requestId="req-query-timeout",
            userId="user-query-timeout",
            mode="PERSONALIZED",
            seedIsbns=["9780000000020"],
        )
    )

    assert result.fallback is True
    assert result.items == []
    assert result.indexVersion == version

