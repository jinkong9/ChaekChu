#!/usr/bin/env python3
"""정보나루 키워드가 임베딩 신호로 값어치가 있는가.

앞선 확인에서 키워드는 **태그 UI 로는 못 쓴다**고 판정했다.
최빈어가 `사람` `아이들` `시리즈` `세계` 같은 불용어급이기 때문이다.

그러나 그것은 **사용자에게 보여줄 라벨**로서의 판정이고,
**임베딩 입력**으로서의 값어치는 별개다. 키워드에는 소개문에 없는
등장인물·설정·소재가 섞여 있다 (`영혜` `몽고반점` `욕망` `육식`).
소개문 145자가 놓친 것을 키워드가 메울 수 있다.

두 가지를 잰다.
  1. 주제 판별력  — KDC 세부분류 정밀도@10 (앞선 실험과 같은 지표)
  2. 실제 추천    — 같은 책에 대해 키워드 유무로 결과가 어떻게 달라지는가

실험군
  D        소개문만
  KW       키워드만
  D+KW     소개문 + 키워드
  D+KW(w)  키워드를 가중치 순 상위 20개만

실행
    py scripts/experiment_keyword_signal.py
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
SRC = BASE / "data4library" / "d4l_usage.jsonl"
MODEL = "jhgan/ko-sroberta-multitask"
MIN_CHARS = 100
TOP_K = 10
SEED = 20260828

ARMS = {
    "D      소개문만":         lambda r: r["desc"],
    "KW     키워드 원본":       lambda r: " ".join(r["kw"]),
    "KW-    서지어 제거":       lambda r: " ".join(r["kw_clean"]),
    "D+KW   소개문+원본":       lambda r: r["desc"] + " " + " ".join(r["kw"]),
    "D+KW-  소개문+정제":       lambda r: r["desc"] + " " + " ".join(r["kw_clean"]),
}


def strip_bibliographic(kws: list, title: str, author: str, publisher: str) -> list:
    """키워드에서 제목·저자·출판사와 겹치는 것을 걷어낸다.

    실측: 출판사명이 75.3%, 자기 제목이 86.1%, 저자명이 89.9% 의 책에서
    키워드에 들어 있다. 출판사는 분야가 편중돼 있어(비룡소=아동, 창비=문학)
    그대로 두면 **같은 출판사끼리 뭉치고 그것이 KDC 정밀도를 부풀린다.**
    주제를 맞힌 것이 아니라 출판사를 맞힌 것이 된다.
    """
    def norm(s: str) -> str:
        return re.sub(r"[^가-힣A-Za-z0-9]", "", s or "")

    banned = [norm(x) for x in (title, author, publisher) if norm(x)]
    out = []
    for word in kws:
        w = norm(word)
        if len(w) < 2:
            continue
        if any(w in b or b in w for b in banned):
            continue
        out.append(word)
    return out


def load() -> list:
    rows = []
    for line in SRC.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok"):
            continue
        desc = (r.get("desc") or "").strip()
        kws = [w for w, _ in (r.get("keywords") or []) if w]
        kdc = re.sub(r"[^0-9]", "", r.get("class_no") or "")
        if len(desc) < MIN_CHARS or len(kws) < 10 or len(kdc) < 3:
            continue
        title = re.sub(r"\s*:\s*.*$", "", r.get("bookname") or "").strip()
        author = re.sub(r"^\s*(지은이|저자|글)\s*[:：]\s*", "",
                        r.get("authors") or "").strip()
        clean = strip_bibliographic(kws, title, author, r.get("publisher") or "")
        if len(clean) < 8:
            continue
        rows.append({
            "isbn13": r["isbn13"],
            "title": (r.get("bookname") or "").strip(),
            "desc": desc,
            "kw": kws,
            "kw_clean": clean,
            "kdc3": kdc[:3],
            "kdc1": kdc[:1],
        })
    random.Random(SEED).shuffle(rows)
    return rows


def neighbors(vectors: np.ndarray, k: int) -> np.ndarray:
    n = len(vectors)
    out = np.empty((n, k), dtype=np.int32)
    for start in range(0, n, 512):
        block = vectors[start:start + 512] @ vectors.T
        for row in range(len(block)):
            block[row, start + row] = -2.0
        out[start:start + 512] = np.argpartition(-block, k, axis=1)[:, :k]
    return out


def precision(idx: np.ndarray, labels: list) -> float:
    labels = np.asarray(labels)
    return float((labels[idx] == labels[:, None]).mean())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--show", default="미드나잇 라이브러리",
                        help="추천 결과를 눈으로 볼 질의 도서")
    args = parser.parse_args()

    rows = load()
    print(f"표본 {len(rows):,}권 (소개문 100자+ · 키워드 10개+ · KDC 보유)")
    if len(rows) < 1000:
        print("  [주의] 표본이 작다. 수집이 더 진행된 뒤 다시 볼 것.")
    print(f"  키워드 개수 중앙 {int(np.median([len(r['kw']) for r in rows]))}개\n", flush=True)

    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(MODEL, device=device)
    print(f"모델 {MODEL} · {device}\n", flush=True)

    kdc3 = [r["kdc3"] for r in rows]
    kdc1 = [r["kdc1"] for r in rows]
    half = len(rows) // 2
    results, vecs = {}, {}

    for name, compose in ARMS.items():
        texts = [compose(r) for r in rows]
        v = model.encode(texts, batch_size=64, convert_to_numpy=True,
                         normalize_embeddings=True,
                         show_progress_bar=False).astype(np.float32)
        vecs[name] = v
        idx = neighbors(v, TOP_K)
        noise = abs(precision(neighbors(v[:half], TOP_K), kdc3[:half])
                    - precision(neighbors(v[half:], TOP_K), kdc3[half:]))
        results[name] = {"kdc3": precision(idx, kdc3),
                         "kdc1": precision(idx, kdc1),
                         "noise": noise,
                         "chars": float(np.mean([len(t) for t in texts]))}
        r = results[name]
        print(f"  {name:<22} KDC3 {100*r['kdc3']:>5.1f}%  "
              f"KDC1 {100*r['kdc1']:>5.1f}%  (평균 {int(r['chars'])}자)", flush=True)

    print("\n" + "=" * 66)
    order = sorted(results.items(), key=lambda x: -x[1]["kdc3"])
    print(f"{'군':<24}{'KDC3@10':>10}{'KDC1@10':>10}{'입력':>9}")
    print("-" * 66)
    for name, r in order:
        print(f"{name:<24}{100*r['kdc3']:>9.1f}%{100*r['kdc1']:>9.1f}%{int(r['chars']):>8}자")
    noise = max(r["noise"] for r in results.values())
    best, second = order[0], order[1]
    print(f"\n잡음 폭 {100*noise:.2f}%p")
    gain = best[1]["kdc3"] - results["D      소개문만"]["kdc3"]
    print(f"소개문 단독 대비 최고 군의 순증 {100*gain:+.2f}%p", end="  ")
    print("(잡음 폭 초과 — 유의)" if abs(gain) > noise else "(잡음 폭 이내 — 동률)")

    # ── 실제 추천 비교 ───────────────────────────
    key = re.sub(r"\s+", "", args.show)
    hit = [i for i, r in enumerate(rows)
           if key in re.sub(r"\s+", "", r["title"])]
    if hit:
        q = hit[0]
        print(f"\n=== 같은 책의 추천 비교: {rows[q]['title'][:34]} ===")
        print(f"    키워드: {', '.join(rows[q]['kw'][:14])}")
        for name in ARMS:
            v = vecs[name]
            s = v @ v[q]
            s[q] = -2.0
            top = np.argsort(-s)[:5]
            print(f"\n  ▸ {name}")
            for j in top:
                mark = "◎" if rows[j]["kdc3"] == rows[q]["kdc3"] else "·"
                print(f"      {mark} {rows[j]['title'][:34]:<34} {s[j]:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
