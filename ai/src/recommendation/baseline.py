from __future__ import annotations

from collections import Counter
import math
from typing import Any

from recommendation.d4l import D4LBook, tokens


RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")
RELATION_WEIGHTS = {"co_loan": 1.0, "mania_rec": 0.75, "reader_rec": 0.5}


def _vectors(books: list[D4LBook]) -> list[dict[str, float]]:
    documents = [Counter(tokens(book)) for book in books]
    document_frequency: Counter[str] = Counter()
    for document in documents:
        document_frequency.update(document)
    total = len(books)
    vectors: list[dict[str, float]] = []
    for document in documents:
        vector = {
            term: (1.0 + math.log(count))
            * (math.log((total + 1) / (document_frequency[term] + 1)) + 1.0)
            for term, count in document.items()
        }
        vectors.append(vector)
    return vectors


def _cosine(left: dict[str, float], right: dict[str, float]) -> float:
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    dot = sum(value * right.get(term, 0.0) for term, value in left.items())
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def _result(book: D4LBook, score: float, rank: int) -> dict[str, Any]:
    return {
        "rank": rank,
        "isbn13": book.isbn13,
        "title": book.title,
        "authors": book.authors,
        "score": round(score, 6),
        "loanTotal": book.loan_total,
    }


def _recommend_from_vectors(
    books: list[D4LBook],
    vectors: list[dict[str, float]],
    query_position: int,
    limit: int,
) -> list[dict[str, Any]]:
    ranked = sorted(
        (
            (_cosine(vectors[query_position], vector), book)
            for position, (book, vector) in enumerate(zip(books, vectors))
            if position != query_position
        ),
        key=lambda item: (-item[0], item[1].isbn13),
    )
    return [_result(book, score, rank) for rank, (score, book) in enumerate(ranked[:limit], start=1)]


def recommend_content(books: list[D4LBook], query_isbn: str, limit: int = 10) -> list[dict[str, Any]]:
    if limit < 1:
        raise ValueError("limit must be positive")
    index = {book.isbn13: position for position, book in enumerate(books)}
    if query_isbn not in index:
        raise ValueError(f"query isbn13 was not found: {query_isbn}")
    return _recommend_from_vectors(books, _vectors(books), index[query_isbn], limit)


def recommend_popular(books: list[D4LBook], query_isbn: str, limit: int = 10) -> list[dict[str, Any]]:
    ranked = sorted(
        (book for book in books if book.isbn13 != query_isbn),
        key=lambda book: (-book.loan_total, book.isbn13),
    )
    return [_result(book, float(book.loan_total), rank) for rank, book in enumerate(ranked[:limit], start=1)]


def _latest_loan(book: D4LBook) -> int:
    return max((item[1] for item in book.loan_history), default=0)


def _relation_score(book: D4LBook, candidate_isbn: str) -> float:
    scores: list[float] = []
    for field, field_weight in RELATION_WEIGHTS.items():
        relation = getattr(book, field)
        try:
            rank = relation.index(candidate_isbn) + 1
        except ValueError:
            continue
        scores.append(field_weight / rank)
    return min(1.0, max(scores, default=0.0))


def _hybrid_recommend(books: list[D4LBook], query_isbn: str, limit: int = 10) -> list[dict[str, Any]]:
    if limit < 1:
        raise ValueError("limit must be positive")
    index = {book.isbn13: position for position, book in enumerate(books)}
    if query_isbn not in index:
        raise ValueError(f"query isbn13 was not found: {query_isbn}")
    vectors = _vectors(books)
    maximum_loan = max((book.loan_total for book in books), default=0)
    maximum_latest = max((_latest_loan(book) for book in books), default=0)
    query_position = index[query_isbn]
    query = books[query_position]
    ranked: list[tuple[float, D4LBook]] = []
    for position, (candidate, vector) in enumerate(zip(books, vectors)):
        if position == query_position:
            continue
        semantic = _cosine(vectors[query_position], vector)
        relation = _relation_score(query, candidate.isbn13)
        trending = _latest_loan(candidate) / maximum_latest if maximum_latest else 0.0
        steady = candidate.loan_total / maximum_loan if maximum_loan else 0.0
        score = 0.55 * semantic + 0.25 * relation + 0.10 * trending + 0.10 * steady
        ranked.append((score, candidate))
    ranked.sort(key=lambda item: (-item[0], item[1].isbn13))
    return [_result(book, score, rank) for rank, (score, book) in enumerate(ranked[:limit], start=1)]


