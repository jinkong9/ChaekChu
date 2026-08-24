#!/usr/bin/env python3
"""YES24 신상품 목록에서 상세 조회용 ISBN 후보를 수집한다."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from yes24_isbn_collector import (
    ApiRequestError,
    AuthenticationError,
    DailyQuotaExceeded,
    DEFAULT_ENV_FILE,
    Yes24Client,
    load_env_file,
    normalize_isbn13,
)


NEW_PRODUCT_PATH = "/v1/category/newproduct"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "raw" / f"yes24_seed_raw_{date.today():%Y%m%d}.jsonl"
DEFAULT_CHECKPOINT = ROOT / "metadata" / "yes24_seed_checkpoint.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_existing(path: Path) -> set[str]:
    found: set[str] = set()
    if not path.exists():
        return found
    with path.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number} JSON 파싱 실패: {exc}") from exc
            isbn13 = normalize_isbn13(item.get("isbn13"))
            if isbn13:
                found.add(isbn13)
    return found


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"categoryIndex": 0, "nextPage": 1, "apiCalls": 0}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"체크포인트 형식이 잘못되었습니다: {path}")
    return data


def save_checkpoint(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YES24 상세 조회용 ISBN 후보를 수집합니다.")
    parser.add_argument("--target", type=int, default=20000, help="확보할 고유 ISBN 수")
    parser.add_argument("--categories", nargs="+", default=["001", "002"], help="순회할 카테고리 ID")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.12)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=5)
    args = parser.parse_args(argv)
    if args.target <= 0:
        parser.error("--target은 0보다 커야 합니다.")
    if not 1 <= args.page_size <= 100:
        parser.error("--page-size는 1~100이어야 합니다.")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(args.env_file)
    api_key = os.environ.get("YES24_API_KEY", "").strip()
    if not api_key:
        print(f"YES24_API_KEY가 없습니다. {args.env_file}를 확인하세요.", file=sys.stderr)
        return 2

    try:
        seen = load_existing(args.output)
        checkpoint = load_checkpoint(args.checkpoint)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if len(seen) >= args.target:
        print(f"ISBN 후보가 이미 {len(seen):,}건 있습니다: {args.output}")
        return 0

    category_index = int(checkpoint.get("categoryIndex", 0))
    next_page = int(checkpoint.get("nextPage", 1))
    api_calls = int(checkpoint.get("apiCalls", 0))
    client = Yes24Client(api_key, timeout=args.timeout, retries=args.retries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    print(f"기존 ISBN {len(seen):,}건, 목표 {args.target:,}건")

    try:
        with args.output.open("a", encoding="utf-8", newline="\n") as output:
            while category_index < len(args.categories) and len(seen) < args.target:
                category_id = args.categories[category_index]
                page = next_page
                status, payload = client.get(
                    NEW_PRODUCT_PATH,
                    {
                        "categoryId": category_id,
                        "sort": "RegDate",
                        "page": page,
                        "pageSize": args.page_size,
                        "detail": "N",
                    },
                )
                api_calls += 1
                data = payload.get("data") or {}
                items = data.get("items") if isinstance(data, dict) else []
                items = items if isinstance(items, list) else []

                if status == 404 or not items:
                    category_index += 1
                    next_page = 1
                    save_checkpoint(
                        args.checkpoint,
                        {"categoryIndex": category_index, "nextPage": next_page, "apiCalls": api_calls},
                    )
                    continue

                new_count = 0
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    isbn13 = normalize_isbn13(item.get("isbn13"))
                    if not isbn13 or isbn13 in seen:
                        continue
                    record = dict(item)
                    record["isbn13"] = isbn13
                    record["seed"] = {
                        "endpoint": NEW_PRODUCT_PATH,
                        "categoryId": category_id,
                        "page": page,
                        "collectedAt": utc_now(),
                    }
                    output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                    seen.add(isbn13)
                    new_count += 1
                    if len(seen) >= args.target:
                        break
                output.flush()

                total_count = int(data.get("totalCount") or 0)
                next_page = page + 1
                if total_count and next_page > (total_count + args.page_size - 1) // args.page_size:
                    category_index += 1
                    next_page = 1
                save_checkpoint(
                    args.checkpoint,
                    {
                        "categoryIndex": category_index,
                        "nextPage": next_page,
                        "apiCalls": api_calls,
                        "uniqueIsbns": len(seen),
                        "lastNewCount": new_count,
                    },
                )
                if api_calls % 10 == 0 or len(seen) >= args.target:
                    print(
                        f"목록 호출 {api_calls:,}회, ISBN {len(seen):,}/{args.target:,}건 "
                        f"(category={category_id}, page={page})"
                    )
                if args.delay:
                    time.sleep(args.delay)
    except DailyQuotaExceeded as exc:
        print(str(exc))
        print(f"현재 ISBN 후보: {len(seen):,}건")
        return 4
    except AuthenticationError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except (ApiRequestError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    finally:
        client.close()

    print(f"ISBN 후보 수집 완료: {len(seen):,}건")
    print(f"결과: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
