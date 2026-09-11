from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from recommendation.d4l import D4LBook, iter_d4l_jsonl
from recommendation.normalization import normalized_input_hash


TAXONOMY_VERSION = "book-taxonomy-v1"
DEFAULT_TAG_VERSION = "d4l-tags-v1"
_TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣]+")


@dataclass(frozen=True, slots=True)
class TagDefinition:
    code: str
    label: str


TAXONOMY: tuple[TagDefinition, ...] = (
    TagDefinition("FIC", "소설"),
    TagDefinition("ESSAY", "에세이"),
    TagDefinition("SCIENCE", "과학"),
    TagDefinition("HISTORY", "역사"),
    TagDefinition("ECONOMY", "경제·경영"),
    TagDefinition("FANTASY", "판타지"),
    TagDefinition("MYSTERY", "미스터리"),
    TagDefinition("ROMANCE", "로맨스"),
    TagDefinition("GROWTH", "성장"),
    TagDefinition("FAMILY", "가족"),
    TagDefinition("TIME_TRAVEL", "시간여행"),
    TagDefinition("TRENDING", "최근 인기"),
    TagDefinition("STEADY", "꾸준한 대출"),
    TagDefinition("NEW_BOOK", "신간"),
)
TAXONOMY_BY_CODE = {definition.code: definition for definition in TAXONOMY}


@dataclass(frozen=True, slots=True)
class TagAssignment:
    code: str
    label: str
    source: str
    confidence: float

    def __post_init__(self) -> None:
        if self.code not in TAXONOMY_BY_CODE:
            raise ValueError(f"unknown tag code: {self.code}")
        if self.source not in {"RULE", "GMS"}:
            raise ValueError("tag source must be RULE or GMS")
        if not math.isfinite(float(self.confidence)) or not 0 <= self.confidence <= 1:
            raise ValueError("tag confidence must be between 0 and 1")


class TagProvider(Protocol):
    def generate(self, book: D4LBook) -> Mapping[str, float]: ...


