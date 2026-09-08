from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
import gzip
import json
from pathlib import Path
import re
from statistics import median
from typing import Any, Iterator, TextIO


ISBN13_PATTERN = re.compile(r"^97[89]\d{10}$")
MONTH_PATTERN = re.compile(r"^(\d{4})년 (0[1-9]|1[0-2])월$")
REQUIRED_FIELDS = ("isbn13", "bookname", "loan_total")
OPTIONAL_FIELDS = (
    "ok",
    "authors",
    "publisher",
    "pub_year",
    "class_no",
    "class_nm",
    "add_symbol",
    "img",
    "loan_grps",
)
RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")
KNOWN_FIELDS = frozenset(
    (*REQUIRED_FIELDS, *OPTIONAL_FIELDS, *RELATION_FIELDS, "loan_history", "desc", "desc_len", "keywords", "vol")
)


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    severity: str
    code: str
    line: int
    field: str | None
    message: str
    example: dict[str, Any]


@dataclass(slots=True)
class _IssueCollector:
    max_examples: int
    counts: Counter[str] = field(default_factory=Counter)
    errors: int = 0
    warnings: int = 0
    examples: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def add(self, issue: ValidationIssue) -> None:
        self.counts[issue.code] += 1
        if issue.severity == "error":
            self.errors += 1
        else:
            self.warnings += 1
        bucket = self.examples.setdefault(issue.code, [])
        if len(bucket) < self.max_examples:
            bucket.append(
                {
                    "line": issue.line,
                    "field": issue.field,
                    "message": issue.message,
                    **issue.example,
                }
            )


@dataclass(slots=True)
class _NumericStats:
    sample_limit: int = 10_000
    count: int = 0
    total: int = 0
    minimum: int | None = None
    maximum: int | None = None
    sample: list[int] = field(default_factory=list)

    def add(self, value: int) -> None:
        self.count += 1
        self.total += value
        self.minimum = value if self.minimum is None else min(self.minimum, value)
        self.maximum = value if self.maximum is None else max(self.maximum, value)
        if len(self.sample) < self.sample_limit:
            self.sample.append(value)

    def as_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "min": self.minimum,
            "max": self.maximum,
            "mean": self.total / self.count if self.count else None,
            "sampleCount": len(self.sample),
            "sampleMedian": median(self.sample) if self.sample else None,
        }


@contextmanager
def _open_text(path: Path) -> Iterator[TextIO]:
    if path.name.lower().endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as file:
            yield file
        return
    with path.open(encoding="utf-8") as file:
        yield file


def _example(raw: Any, line: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"line": line}
    return {"line": line, "isbn13": raw.get("isbn13")}


def _issue(
    issues: _IssueCollector,
    *,
    severity: str,
    code: str,
    line: int,
    field: str | None,
    message: str,
    raw: Any,
) -> None:
    issues.add(
        ValidationIssue(
            severity=severity,
            code=code,
            line=line,
            field=field,
            message=message,
            example=_example(raw, line),
        )
    )


def _month_key(value: str) -> tuple[int, int] | None:
    match = MONTH_PATTERN.fullmatch(value)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _check_relation_field(
    raw: dict[str, Any], field: str, line: int, issues: _IssueCollector
) -> int:
    value = raw.get(field)
    if value is None:
        return 0
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
        return 0

    valid_items = 0
    seen_targets: set[str] = set()
    for position, item in enumerate(value):
        if not isinstance(item, list) or len(item) < 2:
            _issue(
                issues,
                severity="error",
                code="relation_item_invalid",
                line=line,
                field=field,
                message=f"relation item {position} must contain isbn13 and title",
                raw=raw,
            )
            break
        target_isbn, target_title = item[0], item[1]
        if not isinstance(target_isbn, str) or ISBN13_PATTERN.fullmatch(target_isbn) is None:
            _issue(
                issues,
                severity="warning",
                code="relation_isbn_invalid",
                line=line,
                field=field,
                message=f"relation item {position} contains an invalid isbn13",
                raw=raw,
            )
            break
        if not isinstance(target_title, str) or not target_title.strip():
            _issue(
                issues,
                severity="error",
                code="relation_title_invalid",
                line=line,
                field=field,
                message=f"relation item {position} must contain a non-empty title",
                raw=raw,
            )
            break
        if target_isbn in seen_targets:
            _issue(
                issues,
                severity="warning",
                code="relation_target_duplicate",
                line=line,
                field=field,
                message="relation field contains the same target ISBN more than once",
                raw=raw,
            )
        seen_targets.add(target_isbn)
        valid_items += 1
    return valid_items


