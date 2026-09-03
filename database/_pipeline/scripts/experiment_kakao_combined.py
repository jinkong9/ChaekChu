#!/usr/bin/env python3
"""카카오 소개문을 정보나루 소개문에 **덧붙이면** 추천이 나아지는가.

왜 다시 재는가
  결정 문서(RECOMMENDATION_DATA_DECISIONS.md 결정 5)는 카카오를
  **"잔여분 전용"** — 정보나루가 못 채운 구간에만 — 으로 못박아 두었다.
  그 근거는 층화 파일럿(2026-08-27)의 **커버리지** 측정이다.
    정보나루 단독 70.7% · 카카오 단독 50.2% · 합집합 73.4%
    정보나루는 카카오 위에 +23.1%p, 카카오는 정보나루 위에 +2.7%p

  그런데 하루 뒤(08-28) 임베딩 실험은 다른 답을 냈다.
    정보나루+카카오 56.8% > 카카오 54.2% > 정보나루 53.0%   (KDC 적중률)

  **두 질문이 섞여 있었다.** "결측을 누가 메우나"(정보나루)와
  "임베딩 입력으로 뭐가 좋나"(둘 다 이어붙인 것)는 다른 질문이다.
  "잔여분 전용"이면 정보나루가 채운 책은 카카오 텍스트를 영영 못 받는다.

  다만 조합 우위는 **KDC 적중률(보조 지표)에서만** 나왔다.
  주 지표인 **함께대출 일치도**에는 조합 실험군이 아예 없었다.
  카카오를 1단계 밴드 전량에 돌리면 약 5.6일이 든다. 태우기 전에 잰다.

지표
  주   함께대출 일치도 — 정답을 분류표가 아니라 **실제 이용자 행동**에서 가져온다.
       정보나루 usageAnalysisList 의 coLoanBooks · maniaRecBooks · readerRecBooks.
  보조 KDC 세부분류 적중률 — 표현이 주제를 인코딩했는지 보는 바닥 검사.

실험군 7개
  D-only   정보나루 소개문만
  K-only   카카오 소개문만
  D+K      정보나루 -> 카카오 (조합, 이 실험의 주인공)
  KW       키워드만            (지난 실험 단독 1위)
  T+D      제목 + 정보나루
  T+D+K    제목 + 정보나루 + 카카오
  T+D+K+KW 제목 + 정보나루 + 카카오 + 키워드

판정 규칙 (결과를 보기 전에 정한다)
  1. 표본을 절반으로 갈라 각각 재고, 그 차이를 **잡음 폭**으로 삼는다.
  2. D+K 가 D-only 를 잡음 폭보다 크게 이겨야 "조합이 낫다" 고 한다.
  3. 주 지표와 보조 지표가 엇갈리면 **주 지표를 따른다.**
  4. 모델은 하나만 쓴다. 여러 개 돌려 좋은 것을 고르면 실험이 아니다.

실행
    py scripts/experiment_kakao_combined.py
    py scripts/experiment_kakao_combined.py --max 30000
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from pathlib import Path

import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
# 로컬 정본. EC2 가 더 최신이므로 실험 전에 회수해 덮어쓴다.
D4L_CANDIDATES = [BASE / "data4library" / "d4l_usage.jsonl"]
KAKAO = BASE / "kakao_enriched.jsonl"
MODEL = "jhgan/ko-sroberta-multitask"
TOP_K = 10
SEED = 20260903
MIN_CHARS = 60          # 이보다 짧은 소개문은 신호가 없다


def newest_d4l() -> Path:
    for p in D4L_CANDIDATES:
        if p.exists():
            return p
    raise SystemExit("정보나루 수집 파일을 찾지 못했다")


def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    return text


def load_d4l(path: Path) -> dict:
    """isbn13 -> {desc, kw, kdc, title, coloan(set)}"""
    out = {}
    for line in path.open(encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok"):
            continue
        isbn = r.get("isbn13")
        if not isbn:
            continue
        # 정답: 실제 함께 빌린 책 + 마니아/다독자 추천
        truth = set()
        for field in ("co_loan", "mania_rec", "reader_rec"):
            for item in (r.get(field) or []):
                if isinstance(item, (list, tuple)) and item and item[0]:
                    truth.add(str(item[0]))
        kdc = re.sub(r"[^0-9]", "", r.get("class_no") or "")
        out[isbn] = {
            "desc": clean(r.get("desc")),
            "kw": [w for w, _ in (r.get("keywords") or []) if w],
            "kdc3": kdc[:3] if len(kdc) >= 3 else "",
            "title": clean(re.sub(r"\s*:\s*.*$", "", r.get("bookname") or "")),
            "truth": truth,
        }
    return out


def load_kakao(path: Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for line in path.open(encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok"):
            continue
        isbn = r.get("isbn13")
        text = clean(r.get("contents") or r.get("desc"))
        if isbn and text:
            out[isbn] = text
    return out


ARMS = {
    "D-only    정보나루":        lambda r: r["desc"],
    "K-only    카카오":          lambda r: r["kakao"],
    "D+K       정보나루+카카오":  lambda r: r["desc"] + " " + r["kakao"],
    "KW        키워드":          lambda r: " ".join(r["kw"]),
    "T+D       제목+정보나루":    lambda r: r["title"] + ". " + r["desc"],
    "T+D+K     제목+둘 다":       lambda r: r["title"] + ". " + r["desc"] + " " + r["kakao"],
    "T+D+K+KW  전부":            lambda r: (r["title"] + ". " + r["desc"] + " "
                                            + r["kakao"] + " " + " ".join(r["kw"][:30])),
}


def neighbors(vectors: np.ndarray, k: int) -> np.ndarray:
    n = len(vectors)
    out = np.empty((n, k), dtype=np.int32)
    step = 512
    for start in range(0, n, step):
        block = vectors[start:start + step] @ vectors.T
        for row in range(len(block)):
            block[row, start + row] = -2.0
        idx = np.argpartition(-block, k, axis=1)[:, :k]
        order = np.take_along_axis(block, idx, 1).argsort(axis=1)[:, ::-1]
        out[start:start + step] = np.take_along_axis(idx, order, 1)
    return out


def coloan_hit(idx: np.ndarray, rows: list, k: int) -> float:
    """상위 k 개 중 실제 함께대출 정답에 든 비율."""
    hit = total = 0
    for i, row in enumerate(rows):
        truth = row["truth_in"]
        if not truth:
            continue
        picks = idx[i][:k]
        hit += sum(1 for j in picks if rows[j]["isbn13"] in truth)
        total += k
    return hit / total if total else 0.0


def kdc_hit(idx: np.ndarray, rows: list, k: int) -> float:
    hit = total = 0
    for i, row in enumerate(rows):
        if not row["kdc3"]:
            continue
        for j in idx[i][:k]:
            if rows[j]["kdc3"]:
                total += 1
                hit += rows[j]["kdc3"] == row["kdc3"]
    return hit / total if total else 0.0


def measure(vectors: np.ndarray, rows: list) -> dict:
    idx = neighbors(vectors, TOP_K)
    return {
        "co5": coloan_hit(idx, rows, 5),
        "co10": coloan_hit(idx, rows, TOP_K),
        "kdc": kdc_hit(idx, rows, TOP_K),
    }


def encode(model, texts: list, seq_len: int) -> np.ndarray:
    """정해진 입력 창으로 인코딩한다.

    **이 모델의 기본 max_seq_length 는 128 토큰이다.**
    실측: 한국어 155자 -> 75토큰, 235자 -> 114토큰,
          391자 -> 186토큰(잘림), 533자 -> 206토큰(잘림).
    즉 정보나루+카카오를 이어붙이면 **카카오 쪽이 잘려 나간다.**
    앞선 실험에서 T+D+K 와 T+D+K+KW 의 수치가 소수점까지 같았던 것이
    그 증거였다 — 뒤에 붙인 키워드가 통째로 버려졌다.
    """
    model.max_seq_length = seq_len
    return model.encode(texts, batch_size=64, convert_to_numpy=True,
                        normalize_embeddings=True,
                        show_progress_bar=False).astype(np.float32)


def encode_mean(model, parts: list, seq_len: int) -> np.ndarray:
    """소스별로 따로 인코딩해 평균낸다 (절단 없이 둘을 공평하게 반영).

    parts 는 [[소스1 텍스트, 소스2 텍스트], ...] 형태다.
    """
    n_src = len(parts[0])
    stacks = []
    for s in range(n_src):
        stacks.append(encode(model, [p[s] for p in parts], seq_len))
    vec = np.mean(stacks, axis=0)
    norm = np.linalg.norm(vec, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    return (vec / norm).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max", type=int, default=0, help="표본 상한 (0=전부)")
    args = parser.parse_args()

    src = newest_d4l()
    print(f"정보나루 {src.name}")
    d4l = load_d4l(src)
    kak = load_kakao(KAKAO)
    print(f"  정보나루 {len(d4l):,}권 · 카카오 {len(kak):,}권")

    rows = []
    for isbn, r in d4l.items():
        k = kak.get(isbn, "")
        if len(r["desc"]) < MIN_CHARS or len(k) < MIN_CHARS:
            continue
        if not r["kw"] or not r["title"]:
            continue
        rows.append({"isbn13": isbn, "kakao": k, **r})
    random.Random(SEED).shuffle(rows)
    if args.max:
        rows = rows[:args.max]

    have = {r["isbn13"] for r in rows}
    for r in rows:
        r["truth_in"] = r["truth"] & have      # 표본 안에 있는 정답만 맞힐 수 있다
    scored = sum(1 for r in rows if r["truth_in"])
    truth_total = sum(len(r["truth"]) for r in rows)
    truth_in = sum(len(r["truth_in"]) for r in rows)

    print(f"\n표본 {len(rows):,}권 "
          f"(양쪽 소개문 {MIN_CHARS}자 이상 · 키워드·제목 보유)")
    print(f"  채점 대상 {scored:,}권 · 정답 {truth_in:,}/{truth_total:,}건 "
          f"({100*truth_in/truth_total:.1f}% 가 표본 안에 있다)")
    print(f"  정보나루 중앙 {int(np.median([len(r['desc']) for r in rows]))}자 · "
          f"카카오 중앙 {int(np.median([len(r['kakao']) for r in rows]))}자")
    if len(rows) < 5000:
        print("  [주의] 표본이 작다. 수집이 더 진행된 뒤 다시 볼 것.")

    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(MODEL, device=device)
    print(f"\n모델 {MODEL} · {device}\n", flush=True)

    half = len(rows) // 2
    results = {}

    def record(name: str, vec: np.ndarray, chars: float) -> None:
        full = measure(vec, rows)
        # 반쪽씩 재서 잡음 폭을 구한다
        a = measure(vec[:half], rows[:half])
        b = measure(vec[half:], rows[half:])
        full["noise"] = abs(a["co10"] - b["co10"])
        full["chars"] = chars
        results[name] = full
        print(f"  {name:<28} 적중@10 {100*full['co10']:>5.2f}%  "
              f"@5 {100*full['co5']:>5.2f}%  KDC {100*full['kdc']:>5.1f}%  "
              f"({int(chars)}자)", flush=True)

    print(f"기본 창 {model.max_seq_length} 토큰\n")

    # ── ① 절단 그대로 (창 128) ────────────────────────────────
    print("① 창 128 토큰 — 긴 입력은 뒤가 잘린다")
    for name, compose in ARMS.items():
        texts = [compose(r) for r in rows]
        record(f"[128] {name}", encode(model, texts, 128),
               float(np.mean([len(t) for t in texts])))

    # ── ② 창 확장 (512) — 절단 없이 ───────────────────────────
    print("\n② 창 512 토큰 — 잘리지 않는다")
    for name, compose in ARMS.items():
        texts = [compose(r) for r in rows]
        record(f"[512] {name}", encode(model, texts, 512),
               float(np.mean([len(t) for t in texts])))

    # ── ③ 소스별 임베딩 후 평균 — 절단도 없고 편중도 없다 ─────
    print("\n③ 소스별 따로 임베딩 후 평균 (창 128)")
    pairs = [[r["desc"], r["kakao"]] for r in rows]
    record("[평균] D‖K   정보나루‖카카오",
           encode_mean(model, pairs, 128),
           float(np.mean([len(a) + len(b) for a, b in pairs])))
    triples = [[r["title"] + ". " + r["desc"], r["kakao"], " ".join(r["kw"][:30])]
               for r in rows]
    record("[평균] T+D‖K‖KW  셋 다",
           encode_mean(model, triples, 128),
           float(np.mean([sum(len(x) for x in t) for t in triples])))

    # 무작위 기준선
    rng = np.random.default_rng(SEED)
    rand_idx = rng.integers(0, len(rows), size=(len(rows), TOP_K))
    rand = coloan_hit(rand_idx, rows, TOP_K)

    print("\n" + "=" * 80)
    print(f"{'실험군':<32}{'적중@10':>10}{'적중@5':>10}{'KDC@10':>10}{'입력':>10}")
    print("-" * 80)
    for name, r in sorted(results.items(), key=lambda x: -x[1]["co10"]):
        print(f"{name:<32}{100*r['co10']:>9.2f}%{100*r['co5']:>9.2f}%"
              f"{100*r['kdc']:>9.1f}%{int(r['chars']):>9}자")
    print(f"{'[무작위]':<32}{100*rand:>9.3f}%")

    noise = max(r["noise"] for r in results.values())
    print(f"\n잡음 폭 {100*noise:.2f}%p (반쪽 분할)")

    # ── 판정: 조합이 정보나루 단독을 이기는가 ──────────────────
    print("\n조합 효과 (정보나루 단독 대비)")
    base_name = "D-only    정보나루"
    for tag in ("128", "512"):
        base = results[f"[{tag}] {base_name}"]["co10"]
        comb = results[f"[{tag}] D+K       정보나루+카카오"]["co10"]
        gain = comb - base
        verdict = "유의" if abs(gain) > noise else "잡음 폭 이내"
        print(f"  창 {tag:<4} {100*base:>5.2f}% -> {100*comb:>5.2f}%  "
              f"({100*gain:+.2f}%p · {verdict})")
    base128 = results[f"[128] {base_name}"]["co10"]
    mean_v = results["[평균] D‖K   정보나루‖카카오"]["co10"]
    gain = mean_v - base128
    print(f"  평균     {100*base128:>5.2f}% -> {100*mean_v:>5.2f}%  "
          f"({100*gain:+.2f}%p · "
          f"{'유의' if abs(gain) > noise else '잡음 폭 이내'})")

    # ── 절단이 실제로 손해였는지 ───────────────────────────────
    print("\n창 확장 효과 (같은 입력, 128 -> 512)")
    for name in ARMS:
        a = results[f"[128] {name}"]["co10"]
        b = results[f"[512] {name}"]["co10"]
        mark = "" if abs(b - a) > noise else "  (잡음 폭 이내)"
        print(f"  {name:<26} {100*a:>5.2f}% -> {100*b:>5.2f}%  "
              f"({100*(b-a):+.2f}%p){mark}")

    best = max(results.items(), key=lambda x: x[1]["co10"])
    print(f"\n주 지표 1위: {best[0]} ({100*best[1]['co10']:.2f}%, "
          f"무작위의 {best[1]['co10']/rand:.0f}배)")

    out = BASE.parent / "S15P21B102" / "database" / "_pipeline" / "reports"
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "sample": len(rows), "scored": scored,
        "truth_in": truth_in, "truth_total": truth_total,
        "random_co10": rand, "noise": noise,
        "arms": {k: {kk: vv for kk, vv in v.items()} for k, v in results.items()},
    }
    (out / "kakao_combined_experiment.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n결과 저장 {out / 'kakao_combined_experiment.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
