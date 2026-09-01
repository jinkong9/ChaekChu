#!/usr/bin/env python3
"""엑셀에서 한글이 깨지지 않는 CSV 사본을 만든다.

원인
  산출 CSV 는 전부 **UTF-8 인데 BOM 이 없다.**
  한국어 윈도우 엑셀은 BOM 이 없으면 CP949(ANSI) 로 가정하고 열기 때문에
  한글이 전부 깨져 보인다. 파일이 잘못된 것이 아니라 엑셀의 추측이 틀린 것이다.

왜 원본을 안 고치는가
  파이프라인 스크립트들이 `encoding="utf-8"` 로 읽는다. 원본에 BOM 을 붙이면
  첫 컬럼명 앞에 `\\ufeff` 가 붙어 `row["isbn13"]` 같은 접근이 깨진다.
  그래서 **원본은 그대로 두고 엑셀용 사본을 따로** 만든다.

만드는 것
  <원본>.xlsx.csv   UTF-8 BOM 을 붙인 사본. 더블클릭하면 바로 열린다

주의
  본문 텍스트가 든 CSV(nl_text_clean 등)는 한 셀이 10만 자에 달한다.
  엑셀 셀 상한은 32,767자라 잘린다. `--preview` 로 앞부분만 뽑는 편이 낫다.

실행
    py scripts/make_excel_copy.py data4library/enrich_queue.csv
    py scripts/make_excel_copy.py nl_text_clean.csv --preview 2000
    py scripts/make_excel_copy.py --all
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

csv.field_size_limit(50_000_000)
BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
CANDIDATES = [
    "data4library/enrich_queue.csv",
    "nl_text_clean.csv",
    "nl_url_text.csv",
]
CELL_LIMIT = 32_000          # 엑셀 셀 상한(32,767)보다 살짝 아래


def convert(src: Path, preview: int, cap_cells: bool) -> Path:
    out = src.with_suffix(src.suffix + ".xlsx.csv")
    written = 0
    truncated = 0
    with src.open(encoding="utf-8", errors="replace", newline="") as source, \
         out.open("w", encoding="utf-8-sig", newline="") as sink:
        reader = csv.reader(source)
        writer = csv.writer(sink)
        for row in reader:
            if cap_cells:
                capped = []
                for cell in row:
                    if len(cell) > CELL_LIMIT:
                        cell = cell[:CELL_LIMIT] + " …(잘림)"
                        truncated += 1
                    capped.append(cell)
                row = capped
            writer.writerow(row)
            written += 1
            if preview and written > preview:
                break
    size = out.stat().st_size / 1024 / 1024
    note = f" · 셀 절단 {truncated:,}건" if truncated else ""
    print(f"  {src.name:<28} -> {out.name}  {written:,}행 · {size:.1f}MB{note}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", help="변환할 CSV (BASE 기준 상대경로 가능)")
    parser.add_argument("--all", action="store_true", help="알려진 CSV 전부")
    parser.add_argument("--preview", type=int, default=0,
                        help="앞에서 N행만 (큰 파일 확인용)")
    parser.add_argument("--no-cap", action="store_true",
                        help="셀 길이 절단을 끈다 (엑셀에서 깨질 수 있다)")
    args = parser.parse_args()

    targets = []
    if args.all:
        targets = [BASE / p for p in CANDIDATES]
    elif args.path:
        p = Path(args.path)
        targets = [p if p.is_absolute() or p.exists() else BASE / args.path]
    else:
        parser.error("경로를 주거나 --all 을 쓸 것")

    print("UTF-8 BOM 사본 생성 (엑셀에서 한글이 깨지지 않는다)\n")
    for src in targets:
        if not src.exists():
            print(f"  {src} — 없음, 건너뜀")
            continue
        convert(src, args.preview, not args.no_cap)
    print("\n생성된 .xlsx.csv 를 더블클릭하면 엑셀이 UTF-8 로 인식한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
