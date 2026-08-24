"""ItemLookUp + OptResult 로만 채워지는 확장 필드(subInfo) 분석."""

import json
import os
import sys
from collections import defaultdict

from aladin_cli import call
from analyze_fields import REPORTS_DIR, SAMPLES_DIR, flatten, is_blank

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

OPT = ("ratingInfo,bestSellerRank,Toc,Story,authors,fulldescription,fulldescription2,"
       "categoryIdList,packing,subbarcode,ebookList,usedList,reviewList,phraseList,"
       "mdrecommend,eventList,cardReviewImgList,previewImgList,b2bSupply,c2binfo")

# 성격이 다른 표본: 베스트셀러 소설 / 실용서 / 번역 고전 / 전자책 있는 책 / 외서 / 절판 가능
ISBNS = [
    ("9791199489561", "베스트1위 인문"),
    ("9791141618575", "신간 에세이"),
    ("9788936439996", "한국소설"),
    ("9788966262038", "IT 실용서(클린코드)"),
    ("9788937460449", "민음사 세계문학"),
    ("9791162245651", "IT 실용서2"),
    ("9780134685991", "외서(Effective Java)"),
    ("9788954682152", "문학"),
]


def main():
    stats = defaultdict(lambda: {"present": 0, "null": 0, "empty": 0, "zero": 0,
                                 "types": set(), "examples": []})
    ok, dumps = 0, {}

    for isbn, note in ISBNS:
        try:
            data = call("ItemLookUp.aspx", {
                "ItemId": isbn, "ItemIdType": "ISBN13",
                "Cover": "Big", "OptResult": OPT,
            })
        except SystemExit as e:
            print(f"  {isbn} ({note}) -> 실패: {e}")
            continue
        items = data.get("item", [])
        if not items:
            print(f"  {isbn} ({note}) -> 결과 0건 (미등록/절판 ISBN)")
            continue
        ok += 1
        dumps[f"{isbn} {note}"] = data
        it = items[0]
        print(f"  {isbn} ({note}) -> {it.get('title', '')[:40]}  "
              f"subInfo키 {len(it.get('subInfo') or {})}개")
        for path, v in flatten(it).items():
            s = stats[path]
            s["present"] += 1
            s["types"].add(type(v).__name__)
            b = is_blank(v)
            if b:
                s[b] += 1
            elif len(s["examples"]) < 2:
                ex = json.dumps(v, ensure_ascii=False)
                s["examples"].append(ex[:57] + "..." if len(ex) > 60 else ex)

    print(f"\n조회 성공 {ok}/{len(ISBNS)}건\n")
    print("=" * 112)
    print("ItemLookUp 확장 필드 (subInfo.* 중심)")
    print("=" * 112)
    print(f"{'필드':44s} {'존재':>5s} {'null':>5s} {'빈값':>5s} {'0값':>5s} {'타입':10s} 예시")
    print("-" * 112)
    for path, s in sorted(stats.items(), key=lambda kv: (not kv[0].startswith("subInfo"),
                                                        -kv[1]["present"], kv[0])):
        def pct(n):
            return f"{n / s['present'] * 100:3.0f}%"
        ex = " | ".join(s["examples"])[:32] or "—"
        print(f"{path:44s} {s['present']:3d}/{ok:<2d} {pct(s['null']):>5s} "
              f"{pct(s['empty']):>5s} {pct(s['zero']):>5s} "
              f"{','.join(sorted(s['types'])):10s} {ex}")

    with open(os.path.join(SAMPLES_DIR, "sample_lookup.raw.json"), "w", encoding="utf-8") as f:
        json.dump(dumps, f, ensure_ascii=False, indent=2)
    print("\n저장: samples/sample_lookup.raw.json")


if __name__ == "__main__":
    main()
