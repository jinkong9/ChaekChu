from __future__ import annotations

from dataclasses import dataclass
import gzip
import json
from pathlib import Path
import re
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, TextIO


class DataError(ValueError):
    """Raised when an input JSONL record cannot be consumed."""


@dataclass(frozen=True, slots=True)
class D4LBook:
    isbn13: str
    title: str
    authors: str
    publisher: str
    pub_year: str | None
    class_no: str | None
    class_nm: str | None
    description: str | None
    keywords: tuple[str, ...]
    loan_total: int
    co_loan: tuple[str, ...]
    mania_rec: tuple[str, ...]
    reader_rec: tuple[str, ...]
    loan_history: tuple[tuple[str, int, int], ...]


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _keywords(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    result: list[str] = []
    for item in value:
        if isinstance(item, list) and item and isinstance(item[0], str):
            word = item[0].strip()
        elif isinstance(item, str):
            word = item.strip()
        else:
            continue
        if word:
            result.append(word)
    return tuple(dict.fromkeys(result))


def _isbn_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    result: list[str] = []
    for item in value:
        if isinstance(item, list) and item and isinstance(item[0], str):
            isbn = item[0].strip()
        else:
            continue
        if isbn:
            result.append(isbn)
    return tuple(dict.fromkeys(result))


def _loan_history(value: Any) -> tuple[tuple[str, int, int], ...]:
    if not isinstance(value, list):
        return ()
    result: list[tuple[str, int, int]] = []
    for item in value:
        if (
            isinstance(item, list)
            and len(item) >= 3
            and isinstance(item[0], str)
            and isinstance(item[1], int)
            and not isinstance(item[1], bool)
            and isinstance(item[2], int)
            and not isinstance(item[2], bool)
        ):
            result.append((item[0].strip(), item[1], item[2]))
    return tuple(result)


def _record(raw: Any, line_number: int) -> D4LBook:
    if not isinstance(raw, dict):
        raise DataError(f"line {line_number}: record must be a JSON object")
    isbn13 = _text(raw.get("isbn13"))
    title = _text(raw.get("bookname")) or _text(raw.get("title"))
    if not isbn13 or not title:
        raise DataError(f"line {line_number}: isbn13 and bookname are required")
    loan_total = raw.get("loan_total", 0)
    if not isinstance(loan_total, int) or isinstance(loan_total, bool) or loan_total < 0:
        raise DataError(f"line {line_number}: loan_total must be a non-negative integer")
    description = _text(raw.get("desc")) or None
    return D4LBook(
        isbn13=isbn13,
        title=title,
        authors=_text(raw.get("authors")),
        publisher=_text(raw.get("publisher")),
        pub_year=_text(raw.get("pub_year")) or None,
        class_no=_text(raw.get("class_no")) or None,
        class_nm=_text(raw.get("class_nm")) or None,
        description=description,
        keywords=_keywords(raw.get("keywords")),
        loan_total=loan_total,
        co_loan=_isbn_list(raw.get("co_loan")),
        mania_rec=_isbn_list(raw.get("mania_rec")),
        reader_rec=_isbn_list(raw.get("reader_rec")),
        loan_history=_loan_history(raw.get("loan_history")),
    )


@contextmanager
def _open_text(path: Path) -> Iterator[TextIO]:
    if path.name.lower().endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as file:
            yield file
        return
    with path.open(encoding="utf-8") as file:
        yield file


def iter_d4l_jsonl(path: Path) -> Iterator[D4LBook]:
    seen: set[str] = set()
    try:
        with _open_text(path) as file:
            for line_number, line in enumerate(file, start=1):
                if not line.strip():
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError as error:
                    raise DataError(f"line {line_number}: invalid JSON") from error
                book = _record(raw, line_number)
                if book.isbn13 in seen:
                    raise DataError(f"line {line_number}: duplicate isbn13 {book.isbn13}")
                seen.add(book.isbn13)
                yield book
    except OSError as error:
        raise DataError(f"input could not be read: {error.strerror or 'I/O error'}") from error


def load_d4l_jsonl(path: Path) -> list[D4LBook]:
    books = list(iter_d4l_jsonl(path))
    if not books:
        raise DataError("input contains no book records")
    return books


TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣]+")


def tokens(book: D4LBook) -> tuple[str, ...]:
    fields: Iterable[str] = (
        book.title,
        book.title,
        book.authors,
        book.publisher,
        book.class_nm or "",
        book.class_no or "",
        book.description or "",
        " ".join(book.keywords),
    )
    return tuple(token.lower() for field in fields for token in TOKEN_PATTERN.findall(field))
