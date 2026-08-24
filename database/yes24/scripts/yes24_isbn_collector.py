#!/usr/bin/env python3
"""ISBN 목록을 YES24 상품 상세 API로 보강해 JSONL로 저장한다."""

from __future__ import annotations

import argparse
import csv
import http.client
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator
from urllib.parse import urlencode


API_URL = "https://apis.yes24.com/v1/goods/itemDetail"
API_HOST = "apis.yes24.com"
DETAIL_PATH = "/v1/goods/itemDetail"
DEFAULT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "raw"
    / f"yes24_detail_raw_{date.today():%Y%m%d}.jsonl"
)
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class AuthenticationError(RuntimeError):
    """API 키가 없거나 유효하지 않을 때 발생한다."""


class ApiRequestError(RuntimeError):
    """재시도 후에도 API 요청이 실패했을 때 발생한다."""


class DailyQuotaExceeded(RuntimeError):
    """YES24 일일 호출 한도가 소진되었을 때 발생한다."""


def load_env_file(path: Path) -> None:
    """외부 패키지 없이 단순 KEY=VALUE 형식의 .env를 읽는다."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and not os.environ.get(key, "").strip():
            os.environ[key] = value


def isbn13_check_digit(first_twelve: str) -> str:
    total = sum(
        int(char) * (1 if index % 2 == 0 else 3)
        for index, char in enumerate(first_twelve)
    )
    return str((10 - total % 10) % 10)


def valid_isbn10(value: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", value):
        return False
    total = sum((10 - index) * (10 if char == "X" else int(char)) for index, char in enumerate(value))
    return total % 11 == 0


def valid_isbn13(value: str) -> bool:
    return bool(re.fullmatch(r"\d{13}", value)) and value[-1] == isbn13_check_digit(value[:12])


def normalize_isbn13(raw_value: Any) -> str | None:
    """ISBN-10/13을 검증하고 YES24 조회용 ISBN-13으로 통일한다."""
    if raw_value is None:
        return None
    cleaned = re.sub(r"[^0-9Xx]", "", str(raw_value)).upper()
    if len(cleaned) == 13 and valid_isbn13(cleaned):
        return cleaned
    if len(cleaned) == 10 and valid_isbn10(cleaned):
        first_twelve = "978" + cleaned[:9]
        return first_twelve + isbn13_check_digit(first_twelve)
    return None


def nested_value(record: dict[str, Any], field: str) -> Any:
    current: Any = record
    for part in field.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def iter_input_isbns(path: Path, isbn_field: str) -> Iterator[Any]:
    suffix = path.suffix.lower()
    if suffix in {".jsonl", ".ndjson"}:
        with path.open("r", encoding="utf-8-sig") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path}:{line_number} JSON 파싱 실패: {exc}") from exc
                if not isinstance(record, dict):
                    raise ValueError(f"{path}:{line_number} 객체 형식이 아닙니다.")
                yield nested_value(record, isbn_field)
        return

    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames or isbn_field not in reader.fieldnames:
                raise ValueError(f"CSV에 '{isbn_field}' 컬럼이 없습니다: {path}")
            for record in reader:
                yield record.get(isbn_field)
        return

    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            value = line.strip()
            if value:
                yield value


def unique_targets(values: Iterable[Any], limit: int) -> list[tuple[str, str | None]]:
    targets: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    for value in values:
        raw = "" if value is None else str(value).strip()
        normalized = normalize_isbn13(raw)
        key = normalized or f"invalid:{raw}"
        if key in seen:
            continue
        seen.add(key)
        targets.append((raw, normalized))
        if limit > 0 and len(targets) >= limit:
            break
    return targets


def result_key(raw_isbn: str, isbn13: str | None) -> str:
    return isbn13 or f"invalid:{raw_isbn}"


def completed_keys(output_path: Path) -> set[str]:
    completed: set[str] = set()
    if not output_path.exists():
        return completed

    with output_path.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if record.get("status") not in {"success", "not_found", "invalid_isbn"}:
                    continue
                request_info = record.get("request", {})
                completed.add(
                    result_key(
                        str(request_info.get("rawIsbn", "")),
                        request_info.get("isbn13"),
                    )
                )
            except (json.JSONDecodeError, AttributeError) as exc:
                raise ValueError(
                    f"기존 출력 파일 {output_path}:{line_number}을 읽을 수 없습니다: {exc}"
                ) from exc
    return completed


def retry_delay(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            pass
    return min(30.0, float(2 ** (attempt - 1)))


def parse_response_body(raw_body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiRequestError("YES24 응답이 유효한 JSON이 아닙니다.") from exc
    if not isinstance(payload, dict):
        raise ApiRequestError("YES24 응답의 최상위 값이 객체가 아닙니다.")
    return payload


class Yes24Client:
    """HTTPS 연결을 재사용하는 YES24 JSON API 클라이언트."""

    def __init__(self, api_key: str, timeout: float = 20.0, retries: int = 5):
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
        self._connection: http.client.HTTPSConnection | None = None

    def close(self) -> None:
        if self._connection is not None:
            try:
                self._connection.close()
            finally:
                self._connection = None

    def _connect(self) -> http.client.HTTPSConnection:
        if self._connection is None:
            self._connection = http.client.HTTPSConnection(API_HOST, timeout=self.timeout)
        return self._connection

    def get(self, path: str, params: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        target = f"{path}?{urlencode(params)}" if params else path
        headers = {
            "X-Api-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "S15P21B102-yes24-collector/1.0",
        }

        for attempt in range(1, self.retries + 1):
            retry_after: str | None = None
            try:
                connection = self._connect()
                connection.request("GET", target, headers=headers)
                response = connection.getresponse()
                status = response.status
                retry_after = response.getheader("Retry-After")
                body = response.read()
                try:
                    payload = parse_response_body(body)
                except ApiRequestError:
                    payload = {
                        "success": False,
                        "message": f"HTTP {status}",
                        "errorCode": None,
                        "data": None,
                    }

                error_code = payload.get("errorCode")
                if status in {401, 403}:
                    raise AuthenticationError(
                        "YES24 API 인증에 실패했습니다. .env의 YES24_API_KEY를 확인하세요."
                    )
                if status == 429 and error_code == "RATE_002":
                    raise DailyQuotaExceeded("YES24 일일 호출 한도를 모두 사용했습니다.")
                if status == 404:
                    return status, payload
                if 200 <= status < 300:
                    return status, payload
                if status in RETRYABLE_STATUS_CODES and attempt < self.retries:
                    time.sleep(retry_delay(attempt, retry_after))
                    continue
                raise ApiRequestError(
                    f"YES24 요청 실패: HTTP {status}, {payload.get('message', '')}"
                )
            except (AuthenticationError, DailyQuotaExceeded, ApiRequestError):
                raise
            except (OSError, TimeoutError, http.client.HTTPException) as exc:
                self.close()
                if attempt < self.retries:
                    time.sleep(retry_delay(attempt, retry_after))
                    continue
                raise ApiRequestError(f"YES24 연결 실패: {exc}") from exc

        raise ApiRequestError("YES24 요청 재시도 횟수를 초과했습니다.")


def request_detail(
    client: Yes24Client,
    isbn13: str,
    detail: str,
) -> tuple[int, dict[str, Any]]:
    return client.get(
        DETAIL_PATH,
        {"searchType": "ISBN13", "query": isbn13, "detail": detail},
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_record(
    raw_isbn: str,
    isbn13: str | None,
    detail: str,
    status: str,
    payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "source": "YES24",
        "collectedAt": utc_now(),
        "request": {"rawIsbn": raw_isbn, "isbn13": isbn13, "detail": detail},
        "status": status,
    }
    if payload is not None:
        record["response"] = payload
    if error is not None:
        record["error"] = error
    return record


def append_record(output, record: dict[str, Any]) -> None:
    output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    output.flush()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ISBN 목록을 YES24 상품 상세 API로 조회해 JSONL로 저장합니다."
    )
    parser.add_argument("--input", type=Path, required=True, help="JSONL, CSV 또는 ISBN 텍스트 파일")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="결과 JSONL 경로")
    parser.add_argument("--isbn-field", default="EA_ISBN", help="JSONL/CSV의 ISBN 필드명")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE, help="API 키를 읽을 .env 경로")
    parser.add_argument("--limit", type=int, default=1000, help="처리할 고유 ISBN 수(0이면 전체)")
    parser.add_argument("--detail", choices=("Y", "N"), default="Y", help="YES24 상세 필드 포함 여부")
    parser.add_argument("--delay", type=float, default=0.2, help="정상 요청 사이 대기 시간(초)")
    parser.add_argument("--timeout", type=float, default=20.0, help="요청 타임아웃(초)")
    parser.add_argument("--retries", type=int, default=5, help="요청당 최대 시도 횟수")
    parser.add_argument(
        "--max-runtime-minutes",
        type=float,
        default=0,
        help="최대 실행 시간(분). 0이면 시간 제한 없음",
    )
    parser.add_argument("--no-resume", action="store_true", help="기존 결과를 확인하지 않고 다시 처리")
    args = parser.parse_args(argv)

    if args.limit < 0:
        parser.error("--limit은 0 이상이어야 합니다.")
    if args.delay < 0 or args.timeout <= 0 or args.retries <= 0:
        parser.error("--delay는 0 이상, --timeout과 --retries는 0보다 커야 합니다.")
    if args.max_runtime_minutes < 0:
        parser.error("--max-runtime-minutes는 0 이상이어야 합니다.")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.input.is_file():
        print(f"입력 파일을 찾을 수 없습니다: {args.input}", file=sys.stderr)
        return 2

    load_env_file(args.env_file)
    api_key = os.environ.get("YES24_API_KEY", "").strip()
    if not api_key:
        print(
            f"YES24_API_KEY가 없습니다. {args.env_file}에 키를 입력하세요.",
            file=sys.stderr,
        )
        return 2

    try:
        targets = unique_targets(iter_input_isbns(args.input, args.isbn_field), args.limit)
        completed = set() if args.no_resume else completed_keys(args.output)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    counts: Counter[str] = Counter()
    pending_count = sum(
        result_key(raw, isbn13) not in completed for raw, isbn13 in targets
    )
    print(
        f"입력 {len(targets):,}건, 기존 완료 {len(targets) - pending_count:,}건, "
        f"신규 처리 {pending_count:,}건"
    )

    client = Yes24Client(api_key, timeout=args.timeout, retries=args.retries)
    started_at = time.monotonic()
    stopped_by_runtime = False

    try:
        with args.output.open("a", encoding="utf-8", newline="\n") as output:
            processed = 0
            for raw_isbn, isbn13 in targets:
                if (
                    args.max_runtime_minutes > 0
                    and time.monotonic() - started_at >= args.max_runtime_minutes * 60
                ):
                    stopped_by_runtime = True
                    break
                key = result_key(raw_isbn, isbn13)
                if key in completed:
                    counts["skipped"] += 1
                    continue

                if isbn13 is None:
                    append_record(
                        output,
                        make_record(raw_isbn, None, args.detail, "invalid_isbn"),
                    )
                    counts["invalid_isbn"] += 1
                else:
                    try:
                        http_status, payload = request_detail(client, isbn13, args.detail)
                        data = payload.get("data") or {}
                        items = data.get("items") if isinstance(data, dict) else None
                        if http_status == 404 or not items:
                            status = "not_found"
                        elif payload.get("success") is True:
                            status = "success"
                        else:
                            status = "api_error"
                        append_record(
                            output,
                            make_record(raw_isbn, isbn13, args.detail, status, payload=payload),
                        )
                        counts[status] += 1
                    except ApiRequestError as exc:
                        append_record(
                            output,
                            make_record(raw_isbn, isbn13, args.detail, "request_error", error=str(exc)),
                        )
                        counts["request_error"] += 1

                    if args.delay:
                        time.sleep(args.delay)

                processed += 1
                if processed % 100 == 0 or processed == pending_count:
                    print(f"진행 {processed:,}/{pending_count:,}")
    except AuthenticationError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except DailyQuotaExceeded as exc:
        print(str(exc))
        print(f"현재까지 결과: {args.output}")
        return 4
    except OSError as exc:
        print(f"결과 파일 쓰기 실패: {exc}", file=sys.stderr)
        return 2
    finally:
        client.close()

    summary = ", ".join(f"{name}={count:,}" for name, count in sorted(counts.items()))
    print(f"완료: {summary or '처리할 항목 없음'}")
    if stopped_by_runtime:
        print(f"설정한 실행 시간 {args.max_runtime_minutes:g}분에 도달해 중단했습니다.")
    print(f"결과: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
