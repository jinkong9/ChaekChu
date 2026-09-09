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
from recommendation.normalization import NormalizationError
from recommendation.quality import evaluate_weight_grid, load_tag_sidecar
from recommendation.runtime import build_artifact, configure_logging, refresh_artifact_hash, set_seed, write_artifact
from recommendation.tag_batch import GmsTagProvider, TagBatchRunner, TagGenerator
from recommendation.validation import validate_d4l_jsonl


LOGGER = logging.getLogger(__name__)
COMMANDS = ("build", "validate", "evaluate", "recommend", "index", "tags", "tune")


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
        command_parser.add_argument("--input", type=Path, required=True)
        command_parser.add_argument("--output", type=Path)
        if command == "recommend":
            command_parser.add_argument("--user-id", required=True)
            command_parser.add_argument("--query-isbn")
            command_parser.add_argument("--limit", type=int, default=10)
        if command == "evaluate":
            command_parser.add_argument("--k", type=int, default=5)
            command_parser.add_argument("--recall-k", type=int, default=10)
        if command == "index":
            command_parser.add_argument("--index-version", default=None)
            command_parser.add_argument("--batch-size", type=int, default=32)
            command_parser.add_argument("--max-retries", type=int, default=2)
        if command == "tags":
            command_parser.add_argument("--sidecar", type=Path, required=True)
            command_parser.add_argument("--tag-version", default=None)
            command_parser.add_argument("--max-retries", type=int, default=2)
            command_parser.add_argument("--low-confidence", type=float, default=0.6)
        if command == "tune":
            command_parser.add_argument("--tag-sidecar", type=Path)
            command_parser.add_argument("--k", type=int, default=5)
            command_parser.add_argument("--recall-k", type=int, default=10)
    return parser


def run(arguments: argparse.Namespace) -> Path:
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
        elif arguments.command in {"index", "tags"}:
            books = None
        else:
            books = load_d4l_jsonl(input_path)
        if arguments.command == "index":
            artifact["index"] = _run_embedding_index(arguments, input_path)
        elif arguments.command == "tags":
            artifact["tags"] = _run_tag_batch(arguments, input_path)
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
            tag_version=os.getenv("AI_TAG_VERSION", "not-generated"),
            max_retries=arguments.max_retries,
            batch_size=arguments.batch_size,
        ),
    ).run(input_path)


def _run_tag_batch(arguments: argparse.Namespace, input_path: Path) -> dict:
    endpoint = os.getenv("TAG_API_URL", "").strip()
    api_key = (os.getenv("TAG_API_KEY") or os.getenv("GMS_API_KEY") or "").strip()
    provider = None
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
            model_version=os.getenv("TAG_MODEL", "gpt-4o-mini"),
            timeout_seconds=timeout,
        )
    if arguments.max_retries < 0 or not 0 <= arguments.low_confidence <= 1:
        raise ConfigError("tag retry and confidence configuration is invalid")
    tag_version = (arguments.tag_version or os.getenv("AI_TAG_VERSION", "d4l-tags-v1")).strip()
    if not tag_version:
        raise ConfigError("tag version must not be empty")
    return TagBatchRunner(
        generator=TagGenerator(
            gms_provider=provider,
            max_retries=arguments.max_retries,
            low_confidence_threshold=arguments.low_confidence,
        ),
        tag_version=tag_version,
    ).run(input_path, arguments.sidecar.expanduser().resolve())


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

