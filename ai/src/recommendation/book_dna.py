"""Deterministic user Book DNA profile calculation.

The engine only consumes precomputed book DNA.  It does not call an embedding
or LLM provider; the online API can therefore reuse this module without GMS
latency or cost.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import math
import re
from typing import Iterable, Literal, Mapping, Sequence

from recommendation.tag_batch import TAXONOMY


BookStatus = Literal["READ", "WISH"]
ProfileStatus = Literal["READY", "INSUFFICIENT_DATA"]
ISBN13_PATTERN = re.compile(r"^97[89]\d{10}$")


@dataclass(frozen=True, slots=True)
class UserBookSeed:
    """A minimal user-side signal sent by the backend."""

    isbn13: str
    status: BookStatus = "READ"
    rating: int | None = None
    finished_date: date | None = None

    def __post_init__(self) -> None:
        if not ISBN13_PATTERN.fullmatch(self.isbn13):
            raise ValueError("isbn13 must be a valid ISBN13")
        if self.status not in ("READ", "WISH"):
            raise ValueError("status must be READ or WISH")
        if self.rating is not None and self.rating not in range(1, 6):
            raise ValueError("rating must be between 1 and 5")


@dataclass(frozen=True, slots=True)
class BookDnaRecord:
    """Precomputed DNA for one indexed book."""

    isbn13: str
    vector: tuple[float, ...] = ()
    tag_codes: tuple[str, ...] = ()
    genre_code: str | None = None
    class_no: str | None = None

    def __post_init__(self) -> None:
        if not ISBN13_PATTERN.fullmatch(self.isbn13):
            raise ValueError("isbn13 must be a valid ISBN13")
        vector = tuple(float(value) for value in self.vector)
        if vector and any(not math.isfinite(value) for value in vector):
            raise ValueError("vector must contain finite values")
        object.__setattr__(self, "vector", vector)
        object.__setattr__(self, "tag_codes", tuple(dict.fromkeys(code.strip() for code in self.tag_codes if code.strip())))


@dataclass(frozen=True, slots=True)
class DnaScore:
    code: str
    label: str
    score: float


@dataclass(frozen=True, slots=True)
class DnaType:
    code: str
    name: str
    phrase: str
    summary: str


@dataclass(frozen=True, slots=True)
class DnaEvidence:
    read_book_count: int
    rated_book_count: int
    top_genres: tuple[str, ...]
    top_tags: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class BookDnaProfile:
    status: ProfileStatus
    based_on_count: int
    axes: tuple[DnaScore, ...]
    metrics: tuple[DnaScore, ...]
    keywords: tuple[DnaScore, ...]
    profile_type: DnaType | None
    evidence: DnaEvidence
    unresolved_isbns: tuple[str, ...]
    user_vector: tuple[float, ...] | None = None

    def to_dict(self) -> dict[str, object]:
        """Serialize the public profile shape without exposing the user vector."""

        def score(item: DnaScore) -> dict[str, object]:
            return {"code": item.code, "label": item.label, "score": item.score}

        return {
            "status": self.status,
            "basedOnCount": self.based_on_count,
            "axes": [score(item) for item in self.axes],
            "metrics": [score(item) for item in self.metrics],
            "keywords": [score(item) for item in self.keywords],
            "type": None if self.profile_type is None else {
                "code": self.profile_type.code,
                "name": self.profile_type.name,
                "phrase": self.profile_type.phrase,
                "summary": self.profile_type.summary,
            },
            "evidence": {
                "readBookCount": self.evidence.read_book_count,
                "ratedBookCount": self.evidence.rated_book_count,
                "topGenres": list(self.evidence.top_genres),
                "topTags": list(self.evidence.top_tags),
            },
            "unresolvedIsbns": list(self.unresolved_isbns),
        }


AXES: tuple[tuple[str, str], ...] = (
    ("FICTION", "소설"),
    ("ESSAY", "에세이"),
    ("HUMANITIES", "인문·사회"),
    ("BUSINESS", "경제·경영"),
    ("SCIENCE", "과학·기술"),
    ("ART_HISTORY", "예술·역사"),
)
AXIS_CODES = {code for code, _label in AXES}
AI_TO_PUBLIC = {"FIC": "FICTION", "ECONOMY": "BUSINESS", "GROWTH": "SELF_HELP"}
# 책의 장르 태그 → 레이더 축. 여기 없는 코드(TRAVEL 등)는 KDC 앞자리로 정한다(_axis_for) — 98x 기행은 예술·역사, 816 기행문학은 소설.
GENRE_TAG_TO_AXIS = {
    "FIC": "FICTION",
    "FICTION": "FICTION",
    "POETRY": "FICTION",        # 문학 축. KDC 811 도 8 로 시작해 같은 결과
    "ESSAY": "ESSAY",
    "HISTORY": "ART_HISTORY",
    "ART": "ART_HISTORY",
    "SCIENCE": "SCIENCE",
    "TECH": "SCIENCE",          # 축 이름이 「과학·기술」
    "ECONOMY": "BUSINESS",
    "BUSINESS": "BUSINESS",
    "GROWTH": "BUSINESS",
    "SELF_HELP": "BUSINESS",
    "HUMANITIES": "HUMANITIES",
    "SOCIETY": "HUMANITIES",    # 축 이름이 「인문·사회」
}
# 태그 코드 → 화면 라벨. 기본은 배치 taxonomy(tag_batch.TAXONOMY)의 라벨을 그대로 쓰고, DNA 화면 어투가 다른 것만 덮어쓴다.
# 09-18 까지 이 표를 손으로 따로 적어 SCIENCE·HISTORY 가 빠져 있었고, 「자주 읽는 키워드」에 #SCIENCE #HISTORY #HUMANITIES 가 영문 코드 그대로 떴다.
TAG_LABELS: dict[str, str] = {
    **{definition.code: definition.label for definition in TAXONOMY},
    "FICTION": "소설",
    "BUSINESS": "경제·경영",
    "SELF_HELP": "자기계발",
    "MYSTERY": "추리",
    "TRENDING": "지금 뜨는 책",
    "STEADY": "꾸준히 읽는 책",
}
# 키워드 칸에서 빼는 장르 코드 — 장르는 위 레이더 축이 이미 비율로 보여 준다. 남는 것은 소재·신호 태그(판타지·가족·시간여행·신간·꾸준히 읽는 책 …).
GENRE_CODES = frozenset(GENRE_TAG_TO_AXIS) | frozenset({"TRAVEL"})


def _axis_for(record: BookDnaRecord) -> str | None:
    for code in record.tag_codes:
        axis = GENRE_TAG_TO_AXIS.get(code.upper())
        if axis:
            return axis
    class_no = (record.class_no or "").strip()
    if class_no.startswith(("814", "818")):
        return "ESSAY"
    if class_no.startswith("32"):
        return "BUSINESS"
    if class_no.startswith("8"):
        return "FICTION"
    if class_no.startswith("1") or class_no.startswith("2") or class_no.startswith("3"):
        return "HUMANITIES"
    if class_no.startswith("4") or class_no.startswith("5"):
        return "SCIENCE"
    if class_no.startswith("6") or class_no.startswith("9"):
        return "ART_HISTORY"
    return None


def _book_weight(seed: UserBookSeed, *, today: date) -> float:
    status_weight = 1.0 if seed.status == "READ" else 0.25
    rating_weight = {None: 0.8, 1: 0.7, 2: 0.85, 3: 1.0, 4: 1.2, 5: 1.5}[seed.rating]
    if seed.finished_date is None:
        recency_weight = 1.0
    else:
        age_days = max(0, (today - seed.finished_date).days)
        recency_weight = math.exp(-math.log(2) * age_days / 180)
    return status_weight * rating_weight * recency_weight


def _normalise(values: Mapping[str, float], *, limit: float = 100.0) -> dict[str, float]:
    total = sum(values.values())
    if total <= 0:
        return {key: 0.0 for key in values}
    return {key: round(min(limit, value / total * limit), 2) for key, value in values.items()}


def _entropy(shares: Sequence[float]) -> float:
    live = [share for share in shares if share > 0]
    if len(live) <= 1:
        return 0.0
    return -sum(share * math.log(share) for share in live) / math.log(len(AXES))


def _metric_type(metrics: Sequence[DnaScore]) -> DnaType:
    primary = metrics[0].code
    second = metrics[1].label if len(metrics) > 1 else "균형 잡힌"
    table = {
        "REFLECTION": ("THINKER", "사색가", "문장 사이에 오래 머무르며 생각을 넓히는", "좋은 질문 앞에서 오래 생각하는 독자예요."),
        "IMMERSION": ("DIVER", "탐독가", "한번 잡은 이야기를 끝까지 따라가는", "한 권의 이야기에 깊이 빠져드는 독자예요."),
        "EXPLORATION": ("EXPLORER", "탐험가", "다양한 책으로 세상을 넓혀 가는", "새로운 주제와 관점을 찾아가는 독자예요."),
        "EMPATHY": ("EMPATH", "공감가", "사람의 마음이 움직이는 순간을 따라 읽는", "사람과 관계를 다룬 이야기를 오래 기억하는 독자예요."),
        "REALISM": ("OBSERVER", "관찰자", "읽은 것을 자기 삶에 대어 보는", "읽은 것을 현실의 판단과 행동으로 옮기는 독자예요."),
    }
    code, noun, phrase, summary = table[primary]
    return DnaType(code, f"{second} {noun}", phrase, summary)


def build_book_dna_profile(
    seeds: Iterable[UserBookSeed],
    records: Mapping[str, BookDnaRecord],
    *,
    today: date | None = None,
    keyword_limit: int = 10,
) -> BookDnaProfile:
    """Build a reproducible profile from user signals and precomputed book DNA."""

    reference_date = today or date.today()
    unique_seeds: dict[str, UserBookSeed] = {}
    for seed in seeds:
        unique_seeds.setdefault(seed.isbn13, seed)

    unresolved = tuple(sorted(isbn for isbn in unique_seeds if isbn not in records))
    usable = [(seed, records[seed.isbn13], _book_weight(seed, today=reference_date)) for seed in unique_seeds.values() if seed.isbn13 in records]
    read_count = sum(seed.status == "READ" for seed, _record, _weight in usable)
    rated_count = sum(seed.rating is not None for seed, _record, _weight in usable)
    if not usable:
        empty_axes = tuple(DnaScore(code, label, 0.0) for code, label in AXES)
        return BookDnaProfile(
            status="INSUFFICIENT_DATA",
            based_on_count=0,
            axes=empty_axes,
            metrics=(),
            keywords=(),
            profile_type=None,
            evidence=DnaEvidence(0, 0, (), ()),
            unresolved_isbns=unresolved,
        )

    axis_values = {code: 0.0 for code in AXIS_CODES}
    tag_values: dict[str, float] = {}
    vector_values: list[tuple[tuple[float, ...], float]] = []
    for seed, record, weight in usable:
        axis = _axis_for(record)
        if axis:
            axis_values[axis] += weight
        for raw_tag in record.tag_codes:
            tag = raw_tag.upper()
            tag_values[tag] = tag_values.get(tag, 0.0) + weight
        if record.vector:
            vector_values.append((record.vector, weight))

    axis_scores = _normalise(axis_values)
    axes = tuple(DnaScore(code, label, axis_scores[code]) for code, label in AXES)
    shares = {code: axis_values[code] / max(sum(axis_values.values()), 1e-12) for code in AXIS_CODES}
    loved_share = sum(weight for seed, _record, weight in usable if (seed.rating or 0) >= 4) / sum(weight for _seed, _record, weight in usable)
    diversity = _entropy(tuple(shares.values()))
    fiction = shares.get("FICTION", 0.0)
    essay = shares.get("ESSAY", 0.0)
    humanities = shares.get("HUMANITIES", 0.0)
    practical = shares.get("BUSINESS", 0.0) + shares.get("SCIENCE", 0.0) + shares.get("ART_HISTORY", 0.0)
    family = tag_values.get("FAMILY", 0.0) / max(sum(tag_values.values()), 1e-12)
    metrics_raw = {
        "REFLECTION": humanities * 0.75 + essay * 0.55,
        "IMMERSION": fiction * 0.7 + loved_share * 0.3,
        "EXPLORATION": diversity,
        "EMPATHY": fiction * 0.45 + essay * 0.25 + family * 0.3,
        "REALISM": practical,
    }
    metric_labels = {"REFLECTION": "사색", "IMMERSION": "몰입", "EXPLORATION": "새로움", "EMPATHY": "감성", "REALISM": "현실감"}
    metrics = tuple(
        sorted(
            (DnaScore(code, metric_labels[code], round(min(96.0, value * 100), 2)) for code, value in metrics_raw.items()),
            key=lambda item: (-item.score, item.code),
        )
    )
    keyword_scores = _normalise({tag: value for tag, value in tag_values.items() if tag not in GENRE_CODES})
    keywords = tuple(
        DnaScore(tag, TAG_LABELS.get(tag, tag), score)
        for tag, score in sorted(keyword_scores.items(), key=lambda item: (-item[1], item[0]))[:keyword_limit]
    )
    top_genres = tuple(code for code, _label in sorted(axis_values.items(), key=lambda item: (-item[1], item[0])) if axis_values[code] > 0)[:3]
    top_tags = tuple(AI_TO_PUBLIC.get(tag, tag) for tag, _value in sorted(tag_values.items(), key=lambda item: (-item[1], item[0]))[:5])

    user_vector: tuple[float, ...] | None = None
    if vector_values:
        dimension = len(vector_values[0][0])
        if any(len(vector) != dimension for vector, _weight in vector_values):
            raise ValueError("book vectors must have the same dimension")
        total_weight = sum(weight for _vector, weight in vector_values)
        user_vector = tuple(
            sum(vector[position] * weight for vector, weight in vector_values) / total_weight
            for position in range(dimension)
        )

    return BookDnaProfile(
        status="READY",
        based_on_count=read_count,
        axes=axes,
        metrics=metrics,
        keywords=keywords,
        profile_type=_metric_type(metrics),
        evidence=DnaEvidence(read_count, rated_count, top_genres, top_tags),
        unresolved_isbns=unresolved,
        user_vector=user_vector,
    )
