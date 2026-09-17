from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
import sys
from typing import Sequence

from recommendation.config import ConfigError, load_config
from recommendation.baseline import evaluate_d4l, evaluate_content, recommend_content, recommend_popular
from recommendation.d4l import DataError, load_d4l_jsonl
from recommendation.embedding import OpenAICompatibleEmbeddingProvider
from recommendation.embedding_batch import EmbeddingBatchConfig, EmbeddingBatchRunner, QdrantVersionedIndexStore
from recommendation.index_audit import IndexAuditConfig, QdrantIndexAuditor
from recommendation.normalization import NormalizationError, normalized_input_hash
from recommendation.quality import evaluate_weight_grid, load_tag_sidecar
from recommendation.runtime import build_artifact, configure_logging, refresh_artifact_hash, set_seed, write_artifact
from recommendation.smoke import run_smoke
from recommendation.tag_batch import GmsTagProvider, TAG_CACHE_VERSION, TAXONOMY, TagBatchRunner, TagGenerator
from recommendation.tag_index import load_validated_tag_sidecar
from recommendation.tag_payload_sync import TagPayloadSyncRunner
from recommendation.tag_quality import TagQualityError, compare_tag_sidecars
from recommendation.tag_prototype import (
    QdrantTagPrototypeIndexStore,
    TagPrototypeBatchConfig,
    TagPrototypeBatchRunner,
)
from recommendation.validation import validate_d4l_jsonl


LOGGER = logging.getLogger(__name__)
COMMANDS = (
    "build", "validate", "evaluate", "recommend", "index", "tags", "tag-index", "tag-payload-sync", "tune", "smoke", "tag-quality", "audit-index",
)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="b102-recommendation",
        description="Build, evaluate, and generate B102 recommendation artifacts.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/local.toml"),
        help="TOML runtime configuration path (default: config/local.toml)",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in COMMANDS:
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--output", type=Path)
        if command == "audit-index":
            command_parser.add_argument("--sample-size", type=int, default=3)
            command_parser.add_argument("--tag-code", action="append", default=None)
        else:
            command_parser.add_argument("--input", type=Path, required=True)
        if command == "recommend":
            command_parser.add_argument("--user-id", required=True)
            command_parser.add_argument("--query-isbn")
            command_parser.add_argument("--limit", type=int, default=10)
        if command == "evaluate":
            command_parser.add_argument("--k", type=int, default=5)
            command_parser.add_argument("--recall-k", type=int, default=10)
        if command == "index":
            command_parser.add_argument("--index-version", default=None)
            command_parser.add_argument("--tag-sidecar", type=Path)
            command_parser.add_argument("--batch-size", type=int, default=32)
            command_parser.add_argument("--max-retries", type=int, default=2)
        if command == "tags":
            command_parser.add_argument("--sidecar", type=Path, required=True)
            command_parser.add_argument(
                "--cache",
                type=Path,
                default=None,
                help="persistent tag cache JSONL path (default: TAG_CACHE_PATH when set)",
            )
            command_parser.add_argument("--tag-version", default=None)
            command_parser.add_argument(
                "--rule-only",
                action="store_true",
                help="never call GMS: rule tags plus cached tags only (taxonomy 확장 재실행처럼 비용 0 이어야 할 때)",
            )
            command_parser.add_argument("--max-retries", type=int, default=2)
            command_parser.add_argument("--low-confidence", type=float, default=0.6)
            command_parser.add_argument(
                "--rule-confidence-threshold",
                type=float,
                default=None,
                help="skip GMS when a rule tag meets this confidence (default: TAG_RULE_CONFIDENCE_THRESHOLD or 0.85)",
            )
            command_parser.add_argument(
                "--batch-size",
                type=int,
                default=None,
                help="number of books per GMS request (default: TAG_BATCH_SIZE or 16)",
            )
            command_parser.add_argument(
                "--estimated-credits-per-request",
                type=float,
                default=None,
                help="planning estimate for one GMS request (default: TAG_ESTIMATED_CREDITS_PER_REQUEST or 2.0)",
            )
            command_parser.add_argument(
                "--max-estimated-credits",
                type=float,
                default=None,
                help="hard cap for estimated GMS credits (default: TAG_MAX_ESTIMATED_CREDITS when set)",
            )
        if command == "tag-quality":
            command_parser.add_argument("--baseline-sidecar", type=Path, required=True)
            command_parser.add_argument("--candidate-sidecar", type=Path, required=True)
            command_parser.add_argument("--max-missing-increase", type=int, default=0)
            command_parser.add_argument("--max-coverage-drop", type=float, default=0.0)
        if command == "tag-index":
            command_parser.add_argument("--index-version", default=None)
            command_parser.add_argument("--tag-version", default=None)
            command_parser.add_argument("--batch-size", type=int, default=32)
            command_parser.add_argument("--max-retries", type=int, default=2)
        if command == "tag-payload-sync":
            command_parser.add_argument("--sidecar", type=Path, required=True)
            command_parser.add_argument("--index-version", default=None)
            command_parser.add_argument("--tag-version", default=None)
            command_parser.add_argument(
                "--baseline-sidecar",
                type=Path,
                default=None,
                help="previous sidecar of the same snapshot; only points whose tags differ are sent (권장 — 440k 전부 쓰면 Qdrant 가 멈춘다)",
            )
            command_parser.add_argument(
                "--baseline-tag-version",
                default=None,
                help="tagVersion recorded in --baseline-sidecar (default: AI_TAG_VERSION, i.e. the version currently live)",
            )
            command_parser.add_argument("--batch-size", type=int, default=100)
            command_parser.add_argument("--pause-seconds", type=float, default=0.5, help="sleep between batches so the optimizer keeps up")
            command_parser.add_argument("--max-retries", type=int, default=3, help="per-batch retries with backoff on Qdrant timeouts")
        if command == "tune":
            command_parser.add_argument("--tag-sidecar", type=Path)
            command_parser.add_argument("--k", type=int, default=5)
            command_parser.add_argument("--recall-k", type=int, default=10)
        if command == "smoke":
            command_parser.add_argument("--tag-sidecar", type=Path)
            command_parser.add_argument("--tag-version", default="d4l-tags-v1")
            command_parser.add_argument("--k", type=int, default=5)
            command_parser.add_argument("--recall-k", type=int, default=10)
    return parser


