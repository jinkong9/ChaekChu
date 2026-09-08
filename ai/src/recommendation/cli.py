from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys
from typing import Sequence

from recommendation.config import ConfigError, load_config
from recommendation.baseline import evaluate_d4l, evaluate_content, recommend_content, recommend_popular
from recommendation.d4l import DataError, load_d4l_jsonl
from recommendation.normalization import NormalizationError
from recommendation.runtime import build_artifact, configure_logging, refresh_artifact_hash, set_seed, write_artifact
from recommendation.validation import validate_d4l_jsonl


LOGGER = logging.getLogger(__name__)
COMMANDS = ("build", "validate", "evaluate", "recommend")


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
        else:
            books = load_d4l_jsonl(input_path)
        if arguments.command == "evaluate" and books is not None:
            artifact["evaluation"] = evaluate_d4l(books, k=arguments.k, recall_k=arguments.recall_k)
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

