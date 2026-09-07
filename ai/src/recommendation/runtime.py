from __future__ import annotations

from hashlib import sha256
import json
import logging
from pathlib import Path
import random
from typing import Any

from recommendation.config import RuntimeConfig


def configure_logging(config: RuntimeConfig) -> None:
    config.log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=config.log_level,
        format="%(levelname)s %(name)s %(message)s",
        handlers=[logging.FileHandler(config.log_file, encoding="utf-8"), logging.StreamHandler()],
        force=True,
    )


def set_seed(seed: int) -> None:
    random.seed(seed)


def file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def build_artifact(
    *,
    command: str,
    config: RuntimeConfig,
    input_path: Path,
    user_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "command": command,
        "inputHash": file_hash(input_path),
        "runtime": {"seed": config.seed},
        "schemaVersion": 1,
    }
    if user_id is not None:
        payload["userId"] = user_id

    artifact_hash = sha256(canonical_json_bytes(payload)).hexdigest()
    return {**payload, "artifactHash": artifact_hash}


def write_artifact(path: Path, artifact: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json_bytes(artifact) + b"\n")
