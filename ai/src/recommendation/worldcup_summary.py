from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Callable, Mapping
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from recommendation.d4l import D4LBook, iter_d4l_jsonl
from recommendation.normalization import normalized_input_hash


SUMMARY_VERSION = "book-world-cup-summary-v2"
SELECTION_RULE = "loan_desc_title_unique_v1"
_LEGACY_SELECTION_RULE = "loan_total_desc_isbn13_asc"
_SPOILER_PATTERN = re.compile(r"결말|범인|정체가 밝혀|마지막에 .*죽|최종적으로 .*죽|반전은")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。！？])\s+")


@dataclass(frozen=True, slots=True)
class SummarySettings:
    summary_version: str = SUMMARY_VERSION
    model_version: str = "gpt-4o-mini"
    credits_per_request: float = 2.0
    max_estimated_credits: float = 1200.0
    limit: int = 500
    max_retries: int = 2
    source_period: str | None = None
    source_name: str = "DATA4LIBRARY_CANDIDATES"

    def __post_init__(self) -> None:
        if not self.summary_version.strip() or not self.model_version.strip():
            raise ValueError("summary and model versions are required")
        if not self.source_name.strip() or (self.source_period is not None and len(self.source_period) > 20):
            raise ValueError("source name or period is invalid")
        if self.limit < 1 or self.limit > 500 or self.max_retries < 0:
            raise ValueError("limit must be between 1 and 500 and retries must be non-negative")
        if not math.isfinite(self.credits_per_request) or self.credits_per_request < 0:
            raise ValueError("credits_per_request must be non-negative and finite")
        if not math.isfinite(self.max_estimated_credits) or self.max_estimated_credits < 0:
            raise ValueError("max_estimated_credits must be non-negative and finite")


