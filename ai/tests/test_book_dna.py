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


def test_every_taxonomy_code_has_a_korean_label_and_only_axis_names_leave_keywords() -> None:
    """「자주 읽는 키워드」에 #SCIENCE #HISTORY #HUMANITIES 가 영문 코드 그대로 뜨던 문제(09-18).
    세부 장르는 한글 라벨로 남긴다 — 축이 「인문·사회」「과학·기술」로 묶어 보여 주므로 키워드에서 빼면 정보가 사라진다."""
    from recommendation.book_dna import AXIS_NAME_CODES, TAG_LABELS
    from recommendation.tag_batch import TAXONOMY

    for definition in TAXONOMY:
        label = TAG_LABELS[definition.code]
        assert label != definition.code, definition.code
        assert any("가" <= ch <= "힣" for ch in label), (definition.code, label)   # 한글 라벨이어야 화면에 코드가 새지 않는다

    profile = build_book_dna_profile(
        [seed("9780000000001"), seed("9780000000002"), seed("9780000000003")],
        {
            "9780000000001": BookDnaRecord("9780000000001", tag_codes=("HUMANITIES", "STEADY"), class_no="189.2"),
            "9780000000002": BookDnaRecord("9780000000002", tag_codes=("SCIENCE", "TECH", "FAMILY"), class_no="539"),
            "9780000000003": BookDnaRecord("9780000000003", tag_codes=("HISTORY", "TRAVEL"), class_no="981.1"),
        },
        today=date(2026, 1, 1),
    )

    labels = {item.code: item.label for item in profile.keywords}
    assert set(labels) == {"STEADY", "FAMILY", "HUMANITIES", "SCIENCE", "TECH", "HISTORY", "TRAVEL"}   # 세부 장르가 남는다
    assert not (set(labels) & AXIS_NAME_CODES)
    assert labels["HUMANITIES"] == "인문" and labels["SCIENCE"] == "과학" and labels["TECH"] == "기술·IT" and labels["HISTORY"] == "역사"
    assert labels["STEADY"] == "꾸준히 읽는 책" and labels["FAMILY"] == "가족"
    # 축 이름과 같은 코드는 키워드에서 빠진다
    fiction = build_book_dna_profile([seed("9780000000009")], {"9780000000009": BookDnaRecord("9780000000009", tag_codes=("FIC", "ESSAY", "FANTASY"), class_no="813")}, today=date(2026, 1, 1))
    assert [item.code for item in fiction.keywords] == ["FANTASY"]
    axes = {item.code: item.score for item in profile.axes}
    assert axes["HUMANITIES"] > 0 and axes["SCIENCE"] > 0 and axes["ART_HISTORY"] > 0   # 인문 / 과학·기술 / 예술·역사(981 기행)
    assert set(profile.evidence.top_tags) <= {"HUMANITIES", "STEADY", "SCIENCE", "TECH", "FAMILY", "HISTORY", "TRAVEL"}