def run(arguments: argparse.Namespace) -> Path:
    if arguments.command == "audit-index":
        logging.basicConfig(
            level=os.getenv("AI_LOG_LEVEL", "INFO").upper(),
            format="%(levelname)s %(name)s %(message)s",
            force=True,
        )
        output_path = arguments.output or Path(os.getenv("TMPDIR", "/tmp")) / "b102-index-audit.json"
        try:
            audit = _run_index_audit(arguments)
        except ValueError as error:
            raise ConfigError(f"index audit configuration is invalid: {error}") from error
        artifact = refresh_artifact_hash({
            "command": "audit-index",
            "schemaVersion": 1,
            "indexAudit": audit,
        })
        write_artifact(output_path, artifact)
        LOGGER.info("command=%s artifactHash=%s", arguments.command, artifact["artifactHash"])
        if audit["status"] != "PASS":
            raise ConfigError(f"active Qdrant index audit failed; report written to {output_path}")
        return output_path

    config = load_config(arguments.config)
    configure_logging(config)
    set_seed(config.seed)

    input_path = arguments.input.expanduser().resolve()
    if not input_path.is_file():
        raise ConfigError("input file was not found")

    output_path = arguments.output or config.output_dir / f"{arguments.command}.json"
    user_id = arguments.user_id if arguments.command == "recommend" else None
    try:
        artifact = build_artifact(
            command=arguments.command,
            config=config,
            input_path=input_path,
            user_id=user_id,
        )
        if arguments.command == "build":
            books = None
        elif arguments.command == "validate":
            artifact["validation"] = validate_d4l_jsonl(input_path)
            books = None
        elif arguments.command in {"index", "tags", "tag-index", "tag-payload-sync", "smoke", "tag-quality"}:
            books = None
        else:
            books = load_d4l_jsonl(input_path)
        if arguments.command == "index":
            artifact["index"] = _run_embedding_index(arguments, input_path)
        elif arguments.command == "tags":
            artifact["tags"] = _run_tag_batch(arguments, input_path)
        elif arguments.command == "tag-index":
            artifact["tagIndex"] = _run_tag_prototype_index(arguments)
        elif arguments.command == "tag-payload-sync":
            artifact["tagPayloadSync"] = _run_tag_payload_sync(arguments, input_path)
        elif arguments.command == "smoke":
            try:
                artifact["smoke"] = run_smoke(
                    input_path,
                    tag_sidecar_path=arguments.tag_sidecar.expanduser().resolve() if arguments.tag_sidecar else None,
                    tag_version=arguments.tag_version,
                    k=arguments.k,
                    recall_k=arguments.recall_k,
                )
            except ValueError as error:
                raise ConfigError(f"smoke configuration is invalid: {error}") from error
        elif arguments.command == "tag-quality":
            try:
                artifact["tagQuality"] = compare_tag_sidecars(
                    input_path,
                    arguments.baseline_sidecar.expanduser().resolve(),
                    arguments.candidate_sidecar.expanduser().resolve(),
                    max_missing_increase=arguments.max_missing_increase,
                    max_coverage_drop=arguments.max_coverage_drop,
                )
            except TagQualityError as error:
                raise ConfigError(f"tag quality comparison failed: {error}") from error
        elif arguments.command == "evaluate" and books is not None:
            artifact["evaluation"] = evaluate_d4l(books, k=arguments.k, recall_k=arguments.recall_k)
        elif arguments.command == "tune" and books is not None:
            try:
                tag_codes = load_tag_sidecar(arguments.tag_sidecar.expanduser().resolve()) if arguments.tag_sidecar else None
                artifact["tuning"] = evaluate_weight_grid(
                    books,
                    tag_codes_by_isbn=tag_codes,
                    input_hash=artifact["inputHash"],
                    k=arguments.k,
                    recall_k=arguments.recall_k,
                )
            except ValueError as error:
                raise ConfigError(f"tuning configuration is invalid: {error}") from error
        elif arguments.command == "recommend" and books is not None:
            query_isbn = arguments.query_isbn or books[0].isbn13
            artifact["algorithm"] = "tfidf-content-v1"
            artifact["queryIsbn"] = query_isbn
            artifact["recommendations"] = recommend_content(books, query_isbn, limit=arguments.limit)
            artifact["popularBaseline"] = recommend_popular(books, query_isbn, limit=arguments.limit)
    except (DataError, NormalizationError) as error:
        raise ConfigError(f"input validation failed: {error}") from error
    artifact = refresh_artifact_hash(artifact)
    write_artifact(output_path, artifact)
    if arguments.command == "validate" and artifact["validation"]["blockingErrors"]:
        raise ConfigError(
            f"input validation failed: {artifact['validation']['blockingErrors']} blocking error(s); report written to {output_path}"
        )
    if arguments.command == "tag-quality" and artifact["tagQuality"]["status"] != "PASS":
        raise ConfigError(f"tag quality gate failed; report written to {output_path}")
    LOGGER.info("command=%s artifactHash=%s", arguments.command, artifact["artifactHash"])
    return output_path


