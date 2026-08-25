#!/usr/bin/env python3
"""Google Books 수집 JSONL의 품질 리포트와 저장소용 샘플을 생성한다.

측정 목적은 두 가지다.
1. ISBN 매칭률  — 국중 카탈로그의 ISBN을 Google Books가 알고 있는가
2. description 보유율 — 매칭된 건에 실제로 책소개 텍스트가 있는가

2번이 핵심이다. 매칭돼도 description 이 없으면 이 소스는 목적에 쓸모가 없다.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "raw" / f"volumes_raw_{date.today():%Y%m%d}.jsonl"
DEFAULT_REPORTS = ROOT / "reports"
DEFAULT_SAMPLES = ROOT / "samples"

# 이 길이 미만은 소개문이 아니라 플레이스홀더로 간주한다.
USABLE_MIN_CHARS = 100

# volumeInfo 아래에서 우리 서비스가 쓸 후보 필드
FIELDS = [
    "title", "subtitle", "authors", "publisher", "publishedDate",
    "description", "pageCount", "printType", "categories",
    "averageRating", "ratingsCount", "maturityRating", "language",
    "previewLink", "infoLink", "canonicalVolumeLink",
]


def load(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, (list, dict)) and not value:
        return True
    return False


def pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 2) if whole else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--scope", default="seed_sample")
    args = parser.parse_args()

    rows = load(args.input)
    DEFAULT_REPORTS.mkdir(parents=True, exist_ok=True)
    DEFAULT_SAMPLES.mkdir(parents=True, exist_ok=True)

    total = len(rows)
    status_counts = Counter(r["status"] for r in rows)
    by_stratum: dict[str, Counter] = defaultdict(Counter)
    desc_lengths: dict[str, list[int]] = defaultdict(list)

    for row in rows:
        stratum = row["request"].get("stratum") or "UNKNOWN"
        by_stratum[stratum][row["status"]] += 1
        volume = row.get("matched_volume")
        if row["status"] == "success" and volume:
            desc = volume.get("volumeInfo", {}).get("description") or ""
            by_stratum[stratum]["_matched"] += 1
            if desc.strip():
                by_stratum[stratum]["_with_desc"] += 1
                desc_lengths[stratum].append(len(desc))

    # 필드별 결측 리포트는 매칭 성공 건만 대상으로 한다.
    matched = [r for r in rows if r["status"] == "success" and r.get("matched_volume")]
    field_stats: dict[str, dict[str, Any]] = {}
    for field in FIELDS:
        present = 0
        blank = 0
        examples: list[str] = []
        for row in matched:
            info = row["matched_volume"].get("volumeInfo", {})
            if field in info:
                present += 1
            value = info.get(field)
            if is_blank(value):
                blank += 1
            elif len(examples) < 3:
                text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
                examples.append(text[:120])
        field_stats[field] = {
            "present": present,
            "missing": len(matched) - present + 0,
            "effective_missing": blank,
            "rate": pct(blank, len(matched)),
            "examples": examples,
        }

    # ---------- 품질 요약 ----------
    lines: list[str] = []
    lines.append("Google Books API 데이터 품질 요약")
    lines.append("=" * 70)
    lines.append(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"입력 파일: {args.input}")
    lines.append(f"대상 범위: {args.scope}")
    lines.append(f"조회 요청 수: {total}")
    for key in sorted(status_counts):
        lines.append(f"  {key}: {status_counts[key]}건")
    lines.append("")

    lines.append("[계층별 매칭률 / description 보유율]")
    header = f"{'계층':<12}{'요청':>6}{'매칭':>6}{'매칭률':>9}{'소개보유':>9}{'보유율(매칭중)':>16}{'보유율(요청중)':>16}"
    lines.append(header)
    lines.append("-" * len(header))
    for stratum in sorted(by_stratum):
        counter = by_stratum[stratum]
        req = sum(v for k, v in counter.items() if not k.startswith("_"))
        hit = counter["_matched"]
        desc = counter["_with_desc"]
        lines.append(
            f"{stratum:<12}{req:>6}{hit:>6}{pct(hit, req):>8.1f}%{desc:>9}"
            f"{pct(desc, hit):>15.1f}%{pct(desc, req):>15.1f}%"
        )
    lines.append("")

    lines.append("[description 길이 분포 (매칭+보유 건)]")
    for stratum in sorted(desc_lengths):
        values = sorted(desc_lengths[stratum])
        if not values:
            continue
        mid = values[len(values) // 2]
        lines.append(f"  {stratum:<12} n={len(values):<4} 최소={values[0]:<6} 중앙={mid:<6} 최대={values[-1]}")
    lines.append("")

    # 짧은 description 은 소개문이 아니라 플레이스홀더인 경우가 있다.
    # 예: "In Korean field only."(21자). 비어있지 않아 결측 필터를 통과하므로 별도로 센다.
    lines.append(f"[임베딩에 실제로 쓸 수 있는 description (>= {USABLE_MIN_CHARS}자)]")
    usable_header = f"{'계층':<12}{'유효요청':>9}{'보유':>6}{'사용가능':>9}{'사용가능률(요청중)':>20}"
    lines.append(usable_header)
    lines.append("-" * len(usable_header))
    for stratum in sorted(by_stratum):
        counter = by_stratum[stratum]
        req = sum(v for k, v in counter.items() if not k.startswith("_"))
        valid_req = req - counter.get("invalid_isbn", 0)
        values = desc_lengths.get(stratum, [])
        usable = sum(1 for v in values if v >= USABLE_MIN_CHARS)
        lines.append(
            f"{stratum:<12}{valid_req:>9}{len(values):>6}{usable:>9}{pct(usable, valid_req):>19.1f}%"
        )
    short = sorted(v for values in desc_lengths.values() for v in values if v < USABLE_MIN_CHARS)
    lines.append(f"  버려지는 짧은 값: {len(short)}건 {short}")
    lines.append("")

    lines.append(f"[매칭 성공 {len(matched)}건 기준 필드별 결측률]")
    for field in FIELDS:
        stat = field_stats[field]
        lines.append(f"  {field:<22} {stat['rate']:>6.2f}%  (유효 {len(matched) - stat['effective_missing']}건)")

    summary_path = DEFAULT_REPORTS / f"data_quality_summary_{args.scope}.txt"
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ---------- 필드 결측 CSV ----------
    csv_path = DEFAULT_REPORTS / f"missing_report_{args.scope}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as sink:
        writer = csv.writer(sink)
        writer.writerow([
            "field", "matched_total", "key_present_count", "effective_missing_count",
            "effective_missing_rate_percent", "valid_count", "example_valid_values",
        ])
        for field in FIELDS:
            stat = field_stats[field]
            writer.writerow([
                field, len(matched), stat["present"], stat["effective_missing"],
                stat["rate"], len(matched) - stat["effective_missing"],
                " | ".join(stat["examples"]),
            ])

    # ---------- 샘플 ----------
    picked: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        stratum = row["request"].get("stratum") or "UNKNOWN"
        key = (stratum, row["status"])
        if key in seen or len(picked) >= 8:
            continue
        seen.add(key)
        picked.append(row)

    sample_jsonl = DEFAULT_SAMPLES / "sample_volumes.jsonl"
    with sample_jsonl.open("w", encoding="utf-8") as sink:
        for row in picked:
            sink.write(json.dumps(row, ensure_ascii=False) + "\n")
    (DEFAULT_SAMPLES / "sample_volumes.pretty.json").write_text(
        json.dumps(picked, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n".join(lines))
    print("")
    print("생성: " + str(summary_path))
    print("생성: " + str(csv_path))
    print("생성: " + str(sample_jsonl))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
