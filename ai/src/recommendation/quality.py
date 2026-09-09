from __future__ import annotations

from dataclasses import dataclass
import gzip
import json
import math
from pathlib import Path
from typing import Any, Mapping

from recommendation.baseline import (
    _cosine,
    _diversity_at_k,
    _latest_loan,
    _relation_score,
    _relation_targets,
    _vectors,
)
from recommendation.d4l import D4LBook


FEATURES = ("semantic", "tagMatch", "coLoan", "trending", "steady")
DEFAULT_WEIGHT_CONFIGS: tuple[dict[str, Any], ...] = (
    {
        "name": "semantic-heavy",
        "weights": {"semantic": 0.55, "tagMatch": 0.15, "coLoan": 0.15, "trending": 0.10, "steady": 0.05},
    },
    {
        "name": "balanced",
        "weights": {"semantic": 0.45, "tagMatch": 0.25, "coLoan": 0.15, "trending": 0.10, "steady": 0.05},
    },
    {
        "name": "relation-heavy",
        "weights": {"semantic": 0.25, "tagMatch": 0.15, "coLoan": 0.45, "trending": 0.10, "steady": 0.05},
    },
    {
        "name": "demand-heavy",
        "weights": {"semantic": 0.20, "tagMatch": 0.10, "coLoan": 0.15, "trending": 0.30, "steady": 0.25},
    },
)


@dataclass(frozen=True, slots=True)
class WeightConfig:
    name: str
    weights: dict[str, float]

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("weight config name must not be empty")
        if set(self.weights) != set(FEATURES):
            raise ValueError(f"weight config must contain exactly: {', '.join(FEATURES)}")
        values = tuple(float(value) for value in self.weights.values())
        if any(not math.isfinite(value) or value < 0 for value in values):
            raise ValueError("weight config values must be finite and non-negative")
        if sum(values) <= 0:
            raise ValueError("weight config must contain a positive weight")


def _validated_configs(weight_configs: Any) -> tuple[WeightConfig, ...]:
    raw_configs = DEFAULT_WEIGHT_CONFIGS if weight_configs is None else weight_configs
    configs: list[WeightConfig] = []
    for raw in raw_configs:
        if isinstance(raw, WeightConfig):
            config = raw
        elif isinstance(raw, Mapping) and isinstance(raw.get("name"), str) and isinstance(raw.get("weights"), Mapping):
            config = WeightConfig(raw["name"], {key: float(raw["weights"][key]) for key in raw["weights"]})
        else:
            raise ValueError("weight configs must contain name and weights")
        if any(existing.name == config.name for existing in configs):
            raise ValueError(f"duplicate weight config name: {config.name}")
        configs.append(config)
    if not configs:
        raise ValueError("at least one weight config is required")
    return tuple(configs)


def load_tag_sidecar(path: Path) -> dict[str, frozenset[str]]:
    """Load only ISBN-to-tag-code mappings from a generated JSONL sidecar."""
    if not path.is_file():
        raise ValueError(f"tag sidecar was not found: {path}")
    opener = gzip.open if path.name.lower().endswith(".gz") else Path.open
    mappings: dict[str, frozenset[str]] = {}
    try:
        with opener(path, "rt", encoding="utf-8") as file:
            for line in file:
                if not line.strip():
                    continue
                record = json.loads(line)
                isbn13 = record.get("isbn13") if isinstance(record, dict) else None
                tag_codes = record.get("tagCodes") if isinstance(record, dict) else None
                if isinstance(isbn13, str) and isinstance(tag_codes, list):
                    codes = frozenset(code.strip() for code in tag_codes if isinstance(code, str) and code.strip())
                    mappings[isbn13.strip()] = codes
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("tag sidecar could not be read") from error
    return mappings


def _tag_match(query_tags: frozenset[str], candidate_tags: frozenset[str]) -> float:
    if not query_tags:
        return 0.0
    return len(query_tags & candidate_tags) / len(query_tags)


def _normalised(value: int, maximum: int) -> float | None:
    return value / maximum if maximum else None


def _score(features: Mapping[str, float | None], weights: Mapping[str, float]) -> float:
    weighted = [(weights[name], value) for name, value in features.items() if value is not None and weights[name] > 0]
    denominator = sum(weight for weight, _value in weighted)
    return sum(weight * value for weight, value in weighted) / denominator if denominator else 0.0


def _rank(
    books: list[D4LBook],
    vectors: list[dict[str, float]],
    query_position: int,
    *,
    config: WeightConfig,
    tag_codes_by_isbn: Mapping[str, frozenset[str]] | None,
    maximum_loan: int,
    maximum_latest: int,
    limit: int,
) -> tuple[list[D4LBook], dict[str, int]]:
    query = books[query_position]
    tag_available = tag_codes_by_isbn is not None and query.isbn13 in tag_codes_by_isbn
    feature_counts = {feature: 0 for feature in FEATURES}
    ranked: list[tuple[float, D4LBook]] = []
    for position, (candidate, vector) in enumerate(zip(books, vectors)):
        if position == query_position:
            continue
        features: dict[str, float | None] = {
            "semantic": max(0.0, min(1.0, _cosine(vectors[query_position], vector))),
            "tagMatch": (
                _tag_match(tag_codes_by_isbn[query.isbn13], tag_codes_by_isbn[candidate.isbn13])
                if tag_available and candidate.isbn13 in tag_codes_by_isbn
                else None
            ),
            "coLoan": _relation_score(query, candidate.isbn13),
            "trending": _normalised(_latest_loan(candidate), maximum_latest),
            "steady": _normalised(candidate.loan_total, maximum_loan),
        }
        for feature, value in features.items():
            if value is not None:
                feature_counts[feature] += 1
        ranked.append((_score(features, config.weights), candidate))
    ranked.sort(key=lambda item: (-item[0], item[1].isbn13))
    return [book for _score_value, book in ranked[:limit]], feature_counts