def _check_loan_history(
    raw: dict[str, Any],
    line: int,
    issues: _IssueCollector,
) -> list[tuple[tuple[int, int], int, int]]:
    value = raw.get("loan_history")
    if value is None:
        return []
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
        return []

    valid_items: list[tuple[tuple[int, int], int, int]] = []
    seen_months: set[tuple[int, int]] = set()
    for position, item in enumerate(value):
        valid = (
            isinstance(item, list)
            and len(item) >= 3
            and isinstance(item[0], str)
            and _month_key(item[0]) is not None
            and isinstance(item[1], int)
            and not isinstance(item[1], bool)
            and isinstance(item[2], int)
            and not isinstance(item[2], bool)
            and item[1] >= 0
            and item[2] >= 0
        )
        if not valid:
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
        month = _month_key(item[0])
        assert month is not None
        if month in seen_months:
            _issue(
                issues,
                severity="warning",
                code="loan_history_month_duplicate",
                line=line,
                field="loan_history",
                message="loan_history contains the same month more than once",
                raw=raw,
            )
        seen_months.add(month)
        valid_items.append((month, item[1], item[2]))
    return valid_items


def _check_loan_groups(raw: dict[str, Any], line: int, issues: _IssueCollector) -> int:
    value = raw.get("loan_grps")
    if value is None:
        return 0
    if not isinstance(value, list):
        _issue(
            issues,
            severity="error",
            code="loan_groups_not_array",
            line=line,
            field="loan_grps",
            message="loan_grps must be an array",
            raw=raw,
        )
        return 0
    valid_items = 0
    for position, item in enumerate(value):
        valid = (
            isinstance(item, list)
            and len(item) >= 4
            and isinstance(item[0], str)
            and isinstance(item[1], str)
            and isinstance(item[2], int)
            and not isinstance(item[2], bool)
            and isinstance(item[3], int)
            and not isinstance(item[3], bool)
            and item[2] >= 0
            and item[3] >= 0
        )
        if not valid:
            _issue(
                issues,
                severity="error",
                code="loan_groups_item_invalid",
                line=line,
                field="loan_grps",
                message=f"loan_grps item {position} must be [age_group, gender, non-negative integer, non-negative integer]",
                raw=raw,
            )
            break
        valid_items += 1
    return valid_items


