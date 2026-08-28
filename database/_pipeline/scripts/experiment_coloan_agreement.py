#!/usr/bin/env python3
"""임베딩 추천이 **실제 사람들의 행동**과 얼마나 맞는가.

앞선 실험은 KDC 세부분류 적중률을 주 지표로 썼다. 그것은
"텍스트가 주제 신호를 담는가" 를 재는 데는 맞지만
**"좋은 추천인가" 를 재는 데는 맞지 않는다.**
소년이 온다를 좋아하는 사람이 반드시 한국소설을 더 원하는 것은 아니다.

여기서는 정답을 분류표가 아니라 **행동**에서 가져온다.
정보나루 `coLoanBooks` 는 실제로 **같은 이용자가 함께 빌린 책**이고,
`maniaRecBooks` `readerRecBooks` 는 그것을 가공한 추천이다.
사람이 실제로 이어서 집어든 책이므로, 이것과 얼마나 겹치는지가
KDC 일치보다 추천 품질에 훨씬 가깝다.

재는 것
  적중률@K   임베딩 상위 K 중 실제 함께대출 목록에 든 비율
  재현율@K   실제 함께대출 목록 중 임베딩 상위 K 가 건진 비율
  순위       함께대출 도서가 임베딩에서 몇 위에 놓이는가 (중앙값)

한계 — 먼저 밝힌다
  함께대출 목록의 책이 우리 수집분에 없으면 애초에 맞힐 수 없다.
  그래서 **찾을 수 있는 것만 분모로 삼는다.** 수집이 진행되면 수치가 오른다.

실행
    py scripts/experiment_coloan_agreement.py
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
D4L = BASE / "data4library" / "d4l_usage.jsonl"
KAKAO = BASE / "kakao_enriched.jsonl"
MODEL = "jhgan/ko-sroberta-multitask"
SEED = 20260828
KS = (5, 10, 20)

ARMS = {
    "제목만":              lambda r: r["title"],
    "소개문(정보나루)":      lambda r: r["desc"],
    "소개문(카카오)":        lambda r: r["kakao"],
    "키워드":              lambda r: " ".join(r["kw"]),
    "제목+소개문":          lambda r: f"{r['title']}. {r['desc']} {r['kakao']}",
    "제목+소개문+키워드":     lambda r: f"{r['title']}. {r['desc']} {r['kakao']} "
                                     + " ".join(r["kw"]),
}


def load() -> tuple:
    kakao = {}
    if KAKAO.exists():
        for line in KAKAO.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("ok"):
                kakao[r["isbn13"]] = (r.get("contents") or "").strip()

    rows, truth = [], {}
    for line in D4L.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok"):
            continue
        title = re.sub(r"\s*:\s*.*$", "", r.get("bookname") or "").strip()
        if not title:
            continue
        rows.append({
            "isbn13": r["isbn13"],
            "title": title,
            "desc": (r.get("desc") or "").strip(),
            "kakao": kakao.get(r["isbn13"], ""),
            "kw": [w for w, _ in (r.get("keywords") or [])],
            "kdc3": re.sub(r"[^0-9]", "", r.get("class_no") or "")[:3],
        })
        # 정답: 함께대출 + 마니아추천 + 다독자추천의 합집합
        ref = set()
        for key in ("co_loan", "mania_rec", "reader_rec"):
            for pair in (r.get(key) or []):
                if pair and pair[0]:
                    ref.add(pair[0])
        ref.discard(r["isbn13"])
        if ref:
            truth[r["isbn13"]] = ref
    return rows, truth


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-text", type=int, default=60)
    args = parser.parse_args()

    rows, truth = load()
    pos = {r["isbn13"]: i for i, r in enumerate(rows)}

    # 정답 중 우리 수집분에 실제로 있는 것만 남긴다. 없으면 맞힐 방법이 없다
    usable = {}
    for isbn, ref in truth.items():
        inside = {pos[x] for x in ref if x in pos and x != isbn}
        if inside:
            usable[pos[isbn]] = inside

    ok = [i for i in usable
          if len(rows[i]["desc"]) >= args.min_text and rows[i]["kw"]]
    random.Random(SEED).shuffle(ok)

    total_ref = sum(len(truth[rows[i]["isbn13"]]) for i in ok)
    found_ref = sum(len(usable[i]) for i in ok)
    print(f"수집분 {len(rows):,}권 · 함께대출 정답 보유 {len(truth):,}권")
    print(f"평가 대상 {len(ok):,}권 (소개문 {args.min_text}자+ · 키워드 보유 · 정답이 수집분 안에 있음)")
    print(f"정답 도서 {total_ref:,}건 중 수집분 안에 있는 것 {found_ref:,}건 "
          f"({100*found_ref/max(total_ref,1):.1f}%)")
    print(f"  -> 나머지는 아직 수집 안 된 책이라 맞힐 방법이 없다. 수집이 진행되면 오른다")
    print(f"  권당 정답 중앙 {int(np.median([len(usable[i]) for i in ok]))}건\n", flush=True)

    if len(ok) < 200:
        print("평가 표본이 너무 적다. 수집을 더 진행한 뒤 다시 볼 것.")
        return 1

    from sentence_transformers import SentenceTransformer
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(MODEL, device=device)
    print(f"모델 {MODEL} · {device}\n", flush=True)

    maxk = max(KS)
    results = {}
    for name, compose in ARMS.items():
        texts = [compose(r) for r in rows]
        v = model.encode(texts, batch_size=64, convert_to_numpy=True,
                         normalize_embeddings=True,
                         show_progress_bar=False).astype(np.float32)
        prec = {k: [] for k in KS}
        rec = {k: [] for k in KS}
        ranks = []
        kdc_hit = []
        for i in ok:
            s = v @ v[i]
            s[i] = -2.0
            order = np.argsort(-s)
            top = order[:maxk]
            gold = usable[i]
            for k in KS:
                hit = sum(1 for j in top[:k] if j in gold)
                prec[k].append(hit / k)
                rec[k].append(hit / len(gold))
            place = {int(j): p for p, j in enumerate(order[:2000], 1)}
            got = [place[g] for g in gold if g in place]
            if got:
                ranks.append(float(np.median(got)))
            kdc_hit.append(np.mean([rows[j]["kdc3"] == rows[i]["kdc3"]
                                    for j in top[:10]]))
        results[name] = {
            "prec": {k: float(np.mean(prec[k])) for k in KS},
            "rec": {k: float(np.mean(rec[k])) for k in KS},
            "rank": float(np.median(ranks)) if ranks else float("nan"),
            "kdc": float(np.mean(kdc_hit)),
        }
        r = results[name]
        print(f"  {name:<20} 적중@10 {100*r['prec'][10]:>5.1f}%  "
              f"재현@20 {100*r['rec'][20]:>5.1f}%  "
              f"정답 순위 중앙 {r['rank']:>6.0f}위  "
              f"(참고 KDC {100*r['kdc']:>4.1f}%)", flush=True)

    print("\n" + "=" * 82)
    print(f"{'입력 구성':<22}" + "".join(f"{'적중@'+str(k):>9}" for k in KS)
          + f"{'재현@20':>9}{'정답순위':>9}{'KDC참고':>9}")
    print("-" * 82)
    for name, r in sorted(results.items(), key=lambda x: -x[1]["prec"][10]):
        print(f"{name:<22}"
              + "".join(f"{100*r['prec'][k]:>8.1f}%" for k in KS)
              + f"{100*r['rec'][20]:>8.1f}%{r['rank']:>8.0f}위{100*r['kdc']:>8.1f}%")
    print("-" * 82)

    # 무작위 기준선
    n_all = len(rows)
    base = float(np.mean([len(usable[i]) / n_all for i in ok]))
    print(f"{'[무작위]':<22}{100*base:>8.3f}%")
    best = max(results.values(), key=lambda r: r["prec"][10])
    print(f"\n최고 군의 무작위 대비 {best['prec'][10]/base:.0f}배")
    print("\n※ 적중@10 = 임베딩 상위 10권 중 실제 함께대출 목록에 든 비율.")
    print("   KDC 열은 참고용이다. 두 지표의 순위가 다르면 행동 지표를 따른다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
