import tempfile
import unittest
from pathlib import Path

from scripts.yes24_isbn_collector import (
    completed_keys,
    iter_input_isbns,
    normalize_isbn13,
    unique_targets,
    valid_isbn10,
    valid_isbn13,
)


class IsbnTest(unittest.TestCase):
    def test_valid_isbn13_is_preserved(self):
        self.assertEqual(normalize_isbn13("978-89-6626-095-9"), "9788966260959")
        self.assertTrue(valid_isbn13("9788966260959"))

    def test_isbn10_is_converted(self):
        self.assertTrue(valid_isbn10("8966260950"))
        self.assertEqual(normalize_isbn13("8966260950"), "9788966260959")

    def test_invalid_isbn_is_rejected(self):
        self.assertIsNone(normalize_isbn13("9788966260950"))
        self.assertIsNone(normalize_isbn13("not-an-isbn"))

    def test_targets_are_deduplicated_after_normalization(self):
        targets = unique_targets(
            ["8966260950", "9788966260959", "invalid", "invalid"],
            limit=0,
        )
        self.assertEqual(
            targets,
            [("8966260950", "9788966260959"), ("invalid", None)],
        )


class InputTest(unittest.TestCase):
    def test_jsonl_nested_field(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "books.jsonl"
            path.write_text(
                '{"book":{"isbn":"9788966260959"}}\n',
                encoding="utf-8",
            )
            self.assertEqual(
                list(iter_input_isbns(path, "book.isbn")),
                ["9788966260959"],
            )

    def test_resume_only_skips_terminal_results(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "results.jsonl"
            path.write_text(
                '{"status":"request_error","request":{"rawIsbn":"9788966260959","isbn13":"9788966260959"}}\n'
                '{"status":"success","request":{"rawIsbn":"9780132350884","isbn13":"9780132350884"}}\n',
                encoding="utf-8",
            )
            self.assertEqual(completed_keys(path), {"9780132350884"})


if __name__ == "__main__":
    unittest.main()
