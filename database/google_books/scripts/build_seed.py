#!/usr/bin/env python3
"""저장소에 커밋된 샘플/리포트에서 실측 ISBN13을 추출해 계층 라벨과 함께 시드를 만든다.

로컬에 수집 원본(raw/)이 없는 환경에서도 재현 가능한 표본을 얻기 위한 스크립트다.
표본이 베스트셀러·신간에 편중된다는 한계는 reports/ 요약에 명시한다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DB_ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "metadata" / "seed_isbns.jsonl"

ISBN13_RE = re.compile(rb"\b97[89][0-9]{10}\b")

# 출처 폴더 -> (계층, 성격) : 표본 편향을 나중에 해석할 수 있도록 라벨을 붙인다.
SOURCES = {
    "국립중앙도서관": ("KR_CATALOG", "국중 카탈로그 샘플(상업성 낮음 포함)"),
    "알라딘": ("KR_RETAIL", "알라딘 베스트셀러·신간 표본"),
    "yes24": ("KR_RETAIL", "YES24 신상품 표본"),
    "카카오": ("KR_RETAIL", "카카오 검색 표본"),
}


def valid_isbn13(value: str) -> bool:
    if len(value) != 13 or not value.isdigit():
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(value[:12]))
    return (10 - total % 10) % 10 == int(value[12])


def main() -> int:
    found: dict[str, dict] = {}
    for folder, (stratum, note) in SOURCES.items():
        base = DB_ROOT / folder
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in {".jsonl", ".json", ".csv", ".py", ".md", ".txt"}:
                continue
            for match in ISBN13_RE.findall(path.read_bytes()):
                isbn = match.decode()
                if isbn in found:
                    continue
                found[isbn] = {
                    "isbn13": isbn,
                    "stratum": "FOREIGN" if isbn[:5] not in {"97889", "97911", "97910"} else stratum,
                    "source_folder": folder,
                    "source_file": str(path.relative_to(DB_ROOT)).replace("\\", "/"),
                    "source_note": note,
                    "checksum_valid": valid_isbn13(isbn),
                }

    rows = sorted(found.values(), key=lambda r: (r["stratum"], r["isbn13"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as sink:
        for row in rows:
            sink.write(json.dumps(row, ensure_ascii=False) + "\n")

    from collections import Counter
    strata = Counter(r["stratum"] for r in rows)
    invalid = [r["isbn13"] for r in rows if not r["checksum_valid"]]
    print(f"추출 {len(rows)}건 -> {OUT.relative_to(DB_ROOT)}")
    for key, count in sorted(strata.items()):
        print(f"  {key:12s} {count}건")
    print(f"  체크섬 실패 {len(invalid)}건 {invalid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