def _metric(recommendations: list[dict[str, Any]], target: set[str], k: int) -> tuple[int, float]:
    hits = sum(item["isbn13"] in target for item in recommendations[:k])
    return hits, hits / k if k else 0.0


def evaluate_content(books: list[D4LBook], k: int = 10, recall_k: int = 20) -> dict[str, Any]:
    if k < 1 or recall_k < k:
        raise ValueError("recall_k must be greater than or equal to k, and both must be positive")
    known_isbns = {book.isbn13 for book in books}
    index = {book.isbn13: position for position, book in enumerate(books)}
    vectors = _vectors(books)
    content_p: list[float] = []
    popular_p: list[float] = []
    recalls: list[float] = []
    reciprocal_ranks: list[float] = []
    covered_targets = 0
    total_targets = 0
    evaluated = 0
    for book in books:
        target = set(book.co_loan) & known_isbns
        if not target:
            continue
        evaluated += 1
        covered_targets += len(target)
        total_targets += len(book.co_loan)
        content = _recommend_from_vectors(books, vectors, index[book.isbn13], recall_k)
        popular = recommend_popular(books, book.isbn13, limit=k)
        content_hits, content_precision = _metric(content, target, k)
        _, popular_precision = _metric(popular, target, k)
        content_p.append(content_precision)
        popular_p.append(popular_precision)
        recalls.append(_metric(content, target, recall_k)[0] / len(target))
        first_hit = next((position for position, item in enumerate(content[:k], start=1) if item["isbn13"] in target), None)
        reciprocal_ranks.append(1.0 / first_hit if first_hit else 0.0)
    return {
        "algorithm": "tfidf-content-v1",
        "queries": len(books),
        "evaluatedQueries": evaluated,
        "targetCoverage": round(covered_targets / total_targets, 6) if total_targets else 0.0,
        "pAt10": round(sum(content_p) / len(content_p), 6) if content_p else 0.0,
        "popularPAt10": round(sum(popular_p) / len(popular_p), 6) if popular_p else 0.0,
        "recallAt20": round(sum(recalls) / len(recalls), 6) if recalls else 0.0,
        "mrrAt10": round(sum(reciprocal_ranks) / len(reciprocal_ranks), 6) if reciprocal_ranks else 0.0,
        "k": k,
        "recallK": recall_k,
    }


def _relation_targets(book: D4LBook) -> set[str]:
    return {isbn for field in RELATION_FIELDS for isbn in getattr(book, field)}


def _diversity_at_k(recommendations: list[dict[str, Any]], books_by_isbn: dict[str, D4LBook], k: int) -> float:
    selected = recommendations[:k]
    if not selected:
        return 0.0
    categories = {
        books_by_isbn[item["isbn13"]].class_no
        or books_by_isbn[item["isbn13"]].class_nm
        or item["isbn13"]
        for item in selected
    }
    return len(categories) / len(selected)


