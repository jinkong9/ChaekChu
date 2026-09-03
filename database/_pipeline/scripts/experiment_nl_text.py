#!/usr/bin/env python3
"""국중 회수 텍스트(목차·소개·요약)가 임베딩 입력으로 값어치가 있는가.

왜 지금까지 안 썼나
  `nl_text_clean.csv` 에 국중 URL 회수분이 있다. 셋 다 **우리가 쓰던 것보다 훨씬 길다.**

    목차(toc)      79,235권 · 중앙   699자
    소개(intro)    74,694권 · 중앙   974자   <- 정보나루 146자의 6.7배
    요약(summary)  19,974권 · 중앙 1,108자

  그런데 `ko-sroberta-multitask` 의 기본 창은 **128 토큰**이고, 한국어 기준
  약 260자에서 잘린다. 즉 이 셋은 **거의 통째로 버려진 채** 측정돼 왔다.
  2026-09-03 에 절단을 확인하고 창을 512 로 늘리자 잘리던 군만 올랐다
  (정보나루+카카오 +0.60%p, 전부 +1.75%p). 그래서 다시 잰다.

  **목차는 성격이 다르다.** 줄글이 아니라 장 제목의 나열이라 키워드에 가깝다.
  키워드 단독이 여태 최상위권이었으니 목차도 그럴 수 있다.

표본
  소스마다 보유 책이 달라 하나로 합치면 3,321권까지 줄어든다(잡음 1.30%p).
  그래서 **소스별로 따로** 돌린다.
    정보나루 + 목차    9,775권 · 잡음 약 0.76%p
    정보나루 + 국중소개  9,872권 · 잡음 약 0.75%p

지표 · 판정 규칙은 experiment_kakao_combined.py 와 같다.
  주 지표  함께대출 일치도 (coLoanBooks · maniaRec · readerRec)
  보조     KDC 세부분류 적중률
  잡음 폭  표본 반쪽 분할
  모델은 하나만 쓴다.

실행
    py scripts/experiment_nl_text.py --source toc
    py scripts/experiment_nl_text.py --source intro
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

csv.field_size_limit(50_000_000)

BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
# 로컬 정본. EC2 가 더 최신이므로 실험 전에 회수해 덮어쓴다.
D4L_CANDIDATES = [BASE / "data4library" / "d4l_usage.jsonl"]
NL_TEXT = BASE / "nl_text_clean.csv"
MODEL = "jhgan/ko-sroberta-multitask"
TOP_K = 10
SEED = 20260903
MIN_CHARS = 60
WINDOW = 512            # 절단을 피한다. 128 이 기본값이라는 것을 09-03 에 확인했다
CAP = 3000              # 한 소스에서 가져올 최대 글자 (초장문 방어)


def newest_d4l() -> Path:
    for p in D4L_CANDIDATES:
        if p.exists():
            return p
    raise SystemExit("정보나루 수집 파일을 찾지 못했다")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def load_nl(field: str) -> dict:
    out = {}
    with NL_TEXT.open(encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            if (r.get("field") or "").strip() != field:
                continue
            isbn = (r.get("isbn13") or "").strip()
            text = clean(r.get("text"))
            if isbn and len(text) >= MIN_CHARS:
                out[isbn] = text[:CAP]
    return out


def load_d4l(path: Path) -> dict:
    out = {}
    for line in path.open(encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok") or not r.get("isbn13"):
            continue
        truth = set()
        for field in ("co_loan", "mania_rec", "reader_rec"):
            for item in (r.get(field) or []):
                if isinstance(item, (list, tuple)) and item and item[0]:
                    truth.add(str(item[0]))
        kdc = re.sub(r"[^0-9]", "", r.get("class_no") or "")
        out[r["isbn13"]] = {
            "desc": clean(r.get("desc")),
            "kw": [w for w, _ in (r.get("keywords") or []) if w],
            "kdc3": kdc[:3] if len(kdc) >= 3 else "",
            "title": clean(re.sub(r"\s*:\s*.*$", "", r.get("bookname") or "")),
            "truth": truth,
        }
    return out


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
    hit = total = 0
    for i, row in enumerate(rows):
        if not row["truth_in"]:
            continue
        for j in idx[i][:k]:
            hit += rows[j]["isbn13"] in row["truth_in"]
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


def measure(vec: np.ndarray, rows: list) -> dict:
    idx = neighbors(vec, TOP_K)
    return {"co5": coloan_hit(idx, rows, 5),
            "co10": coloan_hit(idx, rows, TOP_K),
            "kdc": kdc_hit(idx, rows, TOP_K)}


def encode(model, texts: list) -> np.ndarray:
    model.max_seq_length = WINDOW
    return model.encode(texts, batch_size=32, convert_to_numpy=True,
                        normalize_embeddings=True,
                        show_progress_bar=False).astype(np.float32)


def encode_mean(model, parts: list) -> np.ndarray:
    """소스별로 따로 임베딩해 평균낸다 (절단도 편중도 없다)."""
    stacks = [encode(model, [p[s] for p in parts]) for s in range(len(parts[0]))]
    vec = np.mean(stacks, axis=0)
    norm = np.linalg.norm(vec, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    return (vec / norm).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["toc", "intro", "summary"],
                        default="toc", help="검증할 국중 회수 텍스트")
    parser.add_argument("--max", type=int, default=0)
    args = parser.parse_args()

    label = {"toc": "목차", "intro": "국중소개", "summary": "국중요약"}[args.source]
    src = newest_d4l()
    print(f"정보나루 {src.name} · 국중 {args.source}({label})")
    d4l = load_d4l(src)
    nl = load_nl(args.source)
    print(f"  정보나루 {len(d4l):,}권 · 국중 {label} {len(nl):,}권")

    rows = []
    for isbn, r in d4l.items():
        extra = nl.get(isbn, "")
        if len(r["desc"]) < MIN_CHARS or len(extra) < MIN_CHARS:
            continue
        if not r["kw"] or not r["title"]:
            continue
        rows.append({"isbn13": isbn, "nl": extra, **r})
    random.Random(SEED).shuffle(rows)
    if args.max:
        rows = rows[:args.max]

    have = {r["isbn13"] for r in rows}
    for r in rows:
        r["truth_in"] = r["truth"] & have
    scored = sum(1 for r in rows if r["truth_in"])
    ti = sum(len(r["truth_in"]) for r in rows)
    tt = sum(len(r["truth"]) for r in rows)

    print(f"\n표본 {len(rows):,}권 · 채점 {scored:,}권 · "
          f"정답 {ti:,}/{tt:,} ({100*ti/tt:.1f}% 표본 안)")
    print(f"  정보나루 중앙 {int(np.median([len(r['desc']) for r in rows]))}자 · "
          f"{label} 중앙 {int(np.median([len(r['nl']) for r in rows]))}자")

    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(MODEL, device=device)
    print(f"\n모델 {MODEL} · {device} · 창 {WINDOW} 토큰\n", flush=True)

    arms = {
        "D        정보나루":        lambda r: r["desc"],
        f"NL       {label}만":     lambda r: r["nl"],
        "KW       키워드":          lambda r: " ".join(r["kw"]),
        f"D+NL     정보나루+{label}": lambda r: r["desc"] + " " + r["nl"],
        "T+D+KW   제목+정보나루+키워드": lambda r: (r["title"] + ". " + r["desc"]
                                          + " " + " ".join(r["kw"][:30])),
        f"T+D+KW+NL  전부":        lambda r: (r["title"] + ". " + r["desc"] + " "
                                             + " ".join(r["kw"][:30]) + " " + r["nl"]),
    }

    half = len(rows) // 2
    results = {}

    def record(name, vec, chars):
        full = measure(vec, rows)
        a = measure(vec[:half], rows[:half])
        b = measure(vec[half:], rows[half:])
        full["noise"] = abs(a["co10"] - b["co10"])
        full["chars"] = chars
        results[name] = full
        print(f"  {name:<30} 적중@10 {100*full['co10']:>5.2f}%  "
              f"@5 {100*full['co5']:>5.2f}%  KDC {100*full['kdc']:>5.1f}%  "
              f"({int(chars)}자)", flush=True)

    for name, compose in arms.items():
        texts = [compose(r) for r in rows]
        record(name, encode(model, texts),
               float(np.mean([len(t) for t in texts])))

    print()
    pairs = [[r["desc"], r["nl"]] for r in rows]
    record(f"[평균] D‖NL   정보나루‖{label}", encode_mean(model, pairs),
           float(np.mean([len(a) + len(b) for a, b in pairs])))
    quads = [[r["title"] + ". " + r["desc"], " ".join(r["kw"][:30]), r["nl"]]
             for r in rows]
    record(f"[평균] T+D‖KW‖NL  셋 다", encode_mean(model, quads),
           float(np.mean([sum(len(x) for x in q) for q in quads])))

    rng = np.random.default_rng(SEED)
    rand = coloan_hit(rng.integers(0, len(rows), size=(len(rows), TOP_K)),
                      rows, TOP_K)

    print("\n" + "=" * 78)
    print(f"{'실험군':<30}{'적중@10':>10}{'적중@5':>10}{'KDC@10':>10}{'입력':>10}")
    print("-" * 78)
    for name, r in sorted(results.items(), key=lambda x: -x[1]["co10"]):
        print(f"{name:<30}{100*r['co10']:>9.2f}%{100*r['co5']:>9.2f}%"
              f"{100*r['kdc']:>9.1f}%{int(r['chars']):>9}자")
    print(f"{'[무작위]':<30}{100*rand:>9.3f}%")

    noise = max(r["noise"] for r in results.values())
    base = results["D        정보나루"]["co10"]
    print(f"\n잡음 폭 {100*noise:.2f}%p (반쪽 분할)")
    print(f"\n{label} 효과 (정보나루 단독 {100*base:.2f}% 대비)")
    for name in results:
        if name == "D        정보나루":
            continue
        gain = results[name]["co10"] - base
        mark = "유의" if abs(gain) > noise else "잡음 폭 이내"
        print(f"  {name:<30}{100*gain:+7.2f}%p  {mark}")

    out = Path(__file__).resolve().parents[1] / "reports"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"nl_text_experiment_{args.source}.json").write_text(
        json.dumps({"source": args.source, "sample": len(rows),
                    "scored": scored, "truth_in": ti, "truth_total": tt,
                    "random_co10": rand, "noise": noise, "arms": results},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n결과 저장 {out / f'nl_text_experiment_{args.source}.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
