from __future__ import annotations

import re
from typing import Any, Iterable, TypeVar


T = TypeVar("T")
SPACE_PATTERN = re.compile(r"\s+")
REPRESENTATIVE_FIELDS = (
    "bookname",
    "authors",
    "publisher",
    "pub_year",
    "class_no",
    "class_nm",
    "add_symbol",
)


def _normalized_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return SPACE_PATTERN.sub(" ", value.strip())


def candidate_secondary_key(book: Any) -> tuple[str, str, str, str]:
    """Return a comparison key without treating it as a merge identity."""
    return (
        _normalized_text(getattr(book, "bookname", "") or getattr(book, "title", "")).casefold(),
        _normalized_text(getattr(book, "authors", "")).casefold(),
        _normalized_text(getattr(book, "class_no", "")).casefold(),
        _normalized_text(getattr(book, "class_nm", "")).casefold(),
    )


def _representative_sort_key(book: Any) -> tuple[Any, ...]:
    completeness = sum(bool(_normalized_text(getattr(book, field, ""))) for field in REPRESENTATIVE_FIELDS)
    loan_total = getattr(book, "loan_total", 0)
    if not isinstance(loan_total, int) or isinstance(loan_total, bool):
        loan_total = 0
    return (
        -completeness,
        -loan_total,
        candidate_secondary_key(book),
        _normalized_text(getattr(book, "publisher", "")).casefold(),
        _normalized_text(getattr(book, "isbn13", "")),
    )


def deduplicate_candidates(candidates: Iterable[T]) -> list[T]:
    """Keep one deterministic representative per exact ISBN13.

    The secondary title/author/category key is only a tie-breaker. Different ISBN13
    values are always returned as separate candidates, even when that key matches.
    """
    by_isbn: dict[str, list[T]] = {}
    for candidate in candidates:
        isbn13 = _normalized_text(getattr(candidate, "isbn13", ""))
        if not isbn13:
            continue
        by_isbn.setdefault(isbn13, []).append(candidate)
    return [min(by_isbn[isbn13], key=_representative_sort_key) for isbn13 in sorted(by_isbn)]


def join_relation_isbns(relation: Iterable[Any], candidate_isbns: set[str]) -> tuple[str, ...]:
    """Join D4L relation targets to candidates by exact ISBN13 only."""
    joined: list[str] = []
    seen: set[str] = set()
    for item in relation:
        if not isinstance(item, (list, tuple)) or not item:
            continue
        isbn13 = _normalized_text(item[0])
        if isbn13 in candidate_isbns and isbn13 not in seen:
            seen.add(isbn13)
            joined.append(isbn13)
    return tuple(joined)
