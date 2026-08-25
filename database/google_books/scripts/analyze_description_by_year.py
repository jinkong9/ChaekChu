#!/usr/bin/env python3
"""수확한 한국어 도서의 description 보유율을 발간연도별로 분석한다.

출발 질문: 최신 발간 도서와 과거 발간 도서의 책소개 결측률이 다른가.
실측 답: 다르다. 그러나 원인은 발간연도가 아니라 **레코드 출처**다.

Google Books에는 성격이 다른 두 종류의 레코드가 섞여 있다.

  파트너 레코드  출판사가 직접 등록. publisher/categories/description 이 함께 채워진다.
  스캔 레코드    도서관 장서 스캔. 서지 최소값만 있고 소개문이 거의 없다.

`publisher` 필드 유무가 이 둘을 가르는 대리 지표다. 연도를 통제하면
스캔 레코드의 보유율은 모든 연대에서 1~3% 로 평평하고,
파트너 레코드만 연도에 따라 오른다. 즉 연도 상관은 교란이다.

방법론 주의 — 쿼리 축에 따라 결과가 달라진다.
  publisher 축(`inpublisher:`)은 **publisher 필드가 있는 레코드만 매칭**한다.
  곧 파트너 레코드만 골라내므로 보유율이 구조적으로 과대평가된다.
  따라서 대표값은 subject 축 기준으로 읽어야 한다.

해석 주의 — 이 수치는 Google Books 색인 포함을 조건으로 한 값이다.
무조건부 확보율은 (매칭률 x 이 보유율) 에 가깝다.

실행:
    py scripts/analyze_description_by_year.py
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "raw" / f"ko_harvest_raw_{date.today():%Y%m%d}.jsonl"
DEFAULT_REPORTS = ROOT / "reports"

USABLE_MIN_CHARS = 100
MIN_YEAR = 1960
MAX_YEAR = 2030
MIN_N = 30            # 이 미만 구간은 비율을 신뢰하지 않는다
REPRESENTATIVE_AXIS = "subject"

BUCKETS = [
    ("~1999", 0, 1999),
    ("2000-04", 2000, 2004),
    ("2005-09", 2005, 2009),
    ("2010-14", 2010, 2014),
    ("2015-19", 2015, 2019),
    ("2020-24", 2020, 2024),
    ("2025-", 2025, 9999),
]

# DATA_SOURCE_STRATEGY.md 6.1 [실측] — 국중 2,047,239건의 발간연도 분포.
NL_DISTRIBUTION = {
    "~1999": 5.6, "2000-04": 7.6, "2005-09": 14.3, "2010-14": 17.2,
    "2015-19": 21.5, "2020-24": 26.2, "2025-": 7.6,
}


def wilson(hits: int, total: int) -> tuple[float, float]:
    """비율의 95% 윌슨 신뢰구간."""
    if total == 0:
        return (0.0, 0.0)
    z = 1.96
    phat = hits / total
    denom = 1 + z * z / total
    centre = (phat + z * z / (2 * total)) / denom
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total) / denom
    return (max(0.0, (centre - margin) * 100), min(100.0, (centre + margin) * 100))


def bucket_of(year: int) -> str | None:
    for label, low, high in BUCKETS:
        if low <= year <= high:
            return label
    return None


def rate(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 2) if whole else 0.0


def show(part: int, whole: int) -> str:
    return f"{rate(part, whole):.1f}%" if whole >= MIN_N else f"(n={whole})"


def usable(row: dict[str, Any]) -> bool:
    return (row.get("description_length") or 0) >= USABLE_MIN_CHARS


def is_partner(row: dict[str, Any]) -> bool:
    """출판사가 직접 등록한 레코드인지의 대리 지표."""
    return bool(row.get("publisher"))


def load(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--scope", default="ko_harvest_by_year")
    args = parser.parse_args()

    raw_rows = load(args.input)
    DEFAULT_REPORTS.mkdir(parents=True, exist_ok=True)

    korean = [r for r in raw_rows if r.get("language") == "ko"]
    rows: list[dict[str, Any]] = []
    dropped = 0
    for row in korean:
        year_text = (row.get("publishedYear") or "").strip()
        if not year_text.isdigit() or not (MIN_YEAR <= int(year_text) <= MAX_YEAR):
            dropped += 1
            continue
        row["_year"] = int(year_text)
        row["_bucket"] = bucket_of(row["_year"])
        rows.append(row)

    subject = [r for r in rows if r.get("query_axis") == REPRESENTATIVE_AXIS]
    publisher_axis = [r for r in rows if r.get("query_axis") == "publisher"]

    out: list[str] = []
    add = out.append
    add("Google Books 한국어 도서 — 발간연도별 description 보유율")
    add("=" * 92)
    add(f"생성 시각(UTC): {datetime.now(timezone.utc).isoformat()}")
    add(f"입력 파일: {args.input}")
    add(f"수확 총 volume: {len(raw_rows)}")
    add(f"  한국어(language=ko): {len(korean)}")
    add(f"  연도 유효({MIN_YEAR}~{MAX_YEAR}): {len(rows)}  (제외 {dropped}건)")
    add(f"  대표 표본 = subject 축: {len(subject)}건")
    add(f"  참고 표본 = publisher 축: {len(publisher_axis)}건")
    add(f"사용가능 기준: description >= {USABLE_MIN_CHARS}자")
    add("")
    add("해석 주의")
    add("  1. 이 보유율은 Google Books 색인 포함을 조건으로 한 값이다. 무조건부 확보율이 아니다.")
    add("  2. publisher 축(`inpublisher:`)은 publisher 필드가 있는 레코드만 매칭하므로")
    add("     파트너 레코드만 골라내 보유율을 과대평가한다. 대표값은 subject 축이다.")
    add("")

    # ---------- 1. 대표 표본의 연도별 보유율 ----------
    add("[1] 발간연도별 사용가능 description 보유율 (subject 축, 대표값)")
    header = f"{'구간':<10}{'표본n':>7}{'사용가능':>9}{'보유율':>9}{'95% CI':>19}{'중앙길이':>10}"
    add(header)
    add("-" * len(header))
    for label, low, high in BUCKETS:
        group = [r for r in subject if low <= r["_year"] <= high]
        if not group:
            continue
        hits = [r for r in group if usable(r)]
        lo, hi = wilson(len(hits), len(group))
        lengths = sorted(r["description_length"] for r in hits)
        median = lengths[len(lengths) // 2] if lengths else 0
        flag = "  (n<30 참고용)" if len(group) < MIN_N else ""
        add(f"{label:<10}{len(group):>7}{len(hits):>9}{rate(len(hits), len(group)):>8.1f}%"
            f"{lo:>10.1f}~{hi:<8.1f}{median:>10}{flag}")
    add("")

    # ---------- 2. 축 비교로 편향 크기 보이기 ----------
    add("[2] 쿼리 축별 비교 — publisher 축의 과대평가 크기")
    axis_header = f"{'구간':<10}{'subject축':>12}{'publisher축':>14}{'과대평가(%p)':>15}"
    add(axis_header)
    add("-" * len(axis_header))
    for label, low, high in BUCKETS:
        s_group = [r for r in subject if low <= r["_year"] <= high]
        p_group = [r for r in publisher_axis if low <= r["_year"] <= high]
        if len(s_group) < MIN_N or len(p_group) < MIN_N:
            continue
        s_rate = rate(sum(1 for r in s_group if usable(r)), len(s_group))
        p_rate = rate(sum(1 for r in p_group if usable(r)), len(p_group))
        add(f"{label:<10}{s_rate:>11.1f}%{p_rate:>13.1f}%{p_rate - s_rate:>+14.1f}")
    add("")

    # ---------- 3. 진짜 원인: 레코드 출처 ----------
    add("[3] 연도를 통제한 교차표 — 파트너 레코드 vs 스캔 레코드 (subject 축)")
    add("    파트너 = publisher 필드 있음(출판사 직접 등록) / 스캔 = 없음(도서관 스캔본)")
    cross_header = (f"{'구간':<10}{'파트너n':>9}{'파트너보유율':>14}"
                    f"{'스캔n':>8}{'스캔보유율':>13}")
    add(cross_header)
    add("-" * len(cross_header))
    for label, low, high in BUCKETS:
        group = [r for r in subject if low <= r["_year"] <= high]
        if not group:
            continue
        partner = [r for r in group if is_partner(r)]
        scanned = [r for r in group if not is_partner(r)]
        add(f"{label:<10}{len(partner):>9}"
            f"{show(sum(1 for r in partner if usable(r)), len(partner)):>14}"
            f"{len(scanned):>8}"
            f"{show(sum(1 for r in scanned if usable(r)), len(scanned)):>13}")
    partner_all = [r for r in subject if is_partner(r)]
    scanned_all = [r for r in subject if not is_partner(r)]
    add("-" * len(cross_header))
    add(f"{'전체':<10}{len(partner_all):>9}"
        f"{show(sum(1 for r in partner_all if usable(r)), len(partner_all)):>14}"
        f"{len(scanned_all):>8}"
        f"{show(sum(1 for r in scanned_all if usable(r)), len(scanned_all)):>13}")
    add("")
    add("    스캔 레코드는 모든 연대에서 1~3%로 평평하다. 연도 효과가 없다.")
    add("    파트너 레코드만 연도에 따라 오른다. 곧 연도 상관은 교란이다.")
    add("")

    # ---------- 4. 표본 대표성 ----------
    add("[4] 표본의 시대 구성 vs 국립중앙도서관 실측 분포")
    comp_header = f"{'구간':<10}{'표본비중':>10}{'국중실측':>10}{'차이(%p)':>11}"
    add(comp_header)
    add("-" * len(comp_header))
    for label, low, high in BUCKETS:
        group = [r for r in subject if low <= r["_year"] <= high]
        ours = rate(len(group), len(subject))
        theirs = NL_DISTRIBUTION.get(label, 0.0)
        add(f"{label:<10}{ours:>9.1f}%{theirs:>9.1f}%{ours - theirs:>+10.1f}")
    add("")
    add("    subject 축은 옛날 책을 과대 표집한다(스캔본이 검색에 많이 걸리기 때문).")
    add("    따라서 단순 평균은 국중 카탈로그 기준 보유율을 과소평가한다.")
    add("")

    # ---------- 4-1. 국중 연대 구성으로 사후층화 가중 ----------
    add("[4-1] 국중 연대 구성으로 재가중한 추정 보유율 (사후층화)")
    weighted = 0.0
    covered = 0.0
    for label, low, high in BUCKETS:
        group = [r for r in subject if low <= r["_year"] <= high]
        if not group:
            continue
        share = NL_DISTRIBUTION.get(label, 0.0) / 100.0
        bucket_rate = rate(sum(1 for r in group if usable(r)), len(group))
        weighted += share * bucket_rate
        covered += share
        add(f"    {label:<10} 국중비중 {share * 100:>5.1f}% x 보유율 {bucket_rate:>5.1f}%"
            f"  = 기여 {share * bucket_rate:>5.2f}%p")
    if covered:
        weighted = weighted / covered
    add(f"    재가중 추정 보유율(색인 포함 조건부): {weighted:.1f}%")
    add("")

    # ---------- 5. 결론 ----------
    valid = [(label, [r for r in subject if low <= r["_year"] <= high])
             for label, low, high in BUCKETS]
    valid = [(label, group) for label, group in valid if len(group) >= MIN_N]
    add("[5] 결론")
    if valid:
        scored = [(label, rate(sum(1 for r in g if usable(r)), len(g)), len(g))
                  for label, g in valid]
        best = max(scored, key=lambda x: x[1])
        worst = min(scored, key=lambda x: x[1])
        add(f"  최고 구간: {best[0]} {best[1]:.1f}% (n={best[2]})")
        add(f"  최저 구간: {worst[0]} {worst[1]:.1f}% (n={worst[2]})")
        if worst[1]:
            add(f"  격차: {best[1] - worst[1]:.1f}%p / 배율 {best[1] / worst[1]:.1f}배")
    p_rate = rate(sum(1 for r in partner_all if usable(r)), len(partner_all))
    s_rate = rate(sum(1 for r in scanned_all if usable(r)), len(scanned_all))
    add(f"  파트너 레코드 전체 {p_rate:.1f}% vs 스캔 레코드 전체 {s_rate:.1f}%")
    add("  -> 발간연도는 대리 변수이고, 실제 결정 요인은 레코드 출처다.")

    summary_path = DEFAULT_REPORTS / f"data_quality_summary_{args.scope}.txt"
    summary_path.write_text("\n".join(out) + "\n", encoding="utf-8")

    # ---------- CSV ----------
    csv_path = DEFAULT_REPORTS / f"missing_report_{args.scope}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as sink:
        writer = csv.writer(sink)
        writer.writerow([
            "bucket", "axis", "sample_n", "with_usable_description",
            "usable_rate_percent", "ci95_low", "ci95_high",
            "partner_n", "partner_usable_rate_percent",
            "scanned_n", "scanned_usable_rate_percent",
            "sample_share_percent", "nl_actual_share_percent",
        ])
        for label, low, high in BUCKETS:
            group = [r for r in subject if low <= r["_year"] <= high]
            if not group:
                continue
            hits = sum(1 for r in group if usable(r))
            lo, hi = wilson(hits, len(group))
            partner = [r for r in group if is_partner(r)]
            scanned = [r for r in group if not is_partner(r)]
            writer.writerow([
                label, REPRESENTATIVE_AXIS, len(group), hits,
                rate(hits, len(group)), round(lo, 2), round(hi, 2),
                len(partner), rate(sum(1 for r in partner if usable(r)), len(partner)),
                len(scanned), rate(sum(1 for r in scanned if usable(r)), len(scanned)),
                rate(len(group), len(subject)), NL_DISTRIBUTION.get(label, ""),
            ])

    print("\n".join(out))
    print("")
    print("생성: " + str(summary_path))
    print("생성: " + str(csv_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
