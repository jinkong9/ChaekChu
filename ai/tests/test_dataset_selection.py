import gzip
import json
from pathlib import Path

from recommendation.dataset_selection import select_dataset


def _record(isbn: str, title: str, category: str, year: str, loans: int) -> dict:
    return {
        "isbn13": isbn,
        "bookname": title,
        "authors": "author",
        "publisher": "publisher",
        "pub_year": year,
        "class_nm": category,
        "loan_total": loans,
    }


def test_select_dataset_preserves_strata_and_prefers_popular_books(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl.gz"
    rows = [
        _record("9780000000001", "literature old popular", "문학 > 소설", "1999", 100),
        _record("9780000000002", "literature old less popular", "문학 > 소설", "1998", 10),
        _record("9780000000003", "science new popular", "자연과학 > 과학", "2024", 90),
        _record("9780000000004", "science new less popular", "자연과학 > 과학", "2023", 9),
        _record("9780000000005", "history old", "역사 > 역사", "1995", 80),
        _record("9780000000006", "history new", "역사 > 역사", "2024", 70),
    ]
    with gzip.open(source, "wt", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row) + "\n")

    output = tmp_path / "selected.jsonl.gz"
    report_path = tmp_path / "report.json"
    report = select_dataset(source, output, report_path, limit=4)

    with gzip.open(output, "rt", encoding="utf-8") as stream:
        selected = [json.loads(line) for line in stream]
    assert report["selectedRows"] == 4
    assert report["eligibleUniqueRows"] == 6
    assert {row["isbn13"] for row in selected} == {
        "9780000000001",
        "9780000000003",
        "9780000000005",
        "9780000000006",
    }
    assert report["selectionVersion"] == "mvp-stratified-v1"


def test_select_dataset_deduplicates_isbn_using_richer_popular_record(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    source.write_text(
        "\n".join(
            [
                json.dumps(_record("9780000000011", "same", "문학 > 소설", "2020", 10)),
                json.dumps({**_record("9780000000011", "same", "문학 > 소설", "2020", 20), "publisher": ""}),
                json.dumps(_record("9780000000012", "other", "문학 > 소설", "2020", 5)),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "selected.jsonl.gz"
    report = select_dataset(source, output, tmp_path / "report.json", limit=2)

    with gzip.open(output, "rt", encoding="utf-8") as stream:
        selected = [json.loads(line) for line in stream]
    chosen = next(row for row in selected if row["isbn13"] == "9780000000011")
    assert chosen["loan_total"] == 20
    assert report["eligibleUniqueRows"] == 2
