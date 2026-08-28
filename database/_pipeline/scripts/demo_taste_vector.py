#!/usr/bin/env python3
"""여러 권을 고른 취향 벡터로 추천이 되는지 확인한다.

서비스의 핵심 동작이다. 온보딩에서 좋아하는 책 3~5권을 받고
그것으로 추천하는데, **여러 권을 어떻게 하나로 합칠지**가 문제다.

세 가지 합치기 방식을 같은 입력에 대해 비교한다.

  중심(centroid)   벡터를 평균낸다. 가장 흔한 방식이지만
                   취향이 흩어져 있으면 평균이 아무것도 아닌 곳에 떨어진다
  최대(max-sim)    각 취향책과의 유사도 중 최댓값을 쓴다.
                   무너지지는 않지만 이웃이 촘촘한 책 하나가 목록을 독점한다
  합산(sum)        유사도를 모두 더한다. 중심과 같은 약점을 갖는다
  교대(round-robin) 취향책마다 따로 이웃을 뽑아 번갈아 채운다.
                   **취향 하나당 최소 한 칸을 보장**하므로 독점도 붕괴도 없다

핵심 질문 — **취향이 흩어져 있을 때도 되는가.**
한 작가만 고른 사람과 소설·자기계발·역사를 섞어 고른 사람은 다르다.
후자에서 무너지면 온보딩 설계를 바꿔야 한다.

실행
    py scripts/demo_taste_vector.py
    py scripts/demo_taste_vector.py --books "아몬드" "불편한 편의점" "달러구트 꿈 백화점"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demo_recommend import build_corpus, dedupe, find, MODEL   # noqa: E402

TOP = 6

# 취향 조합. 흩어진 정도를 달리해 무너지는 지점을 본다
SCENARIOS = [
    ("한 작가에 몰린 취향",
     ["나미야 잡화점의 기적", "라플라스의 마녀", "새벽 거리에서"]),
    ("한 장르 안에서 흩어진 취향",
     ["소년이 온다", "아몬드", "불편한 편의점"]),
    ("장르를 가로지른 취향",
     ["소년이 온다", "부의 추월차선", "총, 균, 쇠"]),
    ("완전히 흩어진 취향",
     ["미드나잇 라이브러리", "수학도둑", "미움받을 용기", "그리스 로마 신화"]),
]


def combine(sims: np.ndarray, how: str) -> np.ndarray:
    """(취향책 수 x 전체책) 유사도 행렬을 하나의 점수로 접는다."""
    if how == "max":
        return sims.max(axis=0)
    return sims.sum(axis=0)


def round_robin(sims: np.ndarray, picked: set, want: int) -> list:
    """취향책마다 이웃을 따로 뽑아 번갈아 채운다.

    하나의 점수로 접지 않는 것이 요점이다. 접는 순간
    취향이 흩어지면 평균이 무너지거나(중심) 한 책이 독점한다(최대).
    번갈아 뽑으면 **취향 하나당 최소 한 칸이 보장**된다.
    """
    ranked = [list(np.argsort(-row)) for row in sims]
    cursor = [0] * len(ranked)
    out, seen = [], set(picked)
    while len(out) < want:
        moved = False
        for t, order in enumerate(ranked):
            while cursor[t] < len(order):
                j = order[cursor[t]]
                cursor[t] += 1
                if j in seen:
                    continue
                seen.add(j)
                out.append((j, t, float(sims[t][j])))
                moved = True
                break
            if len(out) >= want:
                break
        if not moved:
            break
    return out


def show(books: list, order: np.ndarray, scores: np.ndarray,
         picked: set, kdcs: set) -> tuple:
    hit_kdc = 0
    shown = 0
    for j in order:
        if j in picked:
            continue
        b = books[j]
        mark = "◎" if b["kdc"][:3] in kdcs else "○" if b["kdc"][:1] in {k[:1] for k in kdcs} else "·"
        hit_kdc += mark == "◎"
        shown += 1
        print(f"      {mark} {b['title'][:32]:<32} {b['author'][:14]:<14} {scores[j]:.3f}")
        if shown >= TOP:
            break
    return hit_kdc, shown


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--books", nargs="+", help="취향 도서 제목들")
    args = parser.parse_args()

    books = dedupe(build_corpus())
    print(f"추천 대상 {len(books):,}권\n", flush=True)

    from sentence_transformers import SentenceTransformer
    import torch
    model = SentenceTransformer(MODEL,
                                device="cuda" if torch.cuda.is_available() else "cpu")
    vectors = model.encode([b["embed_text"] for b in books], batch_size=64,
                           convert_to_numpy=True, normalize_embeddings=True,
                           show_progress_bar=False).astype(np.float32)

    scenarios = [("직접 지정", args.books)] if args.books else SCENARIOS
    summary = []

    for label, titles in scenarios:
        idx = [find(books, t) for t in titles]
        found = [(t, i) for t, i in zip(titles, idx) if i >= 0]
        if len(found) < 2:
            print(f"[{label}] 수집분에서 2권 이상 못 찾음 — 건너뜀\n")
            continue
        picked = {i for _, i in found}
        kdcs = {books[i]["kdc"][:3] for _, i in found if books[i]["kdc"]}

        print("━" * 74)
        print(f"{label}")
        for t, i in found:
            print(f"    · {books[i]['title'][:30]:<30} {books[i]['kdc_nm'][:26]}")
        # 취향책끼리 얼마나 흩어져 있는지
        qv = vectors[[i for _, i in found]]
        pair = qv @ qv.T
        n = len(found)
        spread = (pair.sum() - n) / (n * n - n)
        print(f"    취향책 상호 유사도 평균 {spread:.3f}  "
              f"(높을수록 한곳에 몰린 취향)")
        print("─" * 74)

        sims = vectors @ qv.T          # (전체책 x 취향책)
        sims = sims.T                  # (취향책 x 전체책)

        row = {"label": label, "spread": float(spread)}

        # 교대는 점수를 접지 않으므로 따로 출력한다
        rr = round_robin(sims, picked, TOP)
        print("  ▸ 교대(취향별 번갈아)")
        hit = 0
        for j, t, sc in rr:
            b = books[j]
            mark = "◎" if b["kdc"][:3] in kdcs else "○" if b["kdc"][:1] in {k[:1] for k in kdcs} else "·"
            hit += mark == "◎"
            src = books[found[t][1]]["title"][:12]
            print(f"      {mark} {b['title'][:30]:<30} {b['author'][:12]:<12} "
                  f"{sc:.3f}  <- {src}")
        row["rr"] = hit / max(len(rr), 1)
        # 취향 하나당 몇 칸을 받았는지
        share = {}
        for _, t, _ in rr:
            share[t] = share.get(t, 0) + 1
        share_text = " · ".join(f"{books[found[t][1]]['title'][:10]} {c}칸"
                                for t, c in sorted(share.items()))
        print(f"      취향별 배분: {share_text}")
        print()

        for how, name in (("centroid", "중심(평균)"), ("max", "최대"), ("sum", "합산")):
            if how == "centroid":
                centroid = qv.mean(axis=0)
                centroid /= np.linalg.norm(centroid) + 1e-9
                scores = vectors @ centroid
            else:
                scores = combine(sims, how)
            order = np.argsort(-scores)
            print(f"  ▸ {name}")
            hit, shown = show(books, order, scores, picked, kdcs)
            row[how] = hit / max(shown, 1)
            print()
        summary.append(row)

    if summary:
        print("━" * 74)
        print(f"{'취향 조합':<24}{'흩어짐':>8}{'중심':>8}{'최대':>8}{'합산':>8}{'교대':>8}")
        print("-" * 74)
        for r in summary:
            print(f"{r['label']:<24}{r['spread']:>8.3f}"
                  f"{100*r['centroid']:>7.0f}%{100*r['max']:>7.0f}%"
                  f"{100*r['sum']:>7.0f}%{100*r['rr']:>7.0f}%")
        print("\n  ※ 숫자는 추천 6건 중 취향책과 KDC 세부분류가 겹친 비율이다.")
        print("     흩어진 취향에서는 이 지표 자체가 의미가 약해지므로 목록을 함께 볼 것.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