def _metrics(
    books: list[D4LBook],
    vectors: list[dict[str, float]],
    config: WeightConfig,
    *,
    tag_codes_by_isbn: Mapping[str, frozenset[str]] | None,
    k: int,
    recall_k: int,
    targets_by_isbn: Mapping[str, set[str]],
    indexed_targets: int,
    all_targets: int,
) -> dict[str, Any]:
    books_by_isbn = {book.isbn13: book for book in books}
    positions = {book.isbn13: position for position, book in enumerate(books)}
    maximum_loan = max((book.loan_total for book in books), default=0)
    maximum_latest = max((_latest_loan(book) for book in books), default=0)
    precisions: list[float] = []
    recalls: list[float] = []
    diversities: list[float] = []
    feature_counts = {feature: 0 for feature in FEATURES}
    candidate_shortage = 0
    for isbn13, targets in targets_by_isbn.items():
        recommendations, counts = _rank(
            books,
            vectors,
            positions[isbn13],
            config=config,
            tag_codes_by_isbn=tag_codes_by_isbn,
            maximum_loan=maximum_loan,
            maximum_latest=maximum_latest,
            limit=recall_k,
        )
        for feature, count in counts.items():
            feature_counts[feature] += count
        top_k = recommendations[:k]
        hits_at_k = sum(book.isbn13 in targets for book in top_k)
        hits_at_recall_k = sum(book.isbn13 in targets for book in recommendations)
        precisions.append(hits_at_k / k)
        recalls.append(hits_at_recall_k / len(targets))
        recommendation_rows = [{"isbn13": book.isbn13} for book in recommendations]
        diversities.append(_diversity_at_k(recommendation_rows, books_by_isbn, k))
        if len(top_k) < k:
            candidate_shortage += 1
    denominator = len(targets_by_isbn)
    metrics = {
        "pAt5": round(sum(precisions) / denominator, 6) if denominator else 0.0,
        "recallAt10": round(sum(recalls) / denominator, 6) if denominator else 0.0,
        "coverage": round(indexed_targets / all_targets, 6) if all_targets else 0.0,
        "diversityAt5": round(sum(diversities) / denominator, 6) if denominator else 0.0,
        "evaluatedQueries": denominator,
        "candidateShortageQueries": candidate_shortage,
        "targetDenominator": all_targets,
        "indexedTargetDenominator": indexed_targets,
        "featureAvailability": {
            feature: round(count / (denominator * (len(books) - 1)), 6)
            if denominator and len(books) > 1
            else 0.0
            for feature, count in feature_counts.items()
        },
    }
    metrics["selectionScore"] = round(
        0.5 * metrics["pAt5"]
        + 0.3 * metrics["recallAt10"]
        + 0.1 * metrics["coverage"]
        + 0.1 * metrics["diversityAt5"],
        6,
    )
    return metrics


def evaluate_weight_grid(
    books: list[D4LBook],
    *,
    tag_codes_by_isbn: Mapping[str, frozenset[str]] | None = None,
    weight_configs: Any = None,
    k: int = 5,
    recall_k: int = 10,
    input_hash: str | None = None,
) -> dict[str, Any]:
    """Evaluate deterministic weight configurations against D4L relation targets."""
    if not books:
        raise ValueError("books must not be empty")
    if k < 1 or recall_k < k:
        raise ValueError("recall_k must be greater than or equal to k, and both must be positive")
    configs = _validated_configs(weight_configs)
    known_isbns = {book.isbn13 for book in books}
    targets_by_isbn = {
        book.isbn13: _relation_targets(book) & known_isbns
        for book in books
        if _relation_targets(book) & known_isbns
    }
    all_targets = sum(len(_relation_targets(book)) for book in books)
    indexed_targets = sum(len(targets) for targets in targets_by_isbn.values())
    vectors = _vectors(books)
    config_reports = []
    for config in configs:
        metrics = _metrics(
            books,
            vectors,
            config,
            tag_codes_by_isbn=tag_codes_by_isbn,
            k=k,
            recall_k=recall_k,
            targets_by_isbn=targets_by_isbn,
            indexed_targets=indexed_targets,
            all_targets=all_targets,
        )
        config_reports.append({"name": config.name, "weights": config.weights, "metrics": metrics})
    config_order = {config.name: position for position, config in enumerate(configs)}
    recommended = max(
        config_reports,
        key=lambda report: (report["metrics"]["selectionScore"], -config_order[report["name"]]),
    )
    return {
        "weightTuningVersion": "d4l-weight-tuning-v1",
        "semanticAlgorithm": "tfidf-content-v1-proxy",
        "inputHash": input_hash or "not-provided",
        "targetRelations": ["co_loan", "mania_rec", "reader_rec"],
        "queries": len(books),
        "evaluatedQueries": len(targets_by_isbn),
        "k": k,
        "recallK": recall_k,
        "targetCoverage": round(indexed_targets / all_targets, 6) if all_targets else 0.0,
        "targetDenominator": all_targets,
        "indexedTargetDenominator": indexed_targets,
        "outOfIndexTargetCount": all_targets - indexed_targets,
        "tagSidecarRows": len(tag_codes_by_isbn) if tag_codes_by_isbn is not None else 0,
        "weightConfigs": config_reports,
        "recommendedConfig": recommended["name"],
        "recommendedWeights": recommended["weights"],
    }


__all__ = ["DEFAULT_WEIGHT_CONFIGS", "FEATURES", "WeightConfig", "evaluate_weight_grid", "load_tag_sidecar"]
