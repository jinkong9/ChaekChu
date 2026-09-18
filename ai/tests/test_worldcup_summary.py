from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from recommendation.cli import create_parser
from recommendation.d4l import D4LBook
from recommendation.worldcup_summary import (
    GmsSynopsisProvider,
    SummarySettings,
    WorldCupSynopsisRunner,
    validate_synopsis,
)


def book(isbn: str, title: str, loans: int, description: str | None = "한 아이가 낯선 마을에서 새로운 친구를 만나며 용기를 배워 가는 이야기입니다.") -> D4LBook:
    return D4LBook(isbn, title, "저자 이름", "출판사", "2020", "813.7", "문학 > 소설", description,
                   (), loans, (), (), (), ())


class FakeProvider:
    def __init__(self, response: str = "낯선 마을에 온 아이가 새로운 친구들과 만나며 조금씩 용기를 얻습니다.") -> None:
        self.calls: list[str] = []
        self.response = response

    def summarize(self, source: D4LBook) -> str:
        self.calls.append(source.isbn13)
        return self.response


def write_input(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def source_row(isbn: str, title: str, loans: int, description: str | None) -> dict[str, Any]:
    row = {"isbn13": isbn, "bookname": title, "authors": "저자 이름", "loan_total": loans}
    if description is not None:
        row["desc"] = description
    return row


def test_provider_sends_only_description_context_and_parses_json() -> None:
    sent: dict[str, Any] = {}

    class Response:
        def read(self) -> bytes:
            return json.dumps({"choices": [{"message": {"content": json.dumps({"synopsis": "낯선 길에서 시작된 모험을 따라갑니다."}, ensure_ascii=False)}}]}).encode()

    def opener(request: Any, timeout: float) -> Response:
        sent.update(json.loads(request.data))
        return Response()

    result = GmsSynopsisProvider(endpoint="https://gms.test/chat", api_key="secret", model="gpt-4o-mini", opener=opener).summarize(
        book("9780000000001", "비공개 제목", 20)
    )

    prompt = sent["messages"][1]["content"]
    assert result == "낯선 길에서 시작된 모험을 따라갑니다."
    assert "description" in prompt
    assert "비공개 제목" not in prompt
    assert "저자 이름" not in prompt
    assert sent["model"] == "gpt-4o-mini"


@pytest.mark.parametrize("text", [
    "비공개 제목의 주인공이 낯선 여행을 떠납니다.",
    "이야기의 결말은 모두가 행복하게 끝납니다.",
    "첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.",
])
def test_summary_post_validation_rejects_identity_spoiler_and_overlong_sentence_count(text: str) -> None:
    with pytest.raises(ValueError):
        validate_synopsis(text, book("9780000000001", "비공개 제목", 20))


def test_runner_selects_top_loan_books_persists_metadata_and_skips_missing_description(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    sidecar = tmp_path / "summaries.jsonl"
    report = tmp_path / "report.json"
    write_input(source, [
        source_row("9780000000001", "낮은 순위", 1, "소개입니다."),
        source_row("9780000000002", "최고 순위", 100, "소개입니다."),
        source_row("9780000000003", "소개 없음", 90, None),
        source_row("9780000000004", "중간 순위", 50, "소개입니다."),
    ])
    provider = FakeProvider()
    runner = WorldCupSynopsisRunner(provider=provider, settings=SummarySettings(limit=3, max_estimated_credits=6))

    result = runner.run(source, sidecar, report)
    rows = [json.loads(line) for line in sidecar.read_text(encoding="utf-8").splitlines()]

    assert [row["isbn13"] for row in rows] == ["9780000000002", "9780000000003", "9780000000004"]
    assert [row["loanRank"] for row in rows] == [1, 2, 3]
    assert [row["status"] for row in rows] == ["SUCCESS", "MISSING_SOURCE", "SUCCESS"]
    assert all(row["sourceHash"] and row["summaryVersion"] == "book-world-cup-summary-v1" for row in rows)
    assert result["status"] == "PARTIAL"
    assert result["gmsRequests"] == 2
    assert result["missingSourceRows"] == 1
    assert len(provider.calls) == 2


def test_runner_hard_credit_cap_prevents_all_calls(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    write_input(source, [source_row(f"978000000000{i}", f"책{i}", 10 - i, "책 소개입니다.") for i in range(1, 4)])
    provider = FakeProvider()
    runner = WorldCupSynopsisRunner(provider=provider, settings=SummarySettings(limit=3, max_estimated_credits=5))

    with pytest.raises(ValueError, match="no GMS calls made"):
        runner.run(source, tmp_path / "sidecar.jsonl", tmp_path / "report.json")

    assert provider.calls == []


def test_runner_resumes_successful_rows_without_duplicate_gms_calls(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    sidecar = tmp_path / "sidecar.jsonl"
    report = tmp_path / "report.json"
    write_input(source, [source_row(f"978000000000{i}", f"책{i}", 10 - i, "책 소개입니다.") for i in range(1, 4)])
    provider = FakeProvider()
    settings = SummarySettings(limit=3, max_estimated_credits=6)

    WorldCupSynopsisRunner(provider=provider, settings=settings).run(source, sidecar, report)
    first_call_count = len(provider.calls)
    second = WorldCupSynopsisRunner(provider=provider, settings=settings).run(source, sidecar, report)

    assert first_call_count == 3
    assert len(provider.calls) == first_call_count
    assert second["gmsRequests"] == 3
    assert second["processedRows"] == 3


def test_runner_reestimates_cost_when_a_reused_isbn_source_changes(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    sidecar = tmp_path / "sidecar.jsonl"
    report = tmp_path / "report.json"
    rows = [source_row("9780000000001", "책", 10, "첫 번째 소개입니다.")]
    write_input(source, rows)
    provider = FakeProvider()
    WorldCupSynopsisRunner(provider=provider, settings=SummarySettings(limit=1, max_estimated_credits=2)).run(
        source, sidecar, report
    )
    rows[0]["desc"] = "변경된 소개입니다."
    write_input(source, rows)

    with pytest.raises(ValueError, match="estimated GMS cost 4.0 exceeds hard cap 1.0"):
        WorldCupSynopsisRunner(provider=provider, settings=SummarySettings(limit=1, max_estimated_credits=1)).run(
            source, sidecar, report
        )

    assert len(provider.calls) == 1


def test_cli_parses_worldcup_summaries_pilot_options() -> None:
    args = create_parser().parse_args([
        "worldcup-summaries", "--input", "books.jsonl.gz", "--sidecar", "out.jsonl",
        "--limit", "20", "--max-estimated-credits", "40",
    ])
    assert args.command == "worldcup-summaries"
    assert args.limit == 20
    assert args.max_estimated_credits == 40


def test_worldcup_summary_limit_cannot_exceed_the_500_book_scope() -> None:
    with pytest.raises(ValueError, match="between 1 and 500"):
        SummarySettings(limit=501)
