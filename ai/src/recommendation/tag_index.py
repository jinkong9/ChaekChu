from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import gzip
import json
import math
from pathlib import Path
from typing import Any, Iterator, TextIO

from recommendation.tag_batch import TAXONOMY_BY_CODE, TAXONOMY_VERSION


@dataclass(frozen=True, slots=True)
class TagPayload:
    """Validated tag fields copied into a book vector payload."""

    tag_codes: tuple[str, ...]
    tag_scores: dict[str, float]
    tag_confidence: dict[str, float]


@dataclass(frozen=True, slots=True)
class ValidatedTagSidecar:
    records: dict[str, TagPayload]
    input_hash: str
    tag_version: str
    taxonomy_version: str
    file_hash: str


def _open_text(path: Path) -> Iterator[TextIO]:
    if path.name.lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open(encoding="utf-8")


def _invalid(path: Path, line_number: int, message: str) -> ValueError:
    return ValueError(f"invalid tag sidecar at {path}:{line_number}: {message}")


def _scores(record: dict[str, Any], field: str, *, codes: set[str], path: Path, line_number: int) -> dict[str, float]:
    value = record.get(field)
    if not isinstance(value, dict) or set(value) != codes:
        raise _invalid(path, line_number, f"{field} keys must match tagCodes")
    result: dict[str, float] = {}
    for code, score in value.items():
        if not isinstance(score, (int, float)) or isinstance(score, bool):
            raise _invalid(path, line_number, f"{field}.{code} must be numeric")
        numeric = float(score)
        if not math.isfinite(numeric) or not 0 <= numeric <= 1:
            raise _invalid(path, line_number, f"{field}.{code} must be between 0 and 1")
        result[code] = numeric
    return result


def load_validated_tag_sidecar(
    path: Path,
    *,
    expected_input_hash: str,
    expected_tag_version: str,
) -> ValidatedTagSidecar:
    """Load a generated sidecar and reject data from another snapshot/version."""
    if not path.is_file():
        raise ValueError(f"tag sidecar was not found: {path}")
    records: dict[str, TagPayload] = {}
    taxonomy_version: str | None = None
    input_hash: str | None = None
    tag_version: str | None = None
    try:
        with _open_text(path) as file:
            for line_number, line in enumerate(file, start=1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    raise _invalid(path, line_number, "line is not valid JSON") from error
                if not isinstance(record, dict):
                    raise _invalid(path, line_number, "record must be an object")
                isbn13 = record.get("isbn13")
                if not isinstance(isbn13, str) or not isbn13.strip():
                    raise _invalid(path, line_number, "isbn13 is required")
                isbn13 = isbn13.strip()
                if isbn13 in records:
                    raise _invalid(path, line_number, f"duplicate isbn13: {isbn13}")
                row_input_hash = record.get("inputHash")
                row_tag_version = record.get("tagVersion")
                row_taxonomy_version = record.get("taxonomyVersion")
                if row_input_hash != expected_input_hash:
                    raise _invalid(path, line_number, "inputHash does not match the source snapshot")
                if row_tag_version != expected_tag_version:
                    raise _invalid(path, line_number, "tagVersion does not match the index configuration")
                if row_taxonomy_version != TAXONOMY_VERSION:
                    raise _invalid(path, line_number, "taxonomyVersion is not supported")
                if input_hash is None:
                    input_hash = row_input_hash
                    tag_version = row_tag_version
                    taxonomy_version = row_taxonomy_version
                elif (input_hash, tag_version, taxonomy_version) != (
                    row_input_hash,
                    row_tag_version,
                    row_taxonomy_version,
                ):
                    raise _invalid(path, line_number, "sidecar version metadata is inconsistent")

                raw_codes = record.get("tagCodes")
                if not isinstance(raw_codes, list) or any(not isinstance(code, str) or not code.strip() for code in raw_codes):
                    raise _invalid(path, line_number, "tagCodes must be a list of non-empty strings")
                codes = tuple(code.strip() for code in raw_codes)
                if len(set(codes)) != len(codes):
                    raise _invalid(path, line_number, "tagCodes must be unique")
                unknown = set(codes) - set(TAXONOMY_BY_CODE)
                if unknown:
                    raise _invalid(path, line_number, f"unknown tag code(s): {', '.join(sorted(unknown))}")
                scores = _scores(record, "tagScores", codes=set(codes), path=path, line_number=line_number)
                confidence = _scores(record, "tagConfidence", codes=set(codes), path=path, line_number=line_number)
                low_confidence = record.get("lowConfidence")
                if not isinstance(low_confidence, bool):
                    raise _invalid(path, line_number, "lowConfidence must be boolean")
                records[isbn13] = TagPayload(codes, scores, confidence)
    except (OSError, UnicodeDecodeError) as error:
        raise ValueError(f"tag sidecar could not be read: {path}") from error

    return ValidatedTagSidecar(
        records=records,
        input_hash=input_hash or expected_input_hash,
        tag_version=tag_version or expected_tag_version,
        taxonomy_version=taxonomy_version or TAXONOMY_VERSION,
        file_hash=sha256(path.read_bytes()).hexdigest(),
    )


__all__ = ["TagPayload", "ValidatedTagSidecar", "load_validated_tag_sidecar"]
