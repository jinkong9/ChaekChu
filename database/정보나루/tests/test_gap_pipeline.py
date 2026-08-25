#!/usr/bin/env python3
"""gap 추출·정규화 핵심 로직 단위 테스트. 네트워크 없이 실행된다."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import data4library_gap_collector as collector  # noqa: E402
import extract_gap_isbns as extractor  # noqa: E402


class TestIsbnNormalization(unittest.TestCase):
    def test_valid_isbn13_passthrough(self):
        self.assertEqual(extractor.to_isbn13("9791186150306"), "9791186150306")

    def test_isbn10_converted_to_13(self):
        # 8985502654 (국중도 실측 샘플) -> 978 접두 + 재계산 체크디지트
        self.assertEqual(extractor.to_isbn13("8985502654"), "9788985502658")

    def test_hyphen_and_noise_stripped(self):
        self.assertEqual(extractor.to_isbn13("979-11-86150-30-6"), "9791186150306")

    def test_invalid_checksum_rejected(self):
        self.assertIsNone(extractor.to_isbn13("9791186150307"))
        self.assertIsNone(extractor.to_isbn13(""))
        self.assertIsNone(extractor.to_isbn13(None))


class TestMissingDetection(unittest.TestCase):
    def test_group_missing_only_when_all_fields_empty(self):
        groups = ["author", "description"]
        record = {"AUTHOR": "", "BOOK_INTRODUCTION": "", "BOOK_SUMMARY": "요약 있음"}
        mask = extractor.record_missing_mask(record, groups)
        self.assertEqual(mask, 0b01)  # author만 결측, description은 SUMMARY가 있어 제외

    def test_placeholder_counts_as_missing(self):
        record = {"AUTHOR": "-", "BOOK_INTRODUCTION": " ", "BOOK_SUMMARY": None}
        mask = extractor.record_missing_mask(record, ["author", "description"])
        self.assertEqual(mask, 0b11)


class TestNlNormalization(unittest.TestCase):
    def test_schema_has_39_fields(self):
        self.assertEqual(len(collector.NL_FIELDS), 39)

    def test_mapping_targets_exist_in_schema(self):
        for nl_field in collector.FIELD_MAPPING.values():
            self.assertIn(nl_field, collector.NL_FIELDS)

    def test_to_nl_record_fills_mapped_and_blanks_rest(self):
        book = {
            "bookname": "테스트 도서",
            "authors": "지은이: 홍길동;그림: 김철수",
            "publisher": "테스트출판",
            "isbn13": "9791186150306",
            "addition_symbol": "03810",
            "vol": "",
            "class_no": "813.7",
            "description": "책소개 본문 &lt;아몬드&gt; &amp; 그 외",
            "bookImageURL": "https://image.example/cover.jpg",
            "publication_year": "2017",  # 매핑 대상 아님
        }
        record = collector.to_nl_record(book)
        self.assertEqual(set(record), set(collector.NL_FIELDS))
        self.assertEqual(record["TITLE"], "테스트 도서")
        self.assertEqual(record["AUTHOR"], "지은이: 홍길동;그림: 김철수")
        self.assertEqual(record["EA_ISBN"], "9791186150306")
        self.assertEqual(record["EA_ADD_CODE"], "03810")
        self.assertEqual(record["KDC"], "813.7")
        self.assertEqual(record["BOOK_INTRODUCTION"], "책소개 본문 <아몬드> & 그 외")  # HTML 엔티티 해제
        self.assertEqual(record["TITLE_URL"], "https://image.example/cover.jpg")
        self.assertEqual(record["BOOK_SUMMARY"], "")   # description은 SUMMARY에 넣지 않는다
        self.assertEqual(record["PUBLISH_PREDATE"], "")  # 연도만 주는 값은 매핑하지 않는다
        self.assertEqual(record["DEPOSIT_YN"], "")     # 임의값 금지

    def test_extract_book_error_and_nohit(self):
        book, error = collector.extract_book({"response": {"error": "인증키가 유효하지 않습니다."}})
        self.assertIsNone(book)
        self.assertIn("인증키", error)
        book, error = collector.extract_book({"response": {"detail": []}})
        self.assertIsNone(book)
        self.assertIsNone(error)
        book, error = collector.extract_book(
            {"response": {"detail": [{"book": {"bookname": "x"}}]}})
        self.assertEqual(book, {"bookname": "x"})
        self.assertIsNone(error)


if __name__ == "__main__":
    unittest.main()
