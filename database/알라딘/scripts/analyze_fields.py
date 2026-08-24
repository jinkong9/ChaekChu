"""알라딘 OpenAPI 응답의 컬럼 구조 / 결측 패턴 분석.

엔드포인트별로 샘플을 모아 필드 존재율, 빈값률, 타입, 예시값을 표로 출력한다.
알라딘은 결측을 null 이 아니라 "" 또는 0 으로 채워 보내는 경우가 많아
'키 없음'과 '빈값'을 분리해서 집계한다.
"""

import json
import os
import sys
from collections import defaultdict

from aladin_cli import call

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(ROOT, "reports")
SAMPLES_DIR = os.path.join(ROOT, "samples")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# (라벨, endpoint, params) — 서로 다른 성격의 샘플을 골고루
SAMPLES = [
    ("list/Bestseller(Book)", "ItemList.aspx",
     {"QueryType": "Bestseller", "SearchTarget": "Book", "MaxResults": 50, "Cover": "Big"}),
    ("list/ItemNewAll(Book)", "ItemList.aspx",
     {"QueryType": "ItemNewAll", "SearchTarget": "Book", "MaxResults": 50, "Cover": "Big"}),
    ("search/Keyword(Book)", "ItemSearch.aspx",
     {"Query": "파이썬", "QueryType": "Keyword", "SearchTarget": "Book",
      "MaxResults": 50, "Cover": "Big"}),
    ("search/Keyword(eBook)", "ItemSearch.aspx",
     {"Query": "파이썬", "QueryType": "Keyword", "SearchTarget": "eBook",
      "MaxResults": 50, "Cover": "Big"}),
    ("search/Keyword(Foreign)", "ItemSearch.aspx",
     {"Query": "python", "QueryType": "Keyword", "SearchTarget": "Foreign",
      "MaxResults": 50, "Cover": "Big"}),
    ("list/Bestseller(eBook)", "ItemList.aspx",
     {"QueryType": "Bestseller", "SearchTarget": "eBook", "MaxResults": 50, "Cover": "Big"}),
]


def flatten(obj, prefix=""):
    """dict 를 점 표기 경로로 평탄화. list 는 [] 로 표시하고 내부는 첫 원소 기준."""
    out = {}
    for k, v in obj.items():
        path = f"{prefix}{k}"
        if isinstance(v, dict):
            if not v:
                out[path] = {}
            else:
                out.update(flatten(v, path + "."))
        elif isinstance(v, list):
            out[path + "[]"] = v
            if v and isinstance(v[0], dict):
                out.update(flatten(v[0], path + "[]."))
        else:
            out[path] = v
    return out


def is_blank(v):
    """알라딘식 결측: None / "" / 공백 / 빈 리스트·딕트 / 0(수치 결측 후보)"""
    if v is None:
        return "null"
    if isinstance(v, str):
        return "empty" if v.strip() == "" else None
    if isinstance(v, (list, dict)):
        return "empty" if len(v) == 0 else None
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0:
        return "zero"
    return None


def analyze():
    stats = defaultdict(lambda: {
        "present": 0, "null": 0, "empty": 0, "zero": 0,
        "types": set(), "examples": [], "sources": set(),
    })
    totals = {}
    envelope = {}
    raw_dump = {}

    for label, endpoint, params in SAMPLES:
        data = call(endpoint, params)
        items = data.get("item", [])
        totals[label] = len(items)
        raw_dump[label] = data
        envelope[label] = {k: v for k, v in data.items() if k != "item"}
        print(f"  {label:26s} {len(items):3d} items  (totalResults={data.get('totalResults')})")

        for it in items:
            flat = flatten(it)
            for path, v in flat.items():
                s = stats[path]
                s["present"] += 1
                s["sources"].add(label)
                s["types"].add(type(v).__name__)
                b = is_blank(v)
                if b:
                    s[b] += 1
                elif len(s["examples"]) < 3:
                    ex = json.dumps(v, ensure_ascii=False)
                    if len(ex) > 60:
                        ex = ex[:57] + "..."
                    if ex not in s["examples"]:
                        s["examples"].append(ex)

    grand = sum(totals.values())
    print(f"\n총 샘플 아이템: {grand}건 / 엔드포인트 {len(SAMPLES)}종\n")

    print("=" * 118)
    print("응답 봉투(envelope) 필드")
    print("=" * 118)
    for label, env in list(envelope.items())[:1]:
        for k, v in env.items():
            print(f"  {k:16s} = {json.dumps(v, ensure_ascii=False)[:80]}")
    print()

    hdr = (f"{'필드':32s} {'존재율':>9s} {'null':>6s} {'빈문자':>7s} "
           f"{'0값':>6s} {'타입':14s} 예시")
    print("=" * 118)
    print("아이템 필드 (존재율 = 전체 샘플 중 해당 키가 응답에 포함된 비율)")
    print("=" * 118)
    print(hdr)
    print("-" * 118)

    rows = sorted(stats.items(), key=lambda kv: (-kv[1]["present"], kv[0]))
    for path, s in rows:
        pr = s["present"] / grand * 100
        def pct(n):
            return f"{n / s['present'] * 100:4.0f}%" if s["present"] else "   -"
        types = ",".join(sorted(s["types"]))
        ex = " | ".join(s["examples"])[:44] or "—"
        print(f"{path:32s} {pr:7.1f}% {pct(s['null']):>6s} {pct(s['empty']):>7s} "
              f"{pct(s['zero']):>6s} {types:14s} {ex}")

    print("\n" + "=" * 118)
    print("엔드포인트별로만 나타나는 필드 (스키마 차이)")
    print("=" * 118)
    all_labels = set(totals)
    for path, s in rows:
        if s["sources"] != all_labels:
            missing = sorted(all_labels - s["sources"])
            print(f"  {path:32s} 없는 곳: {', '.join(missing)}")

    with open(os.path.join(REPORTS_DIR, "field_report.json"), "w", encoding="utf-8") as f:
        json.dump({
            "totals": totals,
            "fields": {p: {**{k: v for k, v in s.items() if k not in ("types", "sources")},
                           "types": sorted(s["types"]),
                           "sources": sorted(s["sources"])}
                       for p, s in stats.items()},
        }, f, ensure_ascii=False, indent=2)
    with open(os.path.join(SAMPLES_DIR, "sample_envelope.raw.json"), "w", encoding="utf-8") as f:
        json.dump(raw_dump, f, ensure_ascii=False, indent=2)
    print("\n저장: reports/field_report.json (집계), samples/sample_envelope.raw.json (원본 응답)")


if __name__ == "__main__":
    analyze()