def _run_embedding_index(arguments: argparse.Namespace, input_path: Path) -> dict:
    endpoint = os.getenv("EMBEDDING_API_URL", "").strip()
    api_key = os.getenv("EMBEDDING_API_KEY", "").strip()
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    index_version = (arguments.index_version or os.getenv("AI_INDEX_VERSION", "")).strip()
    if index_version.lower() == "none":
        index_version = ""
    if not endpoint or not api_key or not qdrant_url or not index_version:
        raise ConfigError("index command requires embedding, Qdrant, and active index configuration")
    if arguments.batch_size < 1 or arguments.max_retries < 0:
        raise ConfigError("batch size must be positive and max retries must be non-negative")
    try:
        dimension = int(os.getenv("EMBEDDING_DIMENSION", "512"))
        timeout = float(os.getenv("EMBEDDING_TIMEOUT_SECONDS", "30"))
        qdrant_timeout = float(os.getenv("QDRANT_TIMEOUT_SECONDS", "10"))
    except ValueError as error:
        raise ConfigError("embedding and Qdrant timeout/dimension configuration is invalid") from error
    model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small").strip()
    tag_version = os.getenv("AI_TAG_VERSION", "not-generated").strip()
    tag_sidecar_path = arguments.tag_sidecar.expanduser().resolve() if arguments.tag_sidecar else None
    tag_sidecar = None
    if tag_sidecar_path is not None:
        try:
            tag_sidecar = load_validated_tag_sidecar(
                tag_sidecar_path,
                expected_input_hash=normalized_input_hash(input_path),
                expected_tag_version=tag_version,
            )
        except ValueError as error:
            raise ConfigError(f"tag sidecar validation failed: {error}") from error
    provider = OpenAICompatibleEmbeddingProvider(
        endpoint=endpoint,
        api_key=api_key,
        model_version=model,
        dimension=dimension,
        timeout_seconds=timeout,
        batch_size=arguments.batch_size,
    )
    store = QdrantVersionedIndexStore(
        base_url=qdrant_url,
        collection_prefix=os.getenv("QDRANT_COLLECTION_PREFIX", "books"),
        active_alias=os.getenv("QDRANT_COLLECTION", "books_active"),
        dimension=dimension,
        timeout_seconds=qdrant_timeout,
        api_key=os.getenv("QDRANT_API_KEY") or None,
    )
    return EmbeddingBatchRunner(
        embedder=provider,
        store=store,
        config=EmbeddingBatchConfig(
            index_version=index_version,
            feature_version=os.getenv("AI_FEATURE_VERSION", "d4l-feature-v1"),
            tag_version=tag_version,
            max_retries=arguments.max_retries,
            batch_size=arguments.batch_size,
        ),
        tag_payloads=tag_sidecar.records if tag_sidecar else None,
        tag_sidecar_hash=tag_sidecar.file_hash if tag_sidecar else None,
    ).run(input_path)


