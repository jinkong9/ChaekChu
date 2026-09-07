from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys
from typing import Sequence

from recommendation.config import ConfigError, load_config
from recommendation.runtime import build_artifact, configure_logging, set_seed, write_artifact


LOGGER = logging.getLogger(__name__)
COMMANDS = ("build", "evaluate", "recommend")


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
    artifact = build_artifact(
        command=arguments.command,
        config=config,
        input_path=input_path,
        user_id=user_id,
    )
    write_artifact(output_path, artifact)
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

