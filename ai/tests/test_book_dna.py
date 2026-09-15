from datetime import date, timedelta

import pytest

from recommendation.book_dna import BookDnaRecord, UserBookSeed, build_book_dna_profile


def seed(isbn: str, *, status: str = "READ", rating: int | None = 5, days_ago: int = 0) -> UserBookSeed:
    return UserBookSeed(
        isbn,
        status=status,  # type: ignore[arg-type]
        rating=rating,
        finished_date=date(2026, 1, 1) - timedelta(days=days_ago),
    )


def test_profile_is_deterministic_and_uses_rating_and_recency() -> None:
    seeds = [seed("9780000000001", rating=5), seed("9780000000002", rating=3, days_ago=365)]
    records = {
        "9780000000001": BookDnaRecord("9780000000001", vector=(1.0, 0.0), tag_codes=("FIC",), class_no="813.6"),
        "9780000000002": BookDnaRecord("9780000000002", vector=(0.0, 1.0), tag_codes=("SCIENCE",), class_no="400"),
    }

    left = build_book_dna_profile(seeds, records, today=date(2026, 1, 1))
    right = build_book_dna_profile(seeds, records, today=date(2026, 1, 1))

    assert left.to_dict() == right.to_dict()
    assert left.status == "READY"
    assert left.based_on_count == 2
    assert left.axes[0].code == "FICTION"
    assert left.axes[0].score > left.axes[4].score
    assert left.user_vector is not None


def test_wish_is_a_secondary_signal_and_read_count_remains_zero() -> None:
    profile = build_book_dna_profile(
        [seed("9780000000001", status="WISH", rating=None)],
        {"9780000000001": BookDnaRecord("9780000000001", tag_codes=("FANTASY",), class_no="813")},
        today=date(2026, 1, 1),
    )

    assert profile.status == "READY"
    assert profile.based_on_count == 0
    assert profile.evidence.rated_book_count == 0
    assert profile.axes[0].score == 100.0


def test_unknown_isbn_is_reported_without_failing_other_books() -> None:
    profile = build_book_dna_profile(
        [seed("9780000000001"), seed("9780000000002")],
        {"9780000000001": BookDnaRecord("9780000000001", tag_codes=("FAMILY",), class_no="813")},
        today=date(2026, 1, 1),
    )

    assert profile.status == "READY"
    assert profile.unresolved_isbns == ("9780000000002",)
    assert profile.evidence.top_tags == ("FAMILY",)


def test_empty_or_only_unknown_books_returns_insufficient_data() -> None:
    profile = build_book_dna_profile(
        [seed("9780000000001")],
        {},
        today=date(2026, 1, 1),
    )

    assert profile.status == "INSUFFICIENT_DATA"
    assert profile.based_on_count == 0
    assert profile.profile_type is None
    assert profile.to_dict()["unresolvedIsbns"] == ["9780000000001"]


def test_invalid_vector_dimension_is_rejected() -> None:
    profile_seeds = [seed("9780000000001"), seed("9780000000002")]
    records = {
        "9780000000001": BookDnaRecord("9780000000001", vector=(1.0, 0.0)),
        "9780000000002": BookDnaRecord("9780000000002", vector=(1.0, 0.0, 0.0)),
    }

    with pytest.raises(ValueError, match="same dimension"):
        build_book_dna_profile(profile_seeds, records, today=date(2026, 1, 1))


def test_kdc_axis_mapping_preserves_specific_ranges_before_broad_ranges() -> None:
    profile = build_book_dna_profile(
        [seed("9780000000001"), seed("9780000000002")],
        {
            "9780000000001": BookDnaRecord("9780000000001", class_no="818"),
            "9780000000002": BookDnaRecord("9780000000002", class_no="320"),
        },
        today=date(2026, 1, 1),
    )

    scores = {item.code: item.score for item in profile.axes}
    assert scores["ESSAY"] == 50.0
    assert scores["BUSINESS"] == 50.0
