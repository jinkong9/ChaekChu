#!/usr/bin/env python3
"""국립중앙도서관 books_all_years.jsonl 을 Parquet 으로 변환한다.

두 가지 이유로 필수다.

1. 성능 — Phase 0 의 측정은 컬럼 1~5개만 읽는다. JSONL 은 2.36GB 전량을 파싱해야 하지만
   Parquet 은 필요한 컬럼만 읽어 수 초에 끝난다. 측정은 반복 실행되므로 차이가 누적된다.
2. 표본 추출 정합성 — 원본 JSONL 은 **발행연도순으로 엄격히 정렬돼 있다.**
   바이트 오프셋 기반 표집은 연도 편향이 구조적으로 생긴다.
   Parquet 으로 옮긴 뒤 연도 컬럼으로 층을 잡아야 층화 표본이 성립한다.

**모든 컬럼을 VARCHAR 로 읽는다.** 자동 타입 추론에 맡기면 EA_ISBN 이 BIGINT 로 잡혀
선행 0과 979 접두가 파괴되고 조인 키가 깨진다.

실행:
    py scripts/convert_nl_to_parquet.py
    py scripts/convert_nl_to_parquet.py --input <경로> --output <경로>
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import duckdb

DEFAULT_INPUT = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\books_all_years.jsonl")
DEFAULT_OUTPUT = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_books.parquet")

# 실측 확인된 39개 필드. 전부 VARCHAR 로 고정한다.
COLUMNS = [
    "EA_ISBN", "SET_ISBN", "RELATED_ISBN", "TITLE", "AUTHOR", "PUBLISHER",
    "PUBLISH_PREDATE", "REAL_PUBLISH_DATE", "INPUT_DATE", "UPDATE_DATE",
    "EA_ADD_CODE", "SET_ADD_CODE", "KDC", "DDC", "SUBJECT",
    "BOOK_INTRODUCTION", "BOOK_INTRODUCTION_URL",
    "BOOK_TB_CNT", "BOOK_TB_CNT_URL",
    "BOOK_SUMMARY", "BOOK_SUMMARY_URL",
    "PRE_PRICE", "REAL_PRICE", "PAGE", "BOOK_SIZE",
    "FORM", "FORM_DETAIL", "EDITION_STMT", "SERIES_TITLE", "SERIES_NO", "VOL",
    "SET_EXPRESSION", "CONTROL_NO", "CIP_YN", "EBOOK_YN", "DEPOSIT_YN", "BIB_YN",
    "PUBLISHER_URL", "TITLE_URL",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--memory-limit", default="4GB")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"입력 파일이 없습니다: {args.input}")

    source_size = args.input.stat().st_size
    print(f"입력: {args.input}")
    print(f"      {source_size:,} 바이트 ({source_size / 1024**3:.2f} GB)")
    print(f"출력: {args.output}")
    print("")

    spec = ", ".join(f"'{name}': 'VARCHAR'" for name in COLUMNS)
    connection = duckdb.connect()
    connection.execute(f"SET memory_limit='{args.memory_limit}'")
    connection.execute("SET preserve_insertion_order=false")

    started = time.time()
    print("변환 중... (전 컬럼 VARCHAR 고정, ZSTD 압축)")
    connection.execute(f"""
        COPY (
            SELECT * FROM read_json(
                '{args.input.as_posix()}',
                auto_detect = false,
                columns = {{{spec}}},
                format = 'newline_delimited',
                ignore_errors = true,
                maximum_object_size = 33554432
            )
        ) TO '{args.output.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    elapsed = time.time() - started

    rows = connection.execute(
        f"SELECT count(*) FROM '{args.output.as_posix()}'").fetchone()[0]
    out_size = args.output.stat().st_size

    print("")
    print("=== 변환 완료 ===")
    print(f"  소요 시간   : {elapsed / 60:.1f}분")
    print(f"  레코드      : {rows:,}건")
    print(f"  출력 크기   : {out_size:,} 바이트 ({out_size / 1024**3:.2f} GB)")
    print(f"  압축률      : {source_size / out_size:.1f}배")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