def _validate_record(
    raw: Any,
    line: int,
    seen: set[str],
    issues: _IssueCollector,
) -> tuple[bool, dict[str, int], list[tuple[tuple[int, int], int, int]], int]:
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
        return False, {}, [], 0

    valid = True
    for field_name in REQUIRED_FIELDS:
        value = raw.get(field_name)
        if value is None or (isinstance(value, str) and not value.strip()):
            _issue(
                issues,
                severity="error",
                code="required_missing",
                line=line,
                field=field_name,
                message="required field is missing or empty",
                raw=raw,
            )
            valid = False

    if not isinstance(raw.get("bookname"), str) or not raw["bookname"].strip():
        _issue(
            issues,
            severity="error",
            code="bookname_invalid",
            line=line,
            field="bookname",
            message="bookname must be a non-empty string",
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

    for field_name in OPTIONAL_FIELDS:
        value = raw.get(field_name)
        if value is None:
            continue
        if field_name == "loan_grps":
            continue
        if field_name == "ok" and not isinstance(value, bool):
            _issue(
                issues,
                severity="error",
                code="optional_type_invalid",
                line=line,
                field=field_name,
                message="ok must be a boolean when present",
                raw=raw,
            )
            valid = False
        elif field_name != "ok" and not isinstance(value, str):
            _issue(
                issues,
                severity="error",
                code="optional_type_invalid",
                line=line,
                field=field_name,
                message=f"{field_name} must be a string when present",
                raw=raw,
            )
            valid = False

    relation_edges: dict[str, int] = {}
    for field_name in RELATION_FIELDS:
        relation_edges[field_name] = _check_relation_field(raw, field_name, line, issues)
    history = _check_loan_history(raw, line, issues)
    group_count = _check_loan_groups(raw, line, issues)
    return valid, relation_edges, history, group_count


def _valid_relation_targets(raw: Any, field_name: str) -> Iterator[str]:
    if not isinstance(raw, dict):
        return
    value = raw.get(field_name)
    if not isinstance(value, list):
        return
    for item in value:
        if (
            isinstance(item, list)
            and len(item) >= 2
            and isinstance(item[0], str)
            and ISBN13_PATTERN.fullmatch(item[0]) is not None
            and isinstance(item[1], str)
            and item[1].strip()
        ):
            yield item[0]


def validate_d4l_jsonl(path: Path, max_examples: int = 5) -> dict[str, Any]:
    issues = _IssueCollector(max_examples=max(0, max_examples))
    seen: set[str] = set()
    field_presence: Counter[str] = Counter()
    extra_fields: Counter[str] = Counter()
    rows = 0
    valid_rows = 0
    relation_records: Counter[str] = Counter()
    relation_edges: Counter[str] = Counter()
    loan_total_stats = _NumericStats()
    latest_loan_stats = _NumericStats()
    latest_rank_stats = _NumericStats()
    latest_month_counts: Counter[str] = Counter()
    history_rows = 0
    records_with_history = 0
    records_with_loan_groups = 0
    loan_group_rows = 0
    loan_group_age_counts: Counter[str] = Counter()
    loan_group_gender_counts: Counter[str] = Counter()
    minimum_month: tuple[int, int] | None = None
    maximum_month: tuple[int, int] | None = None
    input_readable = True

    try:
        with _open_text(path) as file:
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
                if not isinstance(raw, dict):
                    _validate_record(raw, line_number, seen, issues)
                    continue

                for field_name in raw:
                    field_presence[field_name] += 1
                    if field_name not in KNOWN_FIELDS:
                        extra_fields[field_name] += 1

                row_valid, row_relation_edges, history, group_count = _validate_record(raw, line_number, seen, issues)
                if row_valid:
                    valid_rows += 1
                for field_name, edge_count in row_relation_edges.items():
                    if raw.get(field_name) is not None:
                        relation_records[field_name] += 1
                    relation_edges[field_name] += edge_count

                loan_total = raw.get("loan_total")
                if isinstance(loan_total, int) and not isinstance(loan_total, bool) and loan_total >= 0:
                    loan_total_stats.add(loan_total)

                if history:
                    records_with_history += 1
                    history_rows += len(history)
                    record_minimum = min(item[0] for item in history)
                    record_maximum = max(item[0] for item in history)
                    minimum_month = record_minimum if minimum_month is None else min(minimum_month, record_minimum)
                    maximum_month = record_maximum if maximum_month is None else max(maximum_month, record_maximum)
                    latest_month, latest_loan, latest_rank = max(history, key=lambda item: item[0])
                    latest_month_counts[f"{latest_month[0]:04d}년 {latest_month[1]:02d}월"] += 1
                    latest_loan_stats.add(latest_loan)
                    latest_rank_stats.add(latest_rank)

                loan_groups = raw.get("loan_grps")
                if isinstance(loan_groups, list) and group_count:
                    records_with_loan_groups += 1
                    loan_group_rows += group_count
                    for group in loan_groups[:group_count]:
                        loan_group_age_counts[group[0]] += 1
                        loan_group_gender_counts[group[1]] += 1
    except OSError as error:
        input_readable = False
        _issue(
            issues,
            severity="error",
            code="input_unreadable",
            line=0,
            field=None,
            message=error.strerror or "input could not be read",
            raw=None,
        )

    if input_readable and rows:
        for field_name in OPTIONAL_FIELDS:
            missing_count = rows - field_presence[field_name]
            if missing_count:
                _issue(
                    issues,
                    severity="warning",
                    code="nullable_missing",
                    line=0,
                    field=field_name,
                    message=f"optional source field is missing in {missing_count} of {rows} rows",
                    raw=None,
                )
        for field_name, count in sorted(extra_fields.items()):
            _issue(
                issues,
                severity="warning",
                code="unexpected_field",
                line=0,
                field=field_name,
                message=f"field is not part of the documented D4L source contract ({count} rows)",
                raw=None,
            )

    relation_coverage: dict[str, dict[str, Any]] = {
        field_name: {
            "recordsWithRelation": relation_records[field_name],
            "edges": relation_edges[field_name],
            "targetsInSnapshot": 0,
            "targetsOutsideSnapshot": 0,
            "targetCoverage": None,
        }
        for field_name in RELATION_FIELDS
    }

    if input_readable:
        try:
            with _open_text(path) as file:
                for line in file:
                    if not line.strip():
                        continue
                    try:
                        raw = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    for field_name in RELATION_FIELDS:
                        for target_isbn in _valid_relation_targets(raw, field_name):
                            if target_isbn in seen:
                                relation_coverage[field_name]["targetsInSnapshot"] += 1
                            else:
                                relation_coverage[field_name]["targetsOutsideSnapshot"] += 1
        except OSError:
            _issue(
                issues,
                severity="error",
                code="input_unreadable",
                line=0,
                field=None,
                message="input could not be re-opened for relation coverage analysis",
                raw=None,
            )

    for stats in relation_coverage.values():
        edge_count = stats["edges"]
        stats["targetCoverage"] = stats["targetsInSnapshot"] / edge_count if edge_count else None

    def month_text(value: tuple[int, int] | None) -> str | None:
        return f"{value[0]:04d}년 {value[1]:02d}월" if value else None

    errors = issues.errors
    return {
        "contract": "d4l-usage-v1",
        "rows": rows,
        "validRows": valid_rows,
        "blockingErrors": errors,
        "warnings": issues.warnings,
        "ruleCounts": dict(sorted(issues.counts.items())),
        "examples": issues.examples,
        "observedFields": dict(sorted(field_presence.items())),
        "extraFields": dict(sorted(extra_fields.items())),
        "derivedFields": {
            "l1Candidate": "not_provided",
            "demandFeature": "not_provided",
            "note": "L1 and demand features must be derived in a later approved batch; this validator does not invent them.",
        },
        "stats": {
            "fieldPresence": dict(sorted(field_presence.items())),
            "loanTotal": loan_total_stats.as_dict(),
            "loanHistory": {
                "recordsWithHistory": records_with_history,
                "historyCoverage": records_with_history / rows if rows else 0.0,
                "historyRows": history_rows,
                "monthRange": {"min": month_text(minimum_month), "max": month_text(maximum_month)},
                "latestMonthCounts": dict(sorted(latest_month_counts.items())),
                "latestLoanCount": latest_loan_stats.as_dict(),
                "latestNationalRank": latest_rank_stats.as_dict(),
            },
            "loanGroups": {
                "recordsWithGroups": records_with_loan_groups,
                "groupRows": loan_group_rows,
                "ageGroupCounts": dict(sorted(loan_group_age_counts.items())),
                "genderCounts": dict(sorted(loan_group_gender_counts.items())),
            },
            "relations": relation_coverage,
        },
        "status": "FAIL" if errors else "PASS",
    }
