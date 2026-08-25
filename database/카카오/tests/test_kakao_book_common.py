from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from kakao_book_common import (  # noqa: E402
    merge_normalize_and_report,
    normalize_book,
    parse_isbn,
    raw_book,
)
import kakao_book_collector as collector  # noqa: E402
import kakao_book_quota_collector as quota_collector  # noqa: E402
import migrate_kakao_v1_to_v2 as migration  # noqa: E402


BOOK = {
    "title": "미움받을 용기",
    "contents": "책 소개",
    "url": "https://example.test/book",
    "isbn": "8996991341 9788996991342",
    "datetime": "2014-11-17T00:00:00+09:00",
    "authors": ["기시미 이치로", "고가 후미타케"],
    "publisher": "인플루엔셜",
    "translators": ["전경아"],
    "price": 14900,
    "sale_price": 13410,
    "thumbnail": "https://example.test/cover.jpg",
    "status": "정상판매",
}


class KakaoBookCommonTest(unittest.TestCase):
    def test_isbn10_is_validated_and_converted(self) -> None:
        isbn10, isbn13, valid, isbn_type = parse_isbn("8996991341")
        self.assertEqual(isbn10, "8996991341")
        self.assertEqual(isbn13, "9788996991342")
        self.assertTrue(valid)
        self.assertEqual(isbn_type, "ISBN10")

    def test_raw_record_is_one_book_with_collection_metadata(self) -> None:
        record = raw_book(
            BOOK,
            query="9788996991342",
            target="isbn",
            page=1,
            collected_at="2026-08-25T00:00:00+00:00",
        )
        self.assertEqual(record["title"], BOOK["title"])
        self.assertEqual(record["_source_query"], "9788996991342")
        self.assertNotIn("response", record)

    def test_both_collectors_share_one_normalized_schema(self) -> None:
        self.assertIs(collector.raw_book, raw_book)
        self.assertIs(quota_collector.raw_book, raw_book)
        record = normalize_book(
            {**BOOK, "price": None},
            query="9788996991342",
            target="isbn",
            page=1,
            collected_at="2026-08-25T00:00:00+00:00",
        )
        self.assertEqual(record["isbn10_normalized"], "8996991341")
        self.assertEqual(record["isbn13_normalized"], "9788996991342")
        self.assertTrue(record["isbn_valid"])
        self.assertIsNone(record["price"])

    def test_merge_deduplicates_and_writes_detailed_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            part = root / "raw" / "parts" / "isbn_000001.jsonl"
            part.parent.mkdir(parents=True)
            record = raw_book(
                BOOK,
                query="9788996991342",
                target="isbn",
                page=1,
                collected_at="2026-08-25T00:00:00+00:00",
            )
            part.write_text(
                json.dumps(record, ensure_ascii=False) + "\n"
                + json.dumps(record, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            result = merge_normalize_and_report(
                parts=[part],
                merged_path=root / "processed" / "books_merged.jsonl",
                processed_path=root / "processed" / "books.jsonl",
                sample_jsonl_path=root / "samples" / "sample_books.jsonl",
                sample_pretty_path=root / "samples" / "sample_books.pretty.json",
                report_path=root / "reports" / "missing_report_isbn.csv",
                summary_path=root / "reports" / "data_quality_summary_isbn.txt",
                database_path=root / "metadata" / "merge.sqlite3",
                unresolved=[],
                scope="isbn",
            )
            self.assertEqual(result["raw_count"], 2)
            self.assertEqual(result["unique_count"], 1)
            merged = json.loads((root / "processed" / "books_merged.jsonl").read_text(encoding="utf-8"))
            self.assertIn("_source_query", merged)
            self.assertNotIn("isbn13_normalized", merged)
            with (root / "reports" / "missing_report_isbn.csv").open(
                encoding="utf-8-sig", newline=""
            ) as report_file:
                columns = next(csv.reader(report_file))
            self.assertIn("types", columns)
            self.assertIn("example_valid_values", columns)
            self.assertIn("example_invalid_values", columns)

    @patch("kakao_book_collector.request_books")
    def test_basic_collector_writes_done_part_and_resumes(self, request_books) -> None:
        request_books.return_value = (
            200,
            {"documents": [BOOK], "meta": {"is_end": True, "total_count": 1}},
        )
        with tempfile.TemporaryDirectory() as temporary:
            parts_dir = Path(temporary) / "raw" / "parts"
            parts_dir.mkdir(parents=True)
            unresolved: list[dict] = []
            cache: dict[str, dict] = {}
            part, requests, documents = collector.collect_part(
                api_key="test-key",
                queries=["9788996991342"],
                target="isbn",
                scope="isbn",
                part_number=1,
                parts_dir=parts_dir,
                page_size=50,
                retries=0,
                delay=0,
                unresolved=unresolved,
                count_cache=cache,
            )
            self.assertEqual(requests, 1)
            self.assertEqual(documents, 1)
            self.assertIsNotNone(part)
            raw_record = json.loads(part.read_text(encoding="utf-8"))
            self.assertEqual(raw_record["title"], BOOK["title"])
            self.assertNotIn("response", raw_record)
            self.assertTrue((parts_dir / "isbn_000001.done.json").exists())

            request_books.reset_mock()
            _, resumed_requests, resumed_documents = collector.collect_part(
                api_key="test-key",
                queries=["9788996991342"],
                target="isbn",
                scope="isbn",
                part_number=1,
                parts_dir=parts_dir,
                page_size=50,
                retries=0,
                delay=0,
                unresolved=unresolved,
                count_cache=cache,
            )
            self.assertEqual(resumed_requests, 0)
            self.assertEqual(resumed_documents, 1)
            request_books.assert_not_called()

    def test_v1_envelope_is_migrated_without_api_call(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "books_raw_part_00001.jsonl"
            target = root / "title_000001.jsonl"
            source.write_text(json.dumps({
                "collected_at": "2026-08-24T00:00:00+00:00",
                "request": {"query": "가", "target": "title", "page": 1, "size": 50},
                "response": {
                    "documents": [BOOK],
                    "meta": {"total_count": 1, "is_end": True},
                },
            }, ensure_ascii=False) + "\n", encoding="utf-8")
            cache: dict[str, dict] = {}
            requests, documents = migration.convert_part(
                source_path=source,
                target_path=target,
                cache=cache,
                overwrite=False,
            )
            self.assertEqual((requests, documents), (1, 1))
            migrated = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(migrated["title"], BOOK["title"])
            self.assertEqual(migrated["_source_query"], "가")
            self.assertNotIn("response", migrated)
            self.assertTrue(cache["가"]["is_end_observed"])


if __name__ == "__main__":
    unittest.main()