def _run_tag_batch(arguments: argparse.Namespace, input_path: Path) -> dict:
    endpoint = os.getenv("TAG_API_URL", "").strip()
    api_key = (os.getenv("TAG_API_KEY") or os.getenv("GMS_API_KEY") or "").strip()
    tag_model = os.getenv("TAG_MODEL", "gpt-4o-mini").strip()
    provider = None
    if getattr(arguments, "rule_only", False):
        endpoint = api_key = ""
    if endpoint or api_key:
        if not endpoint or not api_key:
            raise ConfigError("TAG_API_URL and tag provider API key must be configured together")
        try:
            timeout = float(os.getenv("TAG_API_TIMEOUT_SECONDS", "30"))
        except ValueError as error:
            raise ConfigError("TAG_API_TIMEOUT_SECONDS is invalid") from error
        provider = GmsTagProvider(
            endpoint=endpoint,
            api_key=api_key,
            model_version=tag_model,
            timeout_seconds=timeout,
        )
    try:
        batch_size = int(
            arguments.batch_size
            if arguments.batch_size is not None
            else os.getenv("TAG_BATCH_SIZE", "16")
        )
        rule_confidence_threshold = float(
            arguments.rule_confidence_threshold
            if arguments.rule_confidence_threshold is not None
            else os.getenv("TAG_RULE_CONFIDENCE_THRESHOLD", "0.85")
        )
        estimated_credits_per_request = float(
            arguments.estimated_credits_per_request
            if arguments.estimated_credits_per_request is not None
            else os.getenv("TAG_ESTIMATED_CREDITS_PER_REQUEST", "2.0")
        )
        max_estimated_value = (
            arguments.max_estimated_credits
            if arguments.max_estimated_credits is not None
            else os.getenv("TAG_MAX_ESTIMATED_CREDITS", "").strip()
        )
        max_estimated_credits = float(max_estimated_value) if max_estimated_value != "" else None
    except ValueError as error:
        raise ConfigError("tag cost and confidence configuration is invalid") from error
    if (
        arguments.max_retries < 0
        or not 0 <= arguments.low_confidence <= 1
        or not 0 <= rule_confidence_threshold <= 1
        or batch_size < 1
    ):
        raise ConfigError("tag retry and confidence configuration is invalid")
    tag_version = (arguments.tag_version or os.getenv("AI_TAG_VERSION", "d4l-tags-v1")).strip()
    if not tag_version:
        raise ConfigError("tag version must not be empty")
    cache_value = arguments.cache or os.getenv("TAG_CACHE_PATH", "").strip()
    cache_path = Path(cache_value).expanduser().resolve() if cache_value else None
    cache_version = os.getenv("TAG_CACHE_VERSION", f"{TAG_CACHE_VERSION}:{tag_model}").strip()
    if not cache_version:
        raise ConfigError("TAG_CACHE_VERSION must not be empty")
    return TagBatchRunner(
        generator=TagGenerator(
            gms_provider=provider,
            max_retries=arguments.max_retries,
            low_confidence_threshold=arguments.low_confidence,
            rule_confidence_threshold=rule_confidence_threshold,
            estimated_credits_per_request=estimated_credits_per_request,
            max_estimated_credits=max_estimated_credits,
        ),
        tag_version=tag_version,
        batch_size=batch_size,
        cache_path=cache_path,
        cache_version=cache_version,
    ).run(input_path, arguments.sidecar.expanduser().resolve())


