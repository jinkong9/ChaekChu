from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any


ISBN13_PATTERN = re.compile(r"^97[89]\d{10}$")
MONTH_PATTERN = re.compile(r"^\d{4}년 \d{2}월$")
REQUIRED_FIELDS = ("isbn13", "bookname", "loan_total")
NULLABLE_FIELDS = ("authors", "publisher", "class_no", "class_nm", "desc", "keywords", "vol")
RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    severity: str
    code: str
    line: int
    field: str | None
    message: str
    example: dict[str, Any]


def _example(raw: Any, line: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"line": line}
    return {"line": line, "isbn13": raw.get("isbn13")}


def _issue(
    issues: list[ValidationIssue],
    *,
    severity: str,
    code: str,
    line: int,
    field: str | None,
    message: str,
    raw: Any,
) -> None:
    issues.append(
        ValidationIssue(
            severity=severity,
            code=code,
            line=line,
            field=field,
            message=message,
            example=_example(raw, line),
        )
    )


def _check_relation_field(
    raw: dict[str, Any], field: str, line: int, issues: list[ValidationIssue]
) -> None:
    value = raw.get(field)
    if value is None:
        return
    if not isinstance(value, list):
        _issue(
            issues,
            severity="error",
            code="relation_not_array",
            line=line,
            field=field,
            message="relation field must be an array",
            raw=raw,
        )
        return
    for position, item in enumerate(value):
        if not isinstance(item, list) or len(item) < 2 or not isinstance(item[0], str) or not isinstance(item[1], str):
            _issue(
                issues,
                severity="error",
                code="relation_item_invalid",
                line=line,
                field=field,
                message=f"relation item {position} must contain isbn13 and title strings",
                raw=raw,
            )
            break


def _check_loan_history(raw: dict[str, Any], line: int, issues: list[ValidationIssue]) -> None:
    value = raw.get("loan_history")
    if value is None:
        return
    if not isinstance(value, list):
        _issue(
            issues,
            severity="error",
            code="loan_history_not_array",
            line=line,
            field="loan_history",
            message="loan_history must be an array",
            raw=raw,
        )
        return
    for position, item in enumerate(value):
        valid_numbers = (
            isinstance(item, list)
            and len(item) >= 3
            and isinstance(item[0], str)
            and MONTH_PATTERN.fullmatch(item[0]) is not None
            and isinstance(item[1], int)
            and not isinstance(item[1], bool)
            and isinstance(item[2], int)
            and not isinstance(item[2], bool)
            and item[1] >= 0
            and item[2] >= 0
        )
        if not valid_numbers:
            _issue(
                issues,
                severity="error",
                code="loan_history_item_invalid",
                line=line,
                field="loan_history",
                message=f"loan_history item {position} must be [YYYY년 MM월, non-negative integer, non-negative integer]",
                raw=raw,
            )
            break


def _validate_record(raw: Any, line: int, seen: set[str], issues: list[ValidationIssue]) -> bool:
    if not isinstance(raw, dict):
        _issue(
            issues,
            severity="error",
            code="record_not_object",
            line=line,
            field=None,
            message="record must be a JSON object",
            raw=raw,
        )
        return False

    valid = True
    for field in REQUIRED_FIELDS:
        value = raw.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            _issue(
                issues,
                severity="error",
                code="required_missing",
                line=line,
                field=field,
                message="required field is missing or empty",
                raw=raw,
            )
            valid = False

    isbn13 = raw.get("isbn13")
    if not isinstance(isbn13, str) or ISBN13_PATTERN.fullmatch(isbn13) is None:
        _issue(
            issues,
            severity="error",
            code="isbn13_invalid",
            line=line,
            field="isbn13",
            message="isbn13 must be a 13-digit 978/979 ISBN string without separators",
            raw=raw,
        )
        valid = False
    elif isbn13 in seen:
        _issue(
            issues,
            severity="error",
            code="isbn13_duplicate",
            line=line,
            field="isbn13",
            message="isbn13 must be unique within the input snapshot",
            raw=raw,
        )
        valid = False
    else:
        seen.add(isbn13)

    loan_total = raw.get("loan_total")
    if not isinstance(loan_total, int) or isinstance(loan_total, bool) or loan_total < 0:
        _issue(
            issues,
            severity="error",
            code="loan_total_invalid",
            line=line,
            field="loan_total",
            message="loan_total must be a non-negative integer",
            raw=raw,
        )
        valid = False

    for field in NULLABLE_FIELDS:
        if raw.get(field) is None:
            _issue(
                issues,
                severity="warning",
                code="nullable_missing",
                line=line,
                field=field,
                message="nullable source field is missing",
                raw=raw,
            )

    for field in RELATION_FIELDS:
        _check_relation_field(raw, field, line, issues)
    _check_loan_history(raw, line, issues)
    return valid


def validate_d4l_jsonl(path: Path, max_examples: int = 5) -> dict[str, Any]:
    issues: list[ValidationIssue] = []
    seen: set[str] = set()
    rows = 0
    valid_rows = 0
    try:
        with path.open(encoding="utf-8") as file:
            for line_number, line in enumerate(file, start=1):
                if not line.strip():
                    continue
                rows += 1
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    _issue(
                        issues,
                        severity="error",
                        code="invalid_json",
                        line=line_number,
                        field=None,
                        message="line is not valid JSON",
                        raw=None,
                    )
                    continue
                if _validate_record(raw, line_number, seen, issues):
                    valid_rows += 1
    except OSError as error:
        _issue(
            issues,
            severity="error",
            code="input_unreadable",
            line=0,
            field=None,
            message=error.strerror or "input could not be read",
            raw=None,
        )

    counts = Counter(issue.code for issue in issues)
    errors = [issue for issue in issues if issue.severity == "error"]
    warnings = [issue for issue in issues if issue.severity == "warning"]
    examples: dict[str, list[dict[str, Any]]] = {}
    for issue in issues:
        bucket = examples.setdefault(issue.code, [])
        if len(bucket) < max_examples:
            bucket.append(
                {
                    "line": issue.line,
                    "field": issue.field,
                    "message": issue.message,
                    **issue.example,
                }
            )
    return {
        "contract": "d4l-usage-v1",
        "rows": rows,
        "validRows": valid_rows,
        "blockingErrors": len(errors),
        "warnings": len(warnings),
        "ruleCounts": dict(sorted(counts.items())),
        "examples": examples,
        "status": "FAIL" if errors else "PASS",
    }
