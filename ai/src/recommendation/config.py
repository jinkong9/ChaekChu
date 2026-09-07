from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib


class ConfigError(ValueError):
    """Raised when runtime configuration is missing or invalid."""


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    seed: int
    output_dir: Path
    log_level: str
    log_file: Path


def _relative_to_config(config_path: Path, value: object, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"runtime.{field} must be a non-empty path")
    path = Path(value)
    return path if path.is_absolute() else config_path.parent.parent / path


def load_config(path: Path) -> RuntimeConfig:
    config_path = path.expanduser().resolve()
    if not config_path.is_file():
        raise ConfigError("configuration file was not found")

    try:
        with config_path.open("rb") as file:
            document = tomllib.load(file)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ConfigError("configuration file could not be read") from error

    runtime = document.get("runtime")
    if not isinstance(runtime, dict):
        raise ConfigError("missing [runtime] configuration section")

    seed = runtime.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ConfigError("runtime.seed must be a non-negative integer")

    log_level = runtime.get("log_level", "INFO")
    if not isinstance(log_level, str) or log_level.upper() not in {
        "DEBUG",
        "INFO",
        "WARNING",
        "ERROR",
        "CRITICAL",
    }:
        raise ConfigError("runtime.log_level is invalid")

    return RuntimeConfig(
        seed=seed,
        output_dir=_relative_to_config(config_path, runtime.get("output_dir"), "output_dir"),
        log_level=log_level.upper(),
        log_file=_relative_to_config(config_path, runtime.get("log_file"), "log_file"),
    )