def _run_tag_payload_sync(arguments: argparse.Namespace, input_path: Path) -> dict:
    """Copy a sidecar's tags onto the already indexed points of one index version — no re-embedding."""
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    index_version = (arguments.index_version or os.getenv("AI_INDEX_VERSION", "")).strip()
    tag_version = (arguments.tag_version or os.getenv("AI_TAG_VERSION", "")).strip()
    if index_version.lower() == "none":
        index_version = ""
    if not qdrant_url or not index_version or not tag_version:
        raise ConfigError("tag-payload-sync requires QDRANT_URL, an index version, and the sidecar tag version")
    if arguments.batch_size < 1 or arguments.pause_seconds < 0 or arguments.max_retries < 0:
        raise ConfigError("batch size, pause and retry configuration is invalid")
    try:
        dimension = int(os.getenv("EMBEDDING_DIMENSION", "512"))
        qdrant_timeout = float(os.getenv("QDRANT_TIMEOUT_SECONDS", "10"))
    except ValueError as error:
        raise ConfigError("Qdrant timeout/dimension configuration is invalid") from error
    input_hash = normalized_input_hash(input_path)
    try:
        sidecar = load_validated_tag_sidecar(
            arguments.sidecar.expanduser().resolve(),
            expected_input_hash=input_hash,
            expected_tag_version=tag_version,
        )
        baseline = None
        if arguments.baseline_sidecar is not None:
            baseline_version = (arguments.baseline_tag_version or os.getenv("AI_TAG_VERSION", "")).strip()
            if not baseline_version:
                raise ConfigError("--baseline-sidecar needs --baseline-tag-version (or AI_TAG_VERSION)")
            baseline = load_validated_tag_sidecar(
                arguments.baseline_sidecar.expanduser().resolve(),
                expected_input_hash=input_hash,
                expected_tag_version=baseline_version,
            ).records
    except ValueError as error:
        raise ConfigError(f"tag sidecar validation failed: {error}") from error
    store = QdrantVersionedIndexStore(
        base_url=qdrant_url,
        collection_prefix=os.getenv("QDRANT_COLLECTION_PREFIX", "books"),
        active_alias=os.getenv("QDRANT_COLLECTION", "books_active"),
        dimension=dimension,
        timeout_seconds=qdrant_timeout,
        api_key=os.getenv("QDRANT_API_KEY") or None,
    )
    return TagPayloadSyncRunner(
        store=store,
        index_version=index_version,
        batch_size=arguments.batch_size,
        pause_seconds=arguments.pause_seconds,
        max_retries=arguments.max_retries,
        baseline=baseline,
    ).run(sidecar)


