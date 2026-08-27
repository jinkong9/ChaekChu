#!/usr/bin/env python3
"""임베딩 텍스트 소스 비교 실험.

프로토콜: docs/pipeline/EMBEDDING_EXPERIMENT_PROTOCOL.md
**결과를 보기 전에 확정한 설계다. 이 파일의 판정 규칙을 결과에 맞춰 고치지 않는다.**

묻는 것
    정보나루 소개문 / 카카오 소개문 / 이어붙임 중 어느 쪽이 주제 신호를 잘 담는가.

재는 방법
    임베딩 입력에 제목·저자·KDC 를 넣지 않는다. 소개문 본문만 넣는다.
    그 벡터로 최근접 10건을 뽑아, **본문에 없는 KDC 를 얼마나 맞히는지** 본다.
    제목이나 KDC 를 입력에 넣으면 문자열끼리 매칭돼 점수가 부풀려진다.

실행
    py scripts/experiment_embedding_source.py
    py scripts/experiment_embedding_source.py --limit 2000   # 빠른 확인
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
D4L = BASE / "data4library" / "d4l_enriched.jsonl"
KAKAO = BASE / "kakao_enriched.jsonl"
REPORTS = Path(__file__).resolve().parent.parent / "reports"

MODEL = "jhgan/ko-sroberta-multitask"   # 프로토콜 §7 — 하나로 고정한다
MIN_CHARS = 100
TOP_K = 10
SEED = 20260827

# 실험군. 값은 (이름, 조립 함수)
ARMS = {
    "D  정보나루 단독":   lambda r: r["d4l"],
    "K  카카오 단독":     lambda r: r["kakao"],
    "D+K 이어붙임":       lambda r: r["d4l"] + " " + r["kakao"],
    "K+D 이어붙임":       lambda r: r["kakao"] + " " + r["d4l"],
    "[기준선] 제목만":    lambda r: r["title"],
}

ROLE = re.compile(r"^\s*(지은이|저자|글|엮은이|옮긴이|편저|저|글·그림|그림)\s*[:：]\s*")


def load_jsonl(path: Path) -> dict:
    rows = {}
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("ok"):
                rows[row["isbn13"]] = row
    return rows


def first_author(raw) -> str:
    """저자 문자열에서 첫 저자 이름만 뽑는다. 역할 표기와 구분자를 걷어낸다."""
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    text = ROLE.sub("", str(raw or ""))
    text = re.split(r"[;,·]| 외 ", text)[0]
    return re.sub(r"\s+", "", text)[:20]


def build_pairs(limit: int) -> list:
    d4l = load_jsonl(D4L)
    kakao = load_jsonl(KAKAO)
    print(f"정보나루 {len(d4l):,}건 · 카카오 {len(kakao):,}건", flush=True)

    pairs = []
    for isbn, dr in d4l.items():
        kr = kakao.get(isbn)
        if not kr:
            continue
        d_text = (dr.get("desc") or "").strip()
        k_text = (kr.get("contents") or "").strip()
        kdc = (dr.get("class_no") or "").strip()
        # 프로토콜 §4 — 양쪽 다 100자 이상인 책만. 한쪽만 있으면
        # 커버리지 차이가 품질 차이로 둔갑한다.
        if len(d_text) < MIN_CHARS or len(k_text) < MIN_CHARS or not kdc:
            continue
        pairs.append({
            "isbn13": isbn,
            "d4l": d_text,
            "kakao": k_text,
            "title": (dr.get("bookname") or "").strip(),
            "kdc3": re.sub(r"[^0-9]", "", kdc)[:3],
            "kdc1": re.sub(r"[^0-9]", "", kdc)[:1],
            "author": first_author(dr.get("authors")),
        })
    pairs = [p for p in pairs if len(p["kdc3"]) == 3 and p["title"]]
    random.Random(SEED).shuffle(pairs)
    return pairs[:limit] if limit else pairs


def embed(texts: list, model) -> np.ndarray:
    vectors = model.encode(texts, batch_size=64, convert_to_numpy=True,
                           normalize_embeddings=True, show_progress_bar=False)
    return vectors.astype(np.float32)


def neighbors(vectors: np.ndarray, k: int) -> np.ndarray:
    """코사인 최근접 k개(자기 제외). 정규화돼 있으므로 내적이 곧 코사인이다."""
    n = len(vectors)
    out = np.empty((n, k), dtype=np.int32)
    step = 512
    for start in range(0, n, step):
        block = vectors[start:start + step] @ vectors.T
        for row in range(len(block)):
            block[row, start + row] = -2.0        # 자기 자신 배제
        out[start:start + step] = np.argpartition(-block, k, axis=1)[:, :k]
        # argpartition 은 순서를 보장하지 않는다. 정밀도@k 는 순서와 무관하므로 그대로 쓴다
    return out


def precision_at_k(idx: np.ndarray, labels: list) -> float:
    labels = np.asarray(labels)
    hit = labels[idx] == labels[:, None]
    return float(hit.mean())


def triplet_accuracy(vectors: np.ndarray, pairs: list, trials: int = 20000) -> float:
    """같은 KDC-3 인 책이 다른 KDC-1 인 책보다 가까운가."""
    rng = random.Random(SEED)
    by3: dict = {}
    for i, p in enumerate(pairs):
        by3.setdefault(p["kdc3"], []).append(i)
    candidates = [k for k, v in by3.items() if len(v) >= 2]
    if not candidates:
        return float("nan")
    wins = total = 0
    for _ in range(trials):
        key = rng.choice(candidates)
        a, b = rng.sample(by3[key], 2)
        for _ in range(10):
            c = rng.randrange(len(pairs))
            if pairs[c]["kdc1"] != pairs[a]["kdc1"]:
                break
        else:
            continue
        total += 1
        if float(vectors[a] @ vectors[b]) > float(vectors[a] @ vectors[c]):
            wins += 1
    return wins / total if total else float("nan")


def random_baseline(labels: list, trials: int = 200000) -> float:
    """무작위로 10건 뽑았을 때 라벨이 일치할 기대 확률."""
    rng = random.Random(SEED)
    n = len(labels)
    hit = sum(1 for _ in range(trials)
              if labels[rng.randrange(n)] == labels[rng.randrange(n)])
    return hit / trials


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()

    pairs = build_pairs(args.limit)
    print(f"양쪽 다 {MIN_CHARS}자 이상 + KDC 보유 → 표본 {len(pairs):,}건\n")
    if len(pairs) < 3000:
        print(f"[경고] 프로토콜 §4 는 3,000건 미만이면 판정 보류라고 정했다.")
        print(f"       지금 {len(pairs):,}건 — 아래 수치는 참고용으로만 읽을 것.\n")
    if len(pairs) < 200:
        print("표본이 너무 적다. 카카오 수집을 더 기다릴 것.")
        return 1

    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"모델 {args.model} · device {device}", flush=True)
    model = SentenceTransformer(args.model, device=device)

    kdc3 = [p["kdc3"] for p in pairs]
    kdc1 = [p["kdc1"] for p in pairs]
    author = [p["author"] for p in pairs]

    half = len(pairs) // 2
    results = {}
    for name, compose in ARMS.items():
        texts = [compose(p) for p in pairs]
        vectors = embed(texts, model)
        idx = neighbors(vectors, TOP_K)
        # 프로토콜 §6-2 — 절반씩 따로 재서 잡음 폭을 잡는다
        idx_a = neighbors(vectors[:half], TOP_K)
        idx_b = neighbors(vectors[half:], TOP_K)
        noise = abs(precision_at_k(idx_a, kdc3[:half])
                    - precision_at_k(idx_b, kdc3[half:]))
        results[name] = {
            "kdc3": precision_at_k(idx, kdc3),
            "kdc1": precision_at_k(idx, kdc1),
            "author": precision_at_k(idx, author),
            "triplet": triplet_accuracy(vectors, pairs),
            "noise": noise,
            "chars": float(np.mean([len(t) for t in texts])),
        }
        r = results[name]
        print(f"  {name:<18} KDC3 {100*r['kdc3']:>5.1f}%  "
              f"KDC1 {100*r['kdc1']:>5.1f}%  저자 {100*r['author']:>4.1f}%  "
              f"삼중항 {100*r['triplet']:>5.1f}%  (평균 {int(r['chars'])}자)", flush=True)

    rnd3 = random_baseline(kdc3)
    rnd1 = random_baseline(kdc1)

    print("\n" + "=" * 78)
    print(f"{'군':<20}{'KDC3@10':>9}{'무작위대비':>10}{'KDC1@10':>9}"
          f"{'저자@10':>9}{'삼중항':>8}{'입력':>7}")
    print("-" * 78)
    order = sorted(results.items(), key=lambda x: -x[1]["kdc3"])
    for name, r in order:
        print(f"{name:<20}{100*r['kdc3']:>8.1f}%{r['kdc3']/rnd3:>9.1f}x"
              f"{100*r['kdc1']:>8.1f}%{100*r['author']:>8.1f}%"
              f"{100*r['triplet']:>7.1f}%{int(r['chars']):>6}자")
    print("-" * 78)
    print(f"{'[무작위]':<20}{100*rnd3:>8.1f}%{'1.0x':>9}{100*rnd1:>8.1f}%")

    # ── 프로토콜 §6 판정 ─────────────────────────────
    noise = max(r["noise"] for r in results.values())
    print(f"\n잡음 폭 (절반 분할 최대 차이): {100*noise:.2f}%p")
    best_name, best = order[0]
    tied = [n for n, r in order if best["kdc3"] - r["kdc3"] <= noise]
    print("\n=== 판정 (프로토콜 §6) ===")
    baseline_title = results["[기준선] 제목만"]["kdc3"]
    if best["kdc3"] <= baseline_title:
        print("  어느 군도 '제목만' 기준선을 넘지 못했다.")
        print("  -> 소개문 임베딩 전략 자체를 재검토해야 한다 (§6-4)")
    elif len(tied) > 1:
        print(f"  동률: {', '.join(tied)}  (차이가 잡음 폭 이내)")
        cost = ["D  정보나루 단독", "K  카카오 단독", "D+K 이어붙임", "K+D 이어붙임"]
        pick = next((c for c in cost if c in tied), tied[0])
        print(f"  -> 더 싼 쪽을 택한다 (§6-3): {pick}")
    else:
        print(f"  단독 1위: {best_name}")
        print(f"     2위 대비 +{100*(best['kdc3']-order[1][1]['kdc3']):.2f}%p "
              f"(잡음 폭 {100*noise:.2f}%p 초과)")

    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / "embedding_source_experiment.json"
    out.write_text(json.dumps({
        "model": args.model, "n": len(pairs), "top_k": TOP_K,
        "random_kdc3": rnd3, "random_kdc1": rnd1,
        "results": results,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n저장: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
