#!/usr/bin/env python3
"""정규화 결과(processed/*.jsonl)의 필드별 결측률 리포트를 만든다.

표준(API_DATA_STANDARD.md)의 `reports/missing_report_{scope}.csv` 형식을 따르며,
필드별 결측 건수·결측률과 실제 예시 값을 기록한다.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="정보나루 정규화 결과 필드 결측 리포트")
    parser.add_argument("inputs", nargs="+", type=Path, help="processed JSONL 파일 경로")
    parser.add_argument("--scope", default="gap", help="리포트 파일명에 들어갈 범위 이름. 기본 gap")
    parser.add_argument("--output-dir", type=Path, default=root)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    stamp = datetime.now().strftime("%Y%m%d")
    total = 0
    missing: dict[str, int] = {}
    examples: dict[str, list[str]] = {}
    for path in args.inputs:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                total += 1
                for field, value in record.items():
                    missing.setdefault(field, 0)
                    examples.setdefault(field, [])
                    if value is None or str(value).strip() == "":
                        missing[field] += 1
                    elif len(examples[field]) < 3:
                        text = str(value).replace("\n", " ")
                        examples[field].append(text[:80])

    output_dir = args.output_dir.resolve()
    (output_dir / "reports").mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "reports" / f"missing_report_{args.scope}_{stamp}.csv"
    with report_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["field", "total_count", "missing_count", "missing_rate_percent", "example_valid_values"])
        for field in sorted(missing, key=lambda name: missing[name], reverse=True):
            rate = missing[field] / total * 100 if total else 0.0
            writer.writerow([field, total, missing[field], f"{rate:.2f}", " | ".join(examples[field])])
    print(f"records={total:,} -> {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
