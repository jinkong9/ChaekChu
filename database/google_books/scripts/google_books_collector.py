#!/usr/bin/env python3
"""ISBN13 목록을 Google Books `volumes` API로 조회해 응답 원형을 JSONL로 저장한다.

표준 라이브러리만 사용한다(카카오·YES24 수집기와 동일한 방침).

`q=isbn:` 검색은 요청 ISBN과 다른 판본을 돌려줄 수 있으므로,
응답의 industryIdentifiers 를 대조해 정확 일치 여부를 레코드에 남긴다.
정확 일치하지 않은 응답은 성공으로 세지 않는다.

실행:
    py scripts/google_books_collector.py
    py scripts/google_books_collector.py --resume --limit 100
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

API_URL = "https://www.googleapis.com/books/v1/volumes"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env"
DEFAULT_SEED = ROOT / "metadata" / "seed_isbns.jsonl"
DEFAULT_OUTPUT = ROOT / "raw" / f"volumes_raw_{date.today():%Y%m%d}.jsonl"
DEFAULT_UNRESOLVED = ROOT / "metadata" / "unresolved_ranges.json"
RETRYABLE = {500, 502, 503, 504}


class AuthenticationError(RuntimeError):
    """API 키가 없거나 유효하지 않을 때 발생한다."""


class DailyQuotaExceeded(RuntimeError):
    """일일 쿼터를 소진했을 때 발생한다."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def valid_isbn13(value: str) -> bool:
    if len(value) != 13 or not value.isdigit():
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(value[:12]))
    return (10 - total % 10) % 10 == int(value[12])


class GoogleBooksClient:
    def __init__(self, api_key: str, country: str | None, sleep: float, retries: int) -> None:
        self.api_key = api_key
        self.country = country
        self.sleep = sleep
        self.retries = retries
        self.calls = 0

    def fetch(self, isbn13: str) -> dict[str, Any]:
        params: dict[str, Any] = {"q": "isbn:" + isbn13, "key": self.api_key, "maxResults": 5}
        if self.country:
            params["country"] = self.country
        url = API_URL + "?" + urlencode(params)
        request = Request(url, headers={"User-Agent": "b102-google-books-collector/1.0"})

        last_error: str | None = None
        for attempt in range(self.retries + 1):
            self.calls += 1
            try:
                with urlopen(request, timeout=30) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if self.sleep:
                    time.sleep(self.sleep)
                return payload
            except HTTPError as error:
                body = error.read().decode("utf-8", "replace")
                if error.code == 429:
                    raise DailyQuotaExceeded(body[:500])
                if error.code in (401, 403):
                    # 403 은 쿼터 초과로도 오므로 본문으로 구분한다.
                    lowered = body.lower()
                    if "quota" in lowered or "ratelimitexceeded" in lowered:
                        raise DailyQuotaExceeded(body[:500])
                    raise AuthenticationError("HTTP " + str(error.code) + ": " + body[:500])
                if error.code not in RETRYABLE:
                    return {"__http_error__": error.code, "__body__": body[:1000]}
                last_error = "HTTP " + str(error.code)
            except (URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = type(error).__name__ + ": " + str(error)
            if attempt < self.retries:
                time.sleep(min(2 ** attempt, 8))
        return {"__request_error__": last_error}


def extract_identifiers(volume: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for entry in volume.get("volumeInfo", {}).get("industryIdentifiers") or []:
        kind = entry.get("type")
        value = entry.get("identifier")
        if kind and value:
            out[kind] = value
    return out


def classify(payload: dict[str, Any], isbn13: str) -> tuple[str, dict[str, Any] | None, bool]:
    """(status, matched_volume, exact_match) 를 돌려준다."""
    if "__http_error__" in payload:
        return "api_error", None, False
    if "__request_error__" in payload:
        return "request_error", None, False
    items = payload.get("items") or []
    if not items:
        return "not_found", None, False
    for volume in items:
        if isbn13 in extract_identifiers(volume).values():
            return "success", volume, True
    # ISBN 검색이 다른 판본을 돌려준 경우. 성공으로 세지 않는다.
    return "isbn_mismatch", items[0], False


def load_seed(path: Path, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if limit:
        rows = rows[:limit]
    return rows


def completed(path: Path) -> set[str]:
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["request"]["isbn13"])
            except (json.JSONDecodeError, KeyError):
                continue
    return done


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--country", default="KR", help="Google Books country 파라미터")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.15)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--resume", action="store_true", help="이미 조회한 ISBN은 건너뛴다")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    api_key = os.environ.get("GOOGLE_BOOKS_API_KEY", "").strip()
    if not api_key:
        raise AuthenticationError("GOOGLE_BOOKS_API_KEY 가 없습니다. .env 를 확인하세요.")

    seed = load_seed(args.seed, args.limit)
    skip = completed(args.output) if args.resume else set()
    targets = [row for row in seed if row["isbn13"] not in skip]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    client = GoogleBooksClient(api_key, args.country, args.sleep, args.retries)
    counts: dict[str, int] = {}
    quota_hit = False
    unresolved: list[dict[str, Any]] = []

    with args.output.open("a", encoding="utf-8") as sink:
        for index, row in enumerate(targets, start=1):
            isbn13 = row["isbn13"]
            payload: dict[str, Any] = {}
            if not valid_isbn13(isbn13):
                status, volume, exact = "invalid_isbn", None, False
            else:
                try:
                    payload = client.fetch(isbn13)
                except DailyQuotaExceeded as error:
                    quota_hit = True
                    unresolved.append({
                        "isbn13": isbn13,
                        "reason": "daily_quota_exceeded",
                        "detail": str(error)[:300],
                    })
                    print("[" + str(index) + "/" + str(len(targets)) + "] 일일 쿼터 소진으로 중단")
                    break
                status, volume, exact = classify(payload, isbn13)

            counts[status] = counts.get(status, 0) + 1
            if status in ("api_error", "request_error"):
                unresolved.append({
                    "isbn13": isbn13,
                    "reason": status,
                    "detail": json.dumps(payload, ensure_ascii=False)[:300],
                })

            record = {
                "collected_at_utc": utc_now(),
                "request": {
                    "isbn13": isbn13,
                    "q": "isbn:" + isbn13,
                    "country": args.country,
                    "stratum": row.get("stratum"),
                    "source_folder": row.get("source_folder"),
                },
                "status": status,
                "exact_isbn_match": exact,
                "total_items": payload.get("totalItems"),
                "matched_volume": volume,
                "response": payload,
            }
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            sink.flush()
            print("[" + str(index) + "/" + str(len(targets)) + "] " + isbn13
                  + " " + str(row.get("stratum")).ljust(11) + " -> " + status)

    DEFAULT_UNRESOLVED.write_text(
        json.dumps(unresolved, ensure_ascii=False, indent=2), encoding="utf-8")

    print("")
    print("=== 수집 요약 ===")
    print("API 호출 수: " + str(client.calls))
    for key in sorted(counts):
        print("  " + key.ljust(14) + " " + str(counts[key]) + "건")
    print("일일 쿼터 소진: " + str(quota_hit))
    print("출력: " + str(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
