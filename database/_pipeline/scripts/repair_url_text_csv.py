#!/usr/bin/env python3
"""회수 CSV 복구 — 동시 실행으로 깨진 행을 걸러내고 중복을 제거한다.

사고 경위
  recover_nl_url_text.py 를 두 프로세스가 동시에 같은 파일에 append 하면서
  행 중간에 다른 프로세스의 출력이 끼어들어 바이트가 깨졌다.
  (프로세스 생존 확인이 잘못돼 중복 기동한 것이 원인)

복구 방침
  - UTF-8 로 깨끗이 디코딩되는 행만 채택 (깨진 행은 버린다)
  - 필수 컬럼이 온전하고 chars 가 숫자이며 text 길이가 일치하는 행만 채택
  - (isbn13, field) 중복은 더 긴 텍스트를 남긴다
  - 원본은 .corrupt 로 보존

실행:
    py scripts/repair_url_text_csv.py
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

csv.field_size_limit(20_000_000)
TARGET = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\nl_url_text.csv")
MIN_CHARS = 20


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=TARGET)
    args = parser.parse_args()
    path = args.path

    raw = path.read_bytes()
    print(f"원본 {len(raw)/1024/1024:.1f} MB")

    # 깨진 바이트는 대체 문자로 바꿔 읽되, 그 문자가 든 행은 뒤에서 버린다
    text = raw.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    best: dict[tuple[str, str], tuple[int, str, str]] = {}
    stats = {"total": 0, "corrupt": 0, "malformed": 0, "short": 0, "dup": 0}
    for row in reader:
        stats["total"] += 1
        isbn = (row.get("isbn13") or "").strip()
        field = (row.get("field") or "").strip()
        url = (row.get("url") or "").strip()
        chars = (row.get("chars") or "").strip()
        body = row.get("text") or ""

        if not isbn.isdigit() or len(isbn) != 13 or field not in ("intro", "toc", "summary"):
            stats["malformed"] += 1
            continue
        if "\ufffd" in body or "\ufffd" in isbn or "\ufffd" in url:
            stats["corrupt"] += 1
            continue
        if not chars.isdigit():
            stats["malformed"] += 1
            continue
        # 동시 쓰기로 잘린 행은 선언 길이와 실제 길이가 어긋난다
        if abs(int(chars) - len(body)) > 2:
            stats["corrupt"] += 1
            continue
        if len(body) < MIN_CHARS:
            stats["short"] += 1
            continue

        key = (isbn, field)
        if key in best:
            stats["dup"] += 1
            if len(body) <= best[key][0]:
                continue
        best[key] = (len(body), url, body)

    backup = path.with_suffix(".csv.corrupt")
    path.replace(backup)
    with path.open("w", encoding="utf-8", newline="") as sink:
        writer = csv.writer(sink)
        writer.writerow(["isbn13", "field", "url", "chars", "text"])
        for (isbn, field), (length, url, body) in best.items():
            writer.writerow([isbn, field, url, length, body])

    print("")
    print("=== 복구 결과 ===")
    print(f"  읽은 행       {stats['total']:>9,}")
    print(f"  깨진 행 폐기   {stats['corrupt']:>9,}")
    print(f"  형식 오류 폐기 {stats['malformed']:>9,}")
    print(f"  너무 짧아 폐기 {stats['short']:>9,}")
    print(f"  중복 병합     {stats['dup']:>9,}")
    print(f"  최종 보존     {len(best):>9,}건")
    print(f"  파일 {path.stat().st_size/1024/1024:.1f} MB (원본 백업: {backup.name})")

    by_field: dict[str, int] = {}
    for (_, field) in best:
        by_field[field] = by_field.get(field, 0) + 1
    print("\n  필드별:")
    for field, count in sorted(by_field.items(), key=lambda x: -x[1]):
        print(f"    {field:<10}{count:>9,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