def _run_tag_prototype_index(arguments: argparse.Namespace) -> dict:
    endpoint = os.getenv("EMBEDDING_API_URL", "").strip()
    api_key = os.getenv("EMBEDDING_API_KEY", "").strip()
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    index_version = (arguments.index_version or os.getenv("AI_INDEX_VERSION", "")).strip()
    tag_version = (arguments.tag_version or os.getenv("AI_TAG_VERSION", "d4l-tags-v1")).strip()
    if index_version.lower() == "none":
        index_version = ""
    if not endpoint or not api_key or not qdrant_url or not index_version:
        raise ConfigError("tag-index command requires embedding, Qdrant, and active index configuration")
    if not tag_version or arguments.batch_size < 1 or arguments.max_retries < 0:
        raise ConfigError("tag prototype version and batch configuration are invalid")
    try:
        dimension = int(os.getenv("EMBEDDING_DIMENSION", "512"))
        timeout = float(os.getenv("EMBEDDING_TIMEOUT_SECONDS", "30"))
        qdrant_timeout = float(os.getenv("QDRANT_TIMEOUT_SECONDS", "10"))
    except ValueError as error:
        raise ConfigError("embedding and Qdrant timeout/dimension configuration is invalid") from error
    provider = OpenAICompatibleEmbeddingProvider(
        endpoint=endpoint,
        api_key=api_key,
        model_version=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small").strip(),
        dimension=dimension,
        timeout_seconds=timeout,
        batch_size=arguments.batch_size,
    )
    store = QdrantTagPrototypeIndexStore(
        base_url=qdrant_url,
        collection_prefix=os.getenv("QDRANT_TAG_COLLECTION_PREFIX", "tags"),
        active_alias=os.getenv("QDRANT_TAG_COLLECTION", "tags_active"),
        dimension=dimension,
        timeout_seconds=qdrant_timeout,
        api_key=os.getenv("QDRANT_API_KEY") or None,
    )
    return TagPrototypeBatchRunner(
        embedder=provider,
        store=store,
        config=TagPrototypeBatchConfig(
            index_version=index_version,
            tag_version=tag_version,
            batch_size=arguments.batch_size,
            max_retries=arguments.max_retries,
        ),
    ).run()


def _run_index_audit(arguments: argparse.Namespace) -> dict:
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    index_version = os.getenv("AI_INDEX_VERSION", "").strip()
    tag_version = os.getenv("AI_TAG_VERSION", "").strip()
    if not qdrant_url or not index_version or not tag_version:
        raise ConfigError("audit-index requires QDRANT_URL, AI_INDEX_VERSION, and AI_TAG_VERSION")
    try:
        dimension = int(os.getenv("EMBEDDING_DIMENSION", "512"))
        timeout = float(os.getenv("QDRANT_TIMEOUT_SECONDS", "5"))
    except ValueError as error:
        raise ConfigError("EMBEDDING_DIMENSION or QDRANT_TIMEOUT_SECONDS is invalid") from error
    if arguments.sample_size < 1 or arguments.sample_size > 100:
        raise ConfigError("--sample-size must be between 1 and 100")
    tag_codes = arguments.tag_code if arguments.tag_code is not None else [definition.code for definition in TAXONOMY]
    auditor = QdrantIndexAuditor(IndexAuditConfig(
        base_url=qdrant_url,
        book_alias=os.getenv("QDRANT_COLLECTION", "books_active").strip(),
        tag_alias=os.getenv("QDRANT_TAG_COLLECTION", "tags_active").strip(),
        index_version=index_version,
        tag_version=tag_version,
        dimension=dimension,
        sample_size=arguments.sample_size,
        vector_name=os.getenv("QDRANT_VECTOR_NAME", "").strip() or None,
        api_key=os.getenv("QDRANT_API_KEY") or None,
        timeout_seconds=timeout,
    ))
    return auditor.audit(tag_codes=tag_codes)


def main(argv: Sequence[str] | None = None) -> int:
    parser = create_parser()
    arguments = parser.parse_args(argv)
    try:
        output_path = run(arguments)
    except ConfigError as error:
        parser.exit(2, f"configuration error: {error}\n")
    except OSError as error:
        parser.exit(1, f"runtime error: {error.strerror or 'I/O operation failed'}\n")
    print(output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())