class GmsSynopsisProvider:
    """OpenAI-compatible GMS chat completion client for anonymous, spoiler-safe synopses."""

    def __init__(self, *, endpoint: str, api_key: str, model: str, timeout_seconds: float = 30,
                 opener: Callable[..., Any] = urlopen) -> None:
        if not endpoint.strip() or not api_key.strip() or not model.strip():
            raise ValueError("endpoint, api_key, and model are required")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")
        self.endpoint = endpoint.strip()
        self.api_key = api_key
        self.model = model.strip()
        self.timeout_seconds = timeout_seconds
        self._opener = opener

    def summarize(self, book: D4LBook) -> str:
        description = (book.description or "").strip()
        if not description:
            raise ValueError("book description is missing")
        # The model receives no title, ISBN, author, publisher or cover URL: fewer identity leaks and less room to invent facts.
        source = {"description": description[:5000], "classification": book.class_nm, "publicationYear": book.pub_year}
        body = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": (
                    "너는 책 이상형 월드컵의 익명 소개문 편집자다. 제공된 도서 소개와 분류만 근거로 한국어 1~2문장의 "
                    "짧은 소개를 만든다. 원문에서 실제 작품의 내용·소재·주제를 설명하는 정보가 있으면 구체적으로 우선 전달한다. "
                    "판매량, 베스트셀러 이력, 수상·평가, 작가 약력, 출판사 홍보 문구를 책의 줄거리나 내용인 것처럼 쓰지 않는다. "
                    "원문이 홍보 정보 위주라면 확인 가능한 주제나 분야만 중립적으로 소개하고, 그럴듯한 줄거리를 지어내지 않는다. "
                    "제목·저자·출판사·ISBN·고유 인명을 쓰지 말고, 책을 특정할 수 있는 표현도 피한다. "
                    "결말·범인·반전 등 스포일러를 쓰지 않는다. 근거에 없는 설정이나 장르를 만들어내지 않는다. "
                    "메타 설명 없이 {\"synopsis\":\"소개문\"} JSON만 반환한다."
                )},
                {"role": "user", "content": json.dumps(source, ensure_ascii=False, sort_keys=True)},
            ],
        }
        request = Request(self.endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers={
            "Accept": "application/json", "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }, method="POST")
        try:
            response = self._opener(request, timeout=self.timeout_seconds)
            payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise RuntimeError(f"GMS returned HTTP {error.code}") from error
        except (TimeoutError, URLError, OSError) as error:
            raise RuntimeError("GMS synopsis request failed") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("GMS returned invalid JSON") from error
        try:
            content = payload["choices"][0]["message"]["content"]
            parsed = json.loads(content) if isinstance(content, str) else content
            synopsis = parsed["synopsis"]
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
            raise RuntimeError("GMS synopsis response has an invalid shape") from error
        if not isinstance(synopsis, str):
            raise RuntimeError("GMS synopsis must be text")
        return synopsis.strip()


def validate_synopsis(synopsis: str, book: D4LBook) -> str:
    text = " ".join(synopsis.split())
    if not text or len(text) > 360:
        raise ValueError("synopsis must contain 1-2 concise sentences (max 360 chars)")
    sentence_count = len([part for part in _SENTENCE_SPLIT.split(text) if part.strip()])
    if sentence_count > 2:
        raise ValueError("synopsis must contain at most two sentences")
    if _SPOILER_PATTERN.search(text):
        raise ValueError("synopsis appears to contain a spoiler")
    identity_values = [book.title, *(part.strip() for part in re.split(r"[;,|]", book.authors) if part.strip())]
    folded = text.casefold()
    for value in identity_values:
        normalized = " ".join(value.split())
        if len(normalized) >= 3 and normalized.casefold() in folded:
            raise ValueError("synopsis contains book identity text")
    return text


def _source_hash(book: D4LBook) -> str:
    source = json.dumps({
        "description": book.description or "",
        "classification": book.class_nm,
        "publicationYear": book.pub_year,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(source.encode("utf-8")).hexdigest()


def _read_resume(path: Path, *, input_hash: str, summary_version: str) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    saved: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as file:
        for number, line in enumerate(file, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"resume sidecar line {number} is invalid JSON") from error
            if row.get("inputHash") != input_hash or row.get("summaryVersion") != summary_version:
                raise ValueError(f"resume sidecar line {number} belongs to a different input/version")
            if row.get("status") in {"SUCCESS", "MISSING_SOURCE"}:
                saved[row["isbn13"]] = row
    return saved


@dataclass(frozen=True, slots=True)
class CandidateSelection:
    books: list[D4LBook]
    input_rows: int
    eligible_rows: int
    unique_title_rows: int
    duplicate_title_rows: int
    missing_description_rows: int


def _normalized_title(title: str) -> str:
    # Keep subtitles and punctuation (to avoid merging distinct works); normalize width,
    # case, and whitespace so formatting-only differences group together.
    normalized = unicodedata.normalize("NFKC", title).casefold()
    normalized = re.sub(r"\s*([:：])\s*", r"\1", normalized)
    return " ".join(normalized.split())


def _top_books(input_path: Path, limit: int) -> CandidateSelection:
    # Deduplicate the full candidate snapshot before limiting. Otherwise duplicate
    # editions in the raw top-N would leave fewer than N distinct tournament books.
    representatives: dict[str, D4LBook] = {}
    rows = 0
    eligible_rows = 0
    missing_description_rows = 0
    for book in iter_d4l_jsonl(input_path):
        rows += 1
        if not (book.description or "").strip():
            missing_description_rows += 1
            continue
        eligible_rows += 1
        key = _normalized_title(book.title)
        current = representatives.get(key)
        if current is None or book.loan_total > current.loan_total or (
            book.loan_total == current.loan_total and book.isbn13 < current.isbn13
        ):
            # Retain only synopsis inputs and identity-check fields; the source rows may
            # contain large loan-history and co-loan arrays that are irrelevant here.
            representatives[key] = replace(
                book, publisher="", class_no=None, keywords=(), co_loan=(), mania_rec=(),
                reader_rec=(), loan_history=(),
            )

    unique_title_rows = len(representatives)
    selected = sorted(representatives.values(), key=lambda book: (-book.loan_total, book.isbn13))[:limit]
    return CandidateSelection(
        books=selected,
        input_rows=rows,
        eligible_rows=eligible_rows,
        unique_title_rows=unique_title_rows,
        duplicate_title_rows=eligible_rows - unique_title_rows,
        missing_description_rows=missing_description_rows,
    )


class WorldCupSynopsisRunner:
    """Restartable top-N synopsis job. Checkpoint JSONL is preserved as `.tmp` until success."""

    def __init__(self, *, provider: Any, settings: SummarySettings) -> None:
        self.provider = provider
        self.settings = settings

    def run(self, input_path: Path, output_path: Path, report_path: Path,
            resume_paths: tuple[Path, ...] = ()) -> dict[str, Any]:
        input_hash = normalized_input_hash(input_path)
        selection = _top_books(input_path, self.settings.limit)
        books = selection.books
        checkpoint = output_path.with_name(f".{output_path.name}.tmp")
        existing: dict[str, dict[str, Any]] = {}
        for resume_path in resume_paths:
            existing.update(_read_resume(resume_path, input_hash=input_hash, summary_version=self.settings.summary_version))
        existing.update(_read_resume(output_path, input_hash=input_hash, summary_version=self.settings.summary_version))
        existing = {
            isbn: row for isbn, row in existing.items()
            if row.get("sourceName") == self.settings.source_name
            and row.get("sourcePeriod") == self.settings.source_period
            and row.get("selectionRule") in {SELECTION_RULE, _LEGACY_SELECTION_RULE}
        }
        existing.update(_read_resume(checkpoint, input_hash=input_hash, summary_version=self.settings.summary_version))
        reusable = {
            book.isbn13: existing[book.isbn13]
            for book in books
            if book.isbn13 in existing and existing[book.isbn13].get("sourceHash") == _source_hash(book)
        }
        pending_requests = sum(
            bool(book.description) and book.isbn13 not in reusable
            for book in books
        )
        prior_requests = sum(int(row.get("requestCount", 0)) for row in reusable.values())
        estimated = (pending_requests + prior_requests) * self.settings.credits_per_request
        if estimated > self.settings.max_estimated_credits:
            raise ValueError(
                f"estimated GMS cost {estimated:.1f} exceeds hard cap {self.settings.max_estimated_credits:.1f}; no GMS calls made"
            )
        max_requests = (int(self.settings.max_estimated_credits / self.settings.credits_per_request)
                        if self.settings.credits_per_request else 2**31 - 1)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        # Re-copy accepted checkpoint rows into a fresh checkpoint so resume remains deterministic.
        completed = 0
        requests = prior_requests
        failures = missing = 0
        rows_by_isbn = existing
        selected_records: dict[str, dict[str, Any]] = dict(reusable)
        with checkpoint.open("w", encoding="utf-8", newline="\n") as out:
            for rank, book in enumerate(books, 1):
                prior = rows_by_isbn.get(book.isbn13)
                if prior is not None and prior.get("sourceHash") == _source_hash(book):
                    record = {
                        **prior,
                        "loanRank": rank,
                        "loanCount": book.loan_total,
                        "selectionRule": SELECTION_RULE,
                    }
                else:
                    record = None
                    error_text = None
                    row_requests = 0
                    for attempt in range(self.settings.max_retries + 1):
                        if requests >= max_requests:
                            error_text = "GMS credit request cap reached"
                            break
                        try:
                            requests += 1
                            row_requests += 1
                            synopsis = validate_synopsis(self.provider.summarize(book), book)
                            record = self._record(book, rank, input_hash, "SUCCESS", synopsis, None, request_count=row_requests)
                            break
                        except (RuntimeError, ValueError) as error:
                            error_text = str(error)
                    if record is None:
                        failures += 1
                        record = self._record(book, rank, input_hash, "FAILED", None, error_text, request_count=row_requests)
                out.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
                out.flush()
                completed += 1
                rows_by_isbn[book.isbn13] = record
                selected_records[book.isbn13] = record
                failures = sum(row.get("status") == "FAILED" for row in selected_records.values())
                missing = sum(row.get("status") == "MISSING_SOURCE" for row in selected_records.values())
                report = self._report(input_hash, selection, completed, requests, failures, missing)
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        checkpoint.replace(output_path)
        final = self._report(input_hash, selection, completed, requests, failures, missing)
        final["status"] = "SUCCESS" if failures == 0 and missing == 0 else "PARTIAL"
        final["outputHash"] = sha256(output_path.read_bytes()).hexdigest()
        report_path.write_text(json.dumps(final, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        return final

    def _record(self, book: D4LBook, rank: int, input_hash: str, status: str,
                synopsis: str | None, error: str | None, *, request_count: int) -> dict[str, Any]:
        return {
            "isbn13": book.isbn13, "loanRank": rank, "loanCount": book.loan_total,
            "synopsis": synopsis, "status": status, "error": error,
            "requestCount": request_count,
            "sourceName": self.settings.source_name, "sourcePeriod": self.settings.source_period,
            "selectionRule": SELECTION_RULE,
            "inputHash": input_hash,
            "summaryVersion": self.settings.summary_version, "modelVersion": self.settings.model_version,
            "sourceHash": _source_hash(book),
        }

    def _report(self, input_hash: str, selection: CandidateSelection, completed: int,
                requests: int, failures: int, missing: int) -> dict[str, Any]:
        return {
            "command": "worldcup-summaries", "status": "RUNNING", "inputHash": input_hash,
            "selection": SELECTION_RULE, "inputRows": selection.input_rows,
            "eligibleRows": selection.eligible_rows,
            "uniqueTitleRows": selection.unique_title_rows,
            "duplicateTitleRows": selection.duplicate_title_rows,
            "excludedMissingDescriptionRows": selection.missing_description_rows,
            "selectedRows": len(selection.books), "processedRows": completed,
            "remainingRows": len(selection.books) - completed,
            "successRows": max(0, completed - failures - missing), "missingSourceRows": missing,
            "failedRows": failures, "gmsRequests": requests,
            "estimatedGmsCredits": round(requests * self.settings.credits_per_request, 3),
            "maxEstimatedCredits": self.settings.max_estimated_credits,
            "sourceName": self.settings.source_name, "sourcePeriod": self.settings.source_period,
            "summaryVersion": self.settings.summary_version, "modelVersion": self.settings.model_version,
        }