class GmsTagProvider:
    """Generate controlled taxonomy suggestions through a GMS chat endpoint."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        model_version: str,
        timeout_seconds: float = 30.0,
        opener: Any = urlopen,
    ) -> None:
        if not endpoint.strip() or not api_key.strip() or not model_version.strip():
            raise ValueError("endpoint, api_key, and model_version are required")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.model_version = model_version
        self.timeout_seconds = timeout_seconds
        self._opener = opener

    def generate(self, book: D4LBook) -> Mapping[str, float]:
        definitions = ", ".join(f"{item.code}: {item.label}" for item in TAXONOMY)
        source = {
            "bookname": book.title,
            "authors": book.authors,
            "publisher": book.publisher,
            "pub_year": book.pub_year,
            "class_no": book.class_no,
            "class_nm": book.class_nm,
        }
        body = {
            "model": self.model_version,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "도서 메타데이터를 통제된 taxonomy에 매핑한다. "
                        "JSON object 하나만 반환하고 tags 배열의 각 원소는 code와 confidence(0~1)를 가진다. "
                        f"허용 code는 다음뿐이다: {definitions}"
                    ),
                },
                {"role": "user", "content": json.dumps(source, ensure_ascii=False, sort_keys=True)},
            ],
        }
        request = Request(
            self.endpoint,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            response = self._opener(request, timeout=self.timeout_seconds)
            payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise RuntimeError(f"tag provider returned HTTP {error.code}") from error
        except (TimeoutError, URLError, OSError) as error:
            raise RuntimeError("tag provider request failed") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("tag provider returned invalid JSON") from error

        content = None
        if isinstance(payload, dict):
            choices = payload.get("choices")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message")
                content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise RuntimeError("tag provider response is missing JSON content")
        try:
            document = json.loads(content)
        except json.JSONDecodeError as error:
            raise RuntimeError("tag provider content is not valid JSON") from error
        raw_tags = document.get("tags") if isinstance(document, dict) else None
        if not isinstance(raw_tags, list):
            raise RuntimeError("tag provider content is missing tags")
        suggestions: dict[str, float] = {}
        for item in raw_tags:
            if not isinstance(item, dict) or not isinstance(item.get("code"), str):
                continue
            code = item["code"].strip()
            confidence = item.get("confidence")
            if code in TAXONOMY_BY_CODE and isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
                numeric = float(confidence)
                if math.isfinite(numeric) and 0 <= numeric <= 1:
                    suggestions[code] = numeric
        return suggestions


def _text(book: D4LBook) -> str:
    # Keep this list aligned with the Jira input contract. Description/keywords
    # are intentionally excluded even when present in the source snapshot.
    values = (book.title, book.authors, book.publisher, book.pub_year or "", book.class_no or "", book.class_nm or "")
    return " ".join(value.casefold() for value in values if value.strip())


def _contains(text: str, *terms: str) -> bool:
    return any(term.casefold() in text for term in terms)


class RuleBasedTagger:
    """Conservative, deterministic taxonomy mapping from available D4L fields."""

    def __init__(self, *, reference_year: int = 2026) -> None:
        if reference_year < 1900:
            raise ValueError("reference_year must be realistic")
        self.reference_year = reference_year

    def generate(self, book: D4LBook) -> tuple[TagAssignment, ...]:
        text = _text(book)
        assignments: dict[str, TagAssignment] = {}

        def add(code: str, confidence: float) -> None:
            definition = TAXONOMY_BY_CODE[code]
            assignments[code] = TagAssignment(code, definition.label, "RULE", confidence)

        if _contains(text, "소설", "문학") or (book.class_no or "").startswith(("81", "82", "83", "84", "85")):
            add("FIC", 0.92)
        if _contains(text, "에세이", "수필"):
            add("ESSAY", 0.95)
        if _contains(text, "과학", "자연과학", "기술과학") or (book.class_no or "").startswith("4"):
            add("SCIENCE", 0.86)
        if _contains(text, "역사", "한국사", "세계사") or (book.class_no or "").startswith("9"):
            add("HISTORY", 0.88)
        if _contains(text, "경제", "경영", "투자", "재테크"):
            add("ECONOMY", 0.9)
        if _contains(text, "판타지", "마법", "용사", "마녀"):
            add("FANTASY", 0.9)
        if _contains(text, "추리", "미스터리", "탐정", "범죄"):
            add("MYSTERY", 0.9)
        if _contains(text, "로맨스", "연애", "사랑"):
            add("ROMANCE", 0.82)
        if _contains(text, "성장", "자기계발", "습관"):
            add("GROWTH", 0.8)
        if _contains(text, "가족", "부모", "자녀"):
            add("FAMILY", 0.82)
        if _contains(text, "시간여행", "타임슬립"):
            add("TIME_TRAVEL", 0.95)
        if book.pub_year and book.pub_year.isdigit() and int(book.pub_year) >= self.reference_year - 1:
            add("NEW_BOOK", 0.78)
        return tuple(assignments[code] for code in sorted(assignments))


@dataclass(frozen=True, slots=True)
class TagGenerationResult:
    tags: tuple[TagAssignment, ...]
    gms_attempts: int
    gms_error: str | None = None
    gms_skipped: bool = False
    gms_skip_reason: str | None = None


class TagGenerator:
    def __init__(
        self,
        *,
        rule_tagger: RuleBasedTagger | None = None,
        gms_provider: TagProvider | None = None,
        max_retries: int = 2,
        low_confidence_threshold: float = 0.6,
        rule_confidence_threshold: float = 0.85,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries must not be negative")
        if not 0 <= low_confidence_threshold <= 1:
            raise ValueError("low_confidence_threshold must be between 0 and 1")
        if not 0 <= rule_confidence_threshold <= 1:
            raise ValueError("rule_confidence_threshold must be between 0 and 1")
        self.rule_tagger = rule_tagger or RuleBasedTagger()
        self.gms_provider = gms_provider
        self.max_retries = max_retries
        self.low_confidence_threshold = low_confidence_threshold
        self.rule_confidence_threshold = rule_confidence_threshold

    def generate(self, book: D4LBook) -> TagGenerationResult:
        assignments = {tag.code: tag for tag in self.rule_tagger.generate(book)}
        if self.gms_provider is None:
            return TagGenerationResult(tuple(assignments[code] for code in sorted(assignments)), 0)

        if assignments and any(
            tag.confidence >= self.rule_confidence_threshold for tag in assignments.values()
        ):
            return TagGenerationResult(
                tuple(assignments[code] for code in sorted(assignments)),
                0,
                gms_skipped=True,
                gms_skip_reason="RULE_CONFIDENT",
            )

        attempts = 0
        gms_error: str | None = None
        for attempt in range(self.max_retries + 1):
            attempts += 1
            try:
                suggestions = self.gms_provider.generate(book)
                for code, confidence in suggestions.items():
                    if code not in TAXONOMY_BY_CODE:
                        continue
                    numeric = float(confidence)
                    if math.isfinite(numeric) and 0 <= numeric <= 1:
                        definition = TAXONOMY_BY_CODE[code]
                        candidate = TagAssignment(code, definition.label, "GMS", numeric)
                        current = assignments.get(code)
                        # Rule evidence wins ties; a stronger GMS signal can refine it.
                        if current is None or candidate.confidence > current.confidence:
                            assignments[code] = candidate
                gms_error = None
                break
            except Exception as error:  # provider failures, including rate limits, are retried
                gms_error = str(error) or error.__class__.__name__
                if attempt >= self.max_retries:
                    break
        return TagGenerationResult(tuple(assignments[code] for code in sorted(assignments)), attempts, gms_error)


def _record(
    book: D4LBook,
    result: TagGenerationResult,
    *,
    input_hash: str,
    tag_version: str,
    low_confidence_threshold: float,
) -> dict[str, Any]:
    tags = [
        {"code": tag.code, "label": tag.label, "source": tag.source, "confidence": round(tag.confidence, 4)}
        for tag in result.tags
    ]
    confidences = {tag.code: round(tag.confidence, 4) for tag in result.tags}
    return {
        "isbn13": book.isbn13,
        "inputHash": input_hash,
        "taxonomyVersion": TAXONOMY_VERSION,
        "tagVersion": tag_version,
        "status": "SUCCESS" if tags else "MISSING",
        "tags": tags,
        "tagCodes": [tag["code"] for tag in tags],
        "tagScores": confidences,
        "tagConfidence": confidences,
        "lowConfidence": any(tag["confidence"] < low_confidence_threshold for tag in tags),
        "gmsError": result.gms_error,
        "gmsSkipped": result.gms_skipped,
        "gmsSkipReason": result.gms_skip_reason,
    }


def _load_existing(path: Path, *, input_hash: str, tag_version: str) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    existing: dict[str, dict[str, Any]] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if (
                isinstance(record, dict)
                and record.get("inputHash") == input_hash
                and record.get("tagVersion") == tag_version
                and isinstance(record.get("isbn13"), str)
            ):
                existing[record["isbn13"]] = record
    except (OSError, json.JSONDecodeError):
        return {}
    return existing


class TagBatchRunner:
    """Generate a restartable JSONL tag sidecar without modifying source data."""

    def __init__(self, *, generator: TagGenerator, tag_version: str = DEFAULT_TAG_VERSION) -> None:
        if not tag_version.strip():
            raise ValueError("tag_version must not be empty")
        self.generator = generator
        self.tag_version = tag_version

    def run(self, input_path: Path, output_path: Path) -> dict[str, Any]:
        input_hash = normalized_input_hash(input_path)
        existing = _load_existing(output_path, input_hash=input_hash, tag_version=self.tag_version)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = output_path.with_name(f".{output_path.name}.tmp")
        rows = succeeded = missing = low_confidence = resumed = gms_failures = gms_attempts = 0
        gms_skipped = 0
        with temporary.open("w", encoding="utf-8", newline="\n") as output:
            for book in iter_d4l_jsonl(input_path):
                rows += 1
                record = existing.get(book.isbn13)
                if record is not None:
                    resumed += 1
                else:
                    result = self.generator.generate(book)
                    gms_attempts += result.gms_attempts
                    gms_failures += bool(result.gms_error)
                    record = _record(
                        book,
                        result,
                        input_hash=input_hash,
                        tag_version=self.tag_version,
                        low_confidence_threshold=self.generator.low_confidence_threshold,
                    )
                output.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
                if record["tags"]:
                    succeeded += 1
                else:
                    missing += 1
                low_confidence += bool(record["lowConfidence"])
                gms_skipped += bool(record.get("gmsSkipped"))
        temporary.replace(output_path)
        output_hash = sha256(output_path.read_bytes()).hexdigest()
        return {
            "batchVersion": "d4l-tag-batch-v1",
            "status": "SUCCESS" if rows else "EMPTY",
            "inputHash": input_hash,
            "taxonomyVersion": TAXONOMY_VERSION,
            "tagVersion": self.tag_version,
            "rows": rows,
            "succeededRows": succeeded,
            "missingRows": missing,
            "lowConfidenceRows": low_confidence,
            "resumedRows": resumed,
            "gmsFailures": gms_failures,
            "gmsAttempts": gms_attempts,
            "gmsSkippedRows": gms_skipped,
            "ruleConfidenceThreshold": self.generator.rule_confidence_threshold,
            "outputHash": output_hash,
            "sourceDataCommitted": False,
        }


__all__ = [
    "DEFAULT_TAG_VERSION",
    "GmsTagProvider",
    "TagProvider",
    "RuleBasedTagger",
    "TAXONOMY",
    "TAXONOMY_VERSION",
    "TagAssignment",
    "TagBatchRunner",
    "TagGenerationResult",
    "TagGenerator",
]
