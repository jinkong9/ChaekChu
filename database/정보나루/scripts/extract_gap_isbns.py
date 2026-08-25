#!/usr/bin/env python3
"""국립중앙도서관 수집 결과에서 핵심 필드가 결측인 레코드의 ISBN-13 목록을 추출한다.

정보나루(도서관 정보나루) 보강 수집기의 입력이 되는 gap list를 만든다.

- 입력: 국중도 스키마(EA_ISBN, AUTHOR, BOOK_INTRODUCTION ...) JSONL 파일 또는 디렉토리
- 출력: metadata/gap_isbn_list_{YYYYMMDD}.jsonl (한 줄 = {"isbn13": ..., "missing": [...]})

같은 ISBN이 여러 레코드에 나타나면, 모든 레코드에서 비어 있는 필드 그룹만 결측으로 판정한다.
ISBN-10은 ISBN-13으로 변환하고, 체크섬이 틀린 값은 제외한 뒤 건수만 집계한다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

# 정보나루로 보강할 수 있는 필드 그룹. 그룹 안의 모든 필드가 비어 있을 때만 결측으로 본다.
FIELD_GROUPS: dict[str, tuple[str, ...]] = {
    "author": ("AUTHOR",),
    "description": ("BOOK_INTRODUCTION", "BOOK_SUMMARY"),
    "cover": ("TITLE_URL",),
    "kdc": ("KDC",),
}
DEFAULT_GROUPS = ("author", "description")

# 국중도 데이터에서 실질적 결측으로 취급하는 자리표시 값
PLACEHOLDERS = {"-", "--", ".", "N/A", "n/a", "없음"}


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="국중도 결측 ISBN gap list 추출기")
    parser.add_argument("inputs", nargs="+", type=Path,
                        help="국중도 스키마 JSONL 파일 또는 디렉토리(하위 *.jsonl 전체)")
    parser.add_argument("--fields", default=",".join(DEFAULT_GROUPS),
                        help=f"결측 판정 필드 그룹(콤마 구분). 선택지: {', '.join(FIELD_GROUPS)}. 기본 {','.join(DEFAULT_GROUPS)}")
    parser.add_argument("--min-year", type=int, default=None,
                        help="PUBLISH_PREDATE 연도가 이 값 이상인 레코드만 대상. 쿼터 절약용")
    parser.add_argument("--output", type=Path, default=None,
                        help="gap list 출력 경로. 기본 metadata/gap_isbn_list_{date}.jsonl")
    parser.add_argument("--output-dir", type=Path, default=root)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def isbn10_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", value):
        return False
    total = sum((10 - index) * int(char) for index, char in enumerate(value[:9]))
    total += 10 if value[-1] == "X" else int(value[-1])
    return total % 11 == 0


def isbn13_is_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{13}", value):
        return False
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(value[:12]))
    return (10 - total % 10) % 10 == int(value[-1])


def isbn10_to_13(value: str) -> str | None:
    if not isbn10_is_valid(value):
        return None
    prefix = "978" + value[:9]
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(prefix))
    return prefix + str((10 - total % 10) % 10)


def to_isbn13(raw: Any) -> str | None:
    """EA_ISBN 원본값을 검증된 ISBN-13으로 정규화한다. 실패 시 None."""
    candidate = re.sub(r"[^0-9Xx]", "", str(raw or "")).upper()
    if len(candidate) == 13 and isbn13_is_valid(candidate):
        return candidate
    if len(candidate) == 10 and isbn10_is_valid(candidate):
        return isbn10_to_13(candidate)
    return None


def value_is_missing(value: Any) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    return text == "" or text in PLACEHOLDERS


def record_missing_mask(record: dict[str, Any], groups: list[str]) -> int:
    """레코드에서 비어 있는 필드 그룹을 비트마스크로 반환한다."""
    mask = 0
    for bit, group in enumerate(groups):
        if all(value_is_missing(record.get(field)) for field in FIELD_GROUPS[group]):
            mask |= 1 << bit
    return mask


def passes_year_filter(record: dict[str, Any], min_year: int | None) -> bool:
    if min_year is None:
        return True
    predate = str(record.get("PUBLISH_PREDATE") or "")
    return len(predate) >= 4 and predate[:4].isdigit() and int(predate[:4]) >= min_year


def iter_jsonl_files(inputs: list[Path]) -> Iterator[Path]:
    for entry in inputs:
        if entry.is_dir():
            yield from sorted(entry.rglob("*.jsonl"))
        elif entry.exists():
            yield entry
        else:
            print(f"경고: 입력 경로가 없습니다: {entry}", file=sys.stderr)


def main() -> int:
    args = parse_args()
    groups = [group.strip() for group in args.fields.split(",") if group.strip()]
    unknown = [group for group in groups if group not in FIELD_GROUPS]
    if unknown or not groups:
        print(f"알 수 없는 필드 그룹: {unknown or args.fields}. 선택지: {', '.join(FIELD_GROUPS)}", file=sys.stderr)
        return 2

    stamp = datetime.now().strftime("%Y%m%d")
    output_dir = args.output_dir.resolve()
    (output_dir / "metadata").mkdir(parents=True, exist_ok=True)
    output_path = args.output or output_dir / "metadata" / f"gap_isbn_list_{stamp}.jsonl"

    # isbn13 -> 아직 모든 레코드에서 비어 있는 그룹의 비트마스크
    masks: dict[str, int] = {}
    stats = {
        "input_files": 0, "total_records": 0, "bad_json_lines": 0,
        "invalid_isbn_records": 0, "year_filtered_records": 0,
    }
    for path in iter_jsonl_files(args.inputs):
        stats["input_files"] += 1
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    stats["bad_json_lines"] += 1
                    continue
                stats["total_records"] += 1
                if not passes_year_filter(record, args.min_year):
                    stats["year_filtered_records"] += 1
                    continue
                isbn13 = to_isbn13(record.get("EA_ISBN"))
                if isbn13 is None:
                    stats["invalid_isbn_records"] += 1
                    continue
                mask = record_missing_mask(record, groups)
                # 같은 ISBN의 다른 레코드가 이미 값을 갖고 있으면 결측에서 제외한다.
                masks[isbn13] = masks[isbn13] & mask if isbn13 in masks else mask

    group_counts = {group: 0 for group in groups}
    gap_count = 0
    with output_path.open("w", encoding="utf-8") as handle:
        for isbn13 in sorted(masks):
            mask = masks[isbn13]
            if mask == 0:
                continue
            missing = [group for bit, group in enumerate(groups) if mask & (1 << bit)]
            for group in missing:
                group_counts[group] += 1
            handle.write(json.dumps({"isbn13": isbn13, "missing": missing}, ensure_ascii=False) + "\n")
            gap_count += 1

    summary = {
        "created_at": utc_now(),
        "field_groups": groups,
        "min_year": args.min_year,
        **stats,
        "unique_isbn13": len(masks),
        "gap_isbn13": gap_count,
        "missing_count_by_group": group_counts,
        "gap_list_path": str(output_path),
    }
    summary_path = output_dir / "metadata" / f"gap_extract_summary_{stamp}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
