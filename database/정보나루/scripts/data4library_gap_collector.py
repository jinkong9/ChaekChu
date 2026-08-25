#!/usr/bin/env python3
"""정보나루(도서관 정보나루) srchDtlList로 국중도 결측 필드를 보강 수집한다.

extract_gap_isbns.py가 만든 gap list의 ISBN-13을 순서대로 조회해서
- raw/에 응답 원형을 저장하고
- processed/에 국립중앙도서관 39개 필드 스키마로 정규화한 레코드를 저장한다.

일일 쿼터(기본 인증키 500회)에 맞춰 --max-requests에서 안전하게 멈추고,
체크포인트로 다음 실행에서 이어서 수집한다. 히트율 사전 검증은
`--max-requests 300` 정도로 실행한 뒤 reports/의 요약을 확인하면 된다.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URL = "https://data4library.kr/api/srchDtlList"

# 국립중앙도서관 스키마 39개 필드. 매핑되지 않는 필드는 빈 문자열로 둔다.
NL_FIELDS = (
    "TITLE", "AUTHOR", "PUBLISHER", "EA_ISBN", "EA_ADD_CODE", "SET_ISBN", "SET_ADD_CODE", "SET_EXPRESSION",
    "SERIES_TITLE", "SERIES_NO", "VOL", "EDITION_STMT", "PRE_PRICE", "REAL_PRICE", "KDC", "DDC", "SUBJECT",
    "PAGE", "BOOK_SIZE", "FORM", "FORM_DETAIL", "PUBLISH_PREDATE", "REAL_PUBLISH_DATE", "INPUT_DATE", "UPDATE_DATE",
    "PUBLISHER_URL", "TITLE_URL", "BOOK_TB_CNT", "BOOK_TB_CNT_URL", "BOOK_INTRODUCTION", "BOOK_INTRODUCTION_URL",
    "BOOK_SUMMARY", "BOOK_SUMMARY_URL", "CONTROL_NO", "RELATED_ISBN", "CIP_YN", "DEPOSIT_YN", "EBOOK_YN", "BIB_YN",
)

# 정보나루 book 필드 -> 국중도 필드. description은 책소개 성격이므로 BOOK_INTRODUCTION에 매핑한다.
# publication_year는 연도(YYYY)만 제공되어 8자리 PUBLISH_PREDATE 규칙과 맞지 않으므로 매핑하지 않는다.
FIELD_MAPPING = {
    "bookname": "TITLE",
    "authors": "AUTHOR",
    "publisher": "PUBLISHER",
    "isbn13": "EA_ISBN",
    "addition_symbol": "EA_ADD_CODE",
    "vol": "VOL",
    "class_no": "KDC",
    "description": "BOOK_INTRODUCTION",
    "bookImageURL": "TITLE_URL",
}

# 응답 error 메시지에 아래 단어가 있으면 키·쿼터 문제이므로 수집을 즉시 멈춘다.
FATAL_ERROR_KEYWORDS = ("허용", "초과", "인증", "권한", "key", "Key")


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="정보나루 결측 보강 수집기")
    parser.add_argument("--gap-list", type=Path, required=True,
                        help="extract_gap_isbns.py가 만든 gap list JSONL 경로")
    parser.add_argument("--max-requests", type=int, default=490,
                        help="이번 실행에서 사용할 최대 HTTP 요청 수. 기본 490(일 500회 키 기준 여유분)")
    parser.add_argument("--delay", type=float, default=0.15, help="성공 요청 사이 대기 초")
    parser.add_argument("--retries", type=int, default=3, help="일시 오류 재시도 횟수")
    parser.add_argument("--output-dir", type=Path, default=root)
    parser.add_argument("--reset", action="store_true", help="체크포인트를 무시하고 gap list 처음부터 시작")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def api_request(auth_key: str, isbn13: str) -> dict[str, Any]:
    params = urlencode({"authKey": auth_key, "isbn13": isbn13, "loaninfoYN": "N", "format": "json"})
    request = Request(f"{API_URL}?{params}", method="GET")
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_book(payload: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """응답에서 book 레코드를 꺼낸다. 반환: (book 또는 None, 오류 메시지 또는 None)."""
    response = payload.get("response")
    if not isinstance(response, dict):
        return None, "unexpected response shape"
    error = response.get("error")
    if error:
        return None, str(error)
    for entry in response.get("detail") or []:
        book = entry.get("book") if isinstance(entry, dict) else None
        if isinstance(book, dict):
            return book, None
    return None, None  # 정상 응답이지만 해당 ISBN 레코드 없음(no hit)


def to_nl_record(book: dict[str, Any]) -> dict[str, str]:
    """정보나루 book을 국중도 39개 필드 스키마로 정규화한다."""
    record = {field: "" for field in NL_FIELDS}
    for source_field, nl_field in FIELD_MAPPING.items():
        value = book.get(source_field)
        # 정보나루 텍스트에는 &lt; 같은 HTML 엔티티가 섞여 오므로 국중도 표기에 맞춰 푼다.
        record[nl_field] = html.unescape(str(value).strip()) if value is not None else ""
    return record


def load_checkpoint(path: Path, gap_list: Path, reset: bool) -> dict[str, Any]:
    fresh = {"gap_list": str(gap_list), "next_index": 0, "request_count_total": 0,
             "hits": 0, "no_hits": 0, "started_at": utc_now()}
    if reset or not path.exists():
        return fresh
    checkpoint = json.loads(path.read_text(encoding="utf-8"))
    if checkpoint.get("gap_list") != str(gap_list):
        print(f"체크포인트의 gap list({checkpoint.get('gap_list')})와 다릅니다. "
              "--reset을 쓰거나 같은 gap list를 지정하세요.", file=sys.stderr)
        raise SystemExit(2)
    return checkpoint


def main() -> int:
    args = parse_args()
    folder_root = Path(__file__).resolve().parents[1]
    project_root = Path(__file__).resolve().parents[3]
    load_dotenv(folder_root / ".env")
    load_dotenv(project_root / ".env")
    auth_key = os.environ.get("DATA4LIBRARY_AUTH_KEY")
    if not auth_key:
        print("DATA4LIBRARY_AUTH_KEY가 .env 또는 환경 변수에 필요합니다.", file=sys.stderr)
        return 2

    gap_list_path = args.gap_list.resolve()
    entries = []
    with gap_list_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    if not entries:
        print("gap list가 비어 있습니다.", file=sys.stderr)
        return 2

    output = args.output_dir.resolve()
    for directory in ("raw", "processed", "samples", "reports", "metadata"):
        (output / directory).mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    checkpoint_path = output / "metadata" / "gap_collector_checkpoint.json"
    state = load_checkpoint(checkpoint_path, gap_list_path, args.reset)

    write_json(output / "metadata" / "range_plan.json", {
        "created_at": utc_now(),
        "api": "도서관 정보나루 srchDtlList",
        "endpoint": API_URL,
        "strategy": "국중도 결측 ISBN gap list를 순서대로 단건 조회",
        "gap_list": str(gap_list_path),
        "gap_list_total": len(entries),
        "resume_from_index": state["next_index"],
        "max_requests_this_batch": args.max_requests,
        "daily_quota": "기본 인증키 500회 (활용 승인 시 30,000회)",
    })

    raw_path = output / "raw" / f"dtl_raw_{stamp}.jsonl"
    processed_path = output / "processed" / f"data4library_normalized_{stamp}.jsonl"
    unresolved: list[dict[str, Any]] = []
    filled_counts = {field: 0 for field in FIELD_MAPPING.values()}
    samples: list[dict[str, Any]] = []
    requests_this_run = 0
    fatal_error: str | None = None

    def persist_state() -> None:
        state["updated_at"] = utc_now()
        write_json(checkpoint_path, state)

    raw_handle = raw_path.open("a", encoding="utf-8")
    processed_handle = processed_path.open("a", encoding="utf-8")
    try:
        while state["next_index"] < len(entries) and requests_this_run < args.max_requests:
            entry = entries[state["next_index"]]
            isbn13 = str(entry.get("isbn13") or "").strip()
            if not isbn13:
                state["next_index"] += 1
                continue

            payload: dict[str, Any] | None = None
            last_error: str | None = None
            for attempt in range(args.retries + 1):
                if requests_this_run >= args.max_requests:
                    break
                requests_this_run += 1  # 모든 네트워크 시도가 쿼터를 소모한다
                state["request_count_total"] += 1
                try:
                    payload = api_request(auth_key, isbn13)
                    break
                except HTTPError as error:
                    last_error = f"HTTP {error.code}: {error.reason}"
                except (URLError, TimeoutError, json.JSONDecodeError) as error:
                    last_error = str(error)
                if attempt < args.retries:
                    time.sleep(min(2 ** attempt, 16))
            if payload is None:
                unresolved.append({"isbn13": isbn13, "error": last_error, "attempts": args.retries + 1})
                state["next_index"] += 1
                persist_state()
                continue

            raw_handle.write(json.dumps({
                "collected_at": utc_now(),
                "request": {"isbn13": isbn13, "loaninfoYN": "N"},
                "response": payload,
            }, ensure_ascii=False) + "\n")

            book, error = extract_book(payload)
            if error:
                if any(keyword in error for keyword in FATAL_ERROR_KEYWORDS):
                    fatal_error = error
                    persist_state()
                    break
                unresolved.append({"isbn13": isbn13, "error": error, "attempts": 1})
            elif book is None:
                state["no_hits"] += 1
            else:
                record = to_nl_record(book)
                if not record["EA_ISBN"]:
                    record["EA_ISBN"] = isbn13  # 응답에 isbn13이 비어 있으면 요청값을 보존한다
                processed_handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                state["hits"] += 1
                for field in filled_counts:
                    if record[field]:
                        filled_counts[field] += 1
                if len(samples) < 10:
                    samples.append(record)

            state["next_index"] += 1
            if requests_this_run % 50 == 0:
                print(f"requests={requests_this_run:,} index={state['next_index']:,}/{len(entries):,} "
                      f"hits={state['hits']:,} no_hits={state['no_hits']:,}", flush=True)
            persist_state()
            time.sleep(args.delay)
    finally:
        raw_handle.close()
        processed_handle.close()
        persist_state()

    if samples:
        with (output / "samples" / "sample_data4library.jsonl").open("w", encoding="utf-8") as sample_file:
            for record in samples:
                sample_file.write(json.dumps(record, ensure_ascii=False) + "\n")
        write_json(output / "samples" / "sample_data4library.pretty.json", samples)
    write_json(output / "metadata" / "unresolved_ranges.json", unresolved)

    processed_count = state["hits"] + state["no_hits"]
    hit_rate = state["hits"] / processed_count * 100 if processed_count else 0.0
    summary_lines = [
        "정보나루 결측 보강 수집 품질 요약",
        "=" * 62,
        f"완료 시각(UTC): {utc_now()}",
        f"gap list: {gap_list_path}",
        f"gap list 전체 ISBN 수: {len(entries):,}",
        f"진행 위치(next_index): {state['next_index']:,}",
        f"이번 실행 API 요청 수: {requests_this_run:,}",
        f"누적 API 요청 수: {state['request_count_total']:,}",
        f"누적 히트(레코드 확보): {state['hits']:,}",
        f"누적 미히트(레코드 없음): {state['no_hits']:,}",
        f"누적 히트율: {hit_rate:.2f}%",
        f"이번 실행 미해결 요청 수: {len(unresolved):,}",
        "",
        "이번 실행에서 정규화 후 값이 채워진 건수:",
    ]
    summary_lines += [f"  {field}: {count:,}" for field, count in filled_counts.items()]
    if fatal_error:
        summary_lines += ["", f"중단 사유(키·쿼터 오류): {fatal_error}"]
    (output / "reports" / f"data_quality_summary_gap_{stamp}.txt").write_text(
        "\n".join(summary_lines) + "\n", encoding="utf-8")

    if fatal_error:
        print(f"키·쿼터 오류로 중단: {fatal_error}", file=sys.stderr)
        return 3
    if state["next_index"] >= len(entries):
        print(f"gap list 완료. hits={state['hits']:,} no_hits={state['no_hits']:,} 히트율={hit_rate:.2f}%")
    else:
        print(f"요청 한도 도달. 다음 실행에서 index {state['next_index']:,}부터 이어서 수집합니다. "
              f"hits={state['hits']:,} 히트율={hit_rate:.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
