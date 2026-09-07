from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.cli import create_parser, main, run
from recommendation.config import ConfigError, load_config


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "local.toml"
FIXTURE = ROOT / "tests" / "fixtures" / "books.jsonl"


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

