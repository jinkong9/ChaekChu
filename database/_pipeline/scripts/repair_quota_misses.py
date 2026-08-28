#!/usr/bin/env python3
"""쿼터 소진 구간에 기록된 가짜 '미수록' 을 걷어낸다.

사고 경위 (2026-08-28)
  정보나루 usageAnalysisList 는 일일 쿼터를 넘기면 **에러도 연결 끊김도 없이**
  빈 응답을 준다. 수집기는 그것을 "이 ISBN 은 정보나루에 없다"(ok:false)로
  기록했고, 재개 로직은 ok:false 도 '처리 완료' 로 보므로
  **다시 시도되지 않는 영구 결측**이 된다.

  실측: 29,000건 지점(= 일일 쿼터 3만)부터 확보율이 100% -> 0% 로 떨어졌다.

판별
  진짜 미수록은 흩어져서 나온다. 쿼터 차단은 **연속으로** 나온다.
  그래서 `MIN_RUN` 건 이상 연속된 ok:false 구간을 차단으로 보고 통째로 지운다.
  구간 앞뒤의 흩어진 미수록은 진짜이므로 남긴다.

  파일은 수집 순서대로 append 되므로 줄 순서가 곧 시간 순서다.

실행
    py scripts/repair_quota_misses.py --dry-run   # 무엇을 지울지만 본다
    py scripts/repair_quota_misses.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
TARGET = BASE / "data4library" / "d4l_usage.jsonl"
MIN_RUN = 50          # 이만큼 연속 미수록이면 쿼터 차단으로 본다


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=TARGET)
    parser.add_argument("--min-run", type=int, default=MIN_RUN)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    lines = args.path.read_text(encoding="utf-8", errors="replace").splitlines()
    parsed = []
    for line in lines:
        if not line.strip():
            continue
        try:
            parsed.append((line, json.loads(line)))
        except json.JSONDecodeError:
            continue

    # 연속된 ok:false 구간을 찾는다
    drop = set()
    runs = []
    start = None
    for i, (_, r) in enumerate(parsed):
        if not r.get("ok"):
            if start is None:
                start = i
        else:
            if start is not None and i - start >= args.min_run:
                runs.append((start, i))
                drop.update(range(start, i))
            start = None
    if start is not None and len(parsed) - start >= args.min_run:
        runs.append((start, len(parsed)))
        drop.update(range(start, len(parsed)))

    total = len(parsed)
    ok = sum(1 for _, r in parsed if r.get("ok"))
    scattered = total - ok - len(drop)

    print(f"검사 {total:,}행  ·  서지 확보 {ok:,}  ·  미수록 {total-ok:,}")
    print(f"\n연속 미수록 구간 {len(runs)}개 (기준 {args.min_run}건 이상 연속)")
    for a, b in runs[:5]:
        print(f"  {a:>7,} ~ {b:>7,}행   {b-a:>7,}건")
    if len(runs) > 5:
        print(f"  … 외 {len(runs)-5}개")
    print(f"\n  폐기 대상  {len(drop):>8,}건   <- 쿼터 차단으로 판정")
    print(f"  진짜 미수록 {scattered:>8,}건   <- 흩어져 있으므로 보존")
    print(f"  최종 보존  {total-len(drop):>8,}건")

    if args.dry_run:
        print("\n--dry-run — 파일을 건드리지 않았다.")
        return 0
    if not drop:
        print("\n지울 것이 없다.")
        return 0

    backup = args.path.with_suffix(".jsonl.quota_bak")
    shutil.copy2(args.path, backup)
    with args.path.open("w", encoding="utf-8") as sink:
        for i, (line, _) in enumerate(parsed):
            if i not in drop:
                sink.write(line + "\n")
    print(f"\n복구 완료. 원본 백업: {backup.name}")
    print(f"  지워진 ISBN 은 '미처리' 로 돌아가 다음 실행에서 다시 시도된다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