def _strategy_metrics(
    books: list[D4LBook],
    recommender: Any,
    *,
    k: int,
    recall_k: int,
    known_isbns: set[str],
    evaluated_queries: list[tuple[D4LBook, set[str]]],
    indexed_targets: int,
    all_targets: int,
) -> dict[str, Any]:
    books_by_isbn = {book.isbn13: book for book in books}
    precisions: list[float] = []
    recalls: list[float] = []
    diversities: list[float] = []
    candidate_shortage = 0
    for book, targets in evaluated_queries:
        recommendations = recommender(book.isbn13, recall_k)
        top_k = recommendations[:k]
        top_recall = recommendations[:recall_k]
        hits_at_k = sum(item["isbn13"] in targets for item in top_k)
        hits_at_recall_k = sum(item["isbn13"] in targets for item in top_recall)
        precisions.append(hits_at_k / k)
        recalls.append(hits_at_recall_k / len(targets))
        diversities.append(_diversity_at_k(recommendations, books_by_isbn, k))
        if len(top_k) < k:
            candidate_shortage += 1
    return {
        "pAt5": round(sum(precisions) / len(precisions), 6) if precisions else 0.0,
        "recallAt10": round(sum(recalls) / len(recalls), 6) if recalls else 0.0,
        "coverage": round(indexed_targets / all_targets, 6) if all_targets else 0.0,
        "diversityAt5": round(sum(diversities) / len(diversities), 6) if diversities else 0.0,
        "evaluatedQueries": len(evaluated_queries),
        "candidateShortageQueries": candidate_shortage,
        "targetDenominator": all_targets,
        "indexedTargetDenominator": indexed_targets,
    }


def evaluate_d4l(books: list[D4LBook], k: int = 5, recall_k: int = 10) -> dict[str, Any]:
    """Compare deterministic recommendation strategies against D4L relations."""
    if k < 1 or recall_k < k:
        raise ValueError("recall_k must be greater than or equal to k, and both must be positive")
    known_isbns = {book.isbn13 for book in books}
    evaluated_queries: list[tuple[D4LBook, set[str]]] = []
    relation_coverage: dict[str, dict[str, int | float]] = {}
    all_targets = 0
    indexed_targets = 0
    empty_relation_queries = 0
    missing_loan_history_queries = 0
    for field in RELATION_FIELDS:
        total = 0
        indexed = 0
        for book in books:
            targets = set(getattr(book, field))
            total += len(targets)
            indexed += len(targets & known_isbns)
        relation_coverage[field] = {
            "targets": total,
            "indexedTargets": indexed,
            "outOfIndexTargets": total - indexed,
            "coverage": round(indexed / total, 6) if total else 0.0,
        }
    for book in books:
        targets = _relation_targets(book)
        indexed = targets & known_isbns
        all_targets += len(targets)
        indexed_targets += len(indexed)
        if not targets:
            empty_relation_queries += 1
        if not book.loan_history:
            missing_loan_history_queries += 1
        if indexed:
            evaluated_queries.append((book, indexed))

    vectors = _vectors(books)
    content_by_isbn = {book.isbn13: position for position, book in enumerate(books)}

    def content_recommender(query_isbn: str, limit: int) -> list[dict[str, Any]]:
        return _recommend_from_vectors(books, vectors, content_by_isbn[query_isbn], limit)

    strategies = {
        "popularBaseline": lambda query_isbn, limit: recommend_popular(books, query_isbn, limit),
        "embeddingOnly": content_recommender,
        "hybrid": lambda query_isbn, limit: _hybrid_recommend(books, query_isbn, limit),
    }
    metrics = {
        name: _strategy_metrics(
            books,
            recommender,
            k=k,
            recall_k=recall_k,
            known_isbns=known_isbns,
            evaluated_queries=evaluated_queries,
            indexed_targets=indexed_targets,
            all_targets=all_targets,
        )
        for name, recommender in strategies.items()
    }
    return {
        "evaluationVersion": "d4l-ranking-evaluation-v1",
        "targetRelations": list(RELATION_FIELDS),
        "queries": len(books),
        "evaluatedQueries": len(evaluated_queries),
        "k": k,
        "recallK": recall_k,
        "targetCoverage": round(indexed_targets / all_targets, 6) if all_targets else 0.0,
        "targetDenominator": all_targets,
        "indexedTargetDenominator": indexed_targets,
        "outOfIndexTargetCount": all_targets - indexed_targets,
        "relationCoverage": relation_coverage,
        "edgeCases": {
            "emptyRelationQueries": empty_relation_queries,
            "candidateShortageQueries": sum(1 for _book in books if len(books) - 1 < k),
            "missingLoanHistoryQueries": missing_loan_history_queries,
        },
        "strategies": metrics,
    }
