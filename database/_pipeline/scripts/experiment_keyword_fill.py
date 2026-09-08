#!/usr/bin/env python3
"""키워드 결측(1단계 52%)을 우리가 뽑은 키워드로 메울 수 있는가.

정보나루 키워드는 가장 무거운 텍스트 신호(빼면 −0.73%p)지만 1단계의 48% 에만 있다.
소개문(정보나루 desc · 카카오 contents)에서 **명사 TF-IDF 상위 N** 을 뽑아 대신 넣으면
얼마나 회복되는지 잰다. 판정은 두 겹이다.

  ① 정보나루 키워드가 *있는* 책에서: 우리가 뽑은 것이 정보나루 상위 10개와 얼마나 겹치나 (재현율)
  ② 같은 책에서 STRUCT 의 「키워드:」줄을 (없음 / 정보나루 / 우리 것) 으로 바꿔 P@10 짝 비교
     — 우리 것이 「없음」보다 유의하게 높고 「정보나루」에 가까우면, 결측 52% 를 그 방법으로 메울 근거가 된다.

표본은 sweep 의 B 앞 20,000권(키워드 보유 책만이라 ①·② 가 가능). 모델 e5-large.
IDF 는 이 표본의 소개문으로 계산한다 (운영에서는 1단계 전체로).

실행:  py scripts/experiment_keyword_fill.py --n 20000
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import embedding_study as es  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

STOP = set("것 수 때 곳 등 년 월 일 위 속 중 및 통해 대한 위해 이번 지금 오늘 우리 자신 이야기 책 저자 작가 작품 출판 소설 시리즈 권 편 이 그 저 사람 사람들 모습 마음 세상 삶 시간 이후 이전 하나 모든 다른 새로운 가장 함께 그리고 그러나 하지만 바로 다시 더 많은 통해서 위한 위하여 대해 대해서 관한".split())


def nouns(kiwi, text: str) -> list[str]:
    out = []
    for t in kiwi.tokenize(text[:3000]):
        if t.tag in ("NNG", "NNP", "SL") and len(t.form) >= 2 and t.form not in STOP and not t.form.isdigit():
            out.append(t.form)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--topn", type=int, default=30)
    args = ap.parse_args()

    from kiwipiepy import Kiwi
    kiwi = Kiwi()

    rows_all = es.load_sample()
    splits = es.get_splits(rows_all)
    rows = es.take(rows_all, splits["B"], args.n)
    es.attach_truth(rows)
    tag = f"B{len(rows)}"
    es.log(f"표본 {tag} · 명사 추출 시작")

    # ── 명사 TF-IDF ──────────────────────────────────────────────
    t0 = time.time()
    docs = [nouns(kiwi, f"{r['desc']} {r['kakao']}") for r in rows]
    df = collections.Counter()
    for d in docs:
        df.update(set(d))
    N = len(docs)
    for r, d in zip(rows, docs):
        tf = collections.Counter(d)
        title_toks = set(nouns(kiwi, r["title"]))
        scored = {w: (1 + math.log(c)) * math.log(N / (1 + df[w])) * (1.5 if w in title_toks else 1.0)
                  for w, c in tf.items()}
        r["gen_kw"] = [w for w, _ in sorted(scored.items(), key=lambda x: -x[1])[:50]]
    es.log(f"명사 추출·TF-IDF 완료 {time.time()-t0:.0f}s · 책당 명사 중앙 {int(np.median([len(d) for d in docs]))}개")

    # ── ① 정보나루 키워드와의 겹침 ───────────────────────────────
    def norm(w):
        return re.sub(r"[^0-9A-Za-z가-힣]", "", w).lower()
    rec10, rec30, any_hit = [], [], []
    for r in rows:
        real = [norm(w) for w in r["kw"][:10]]
        g30 = {norm(w) for w in r["gen_kw"][:30]}
        g10 = {norm(w) for w in r["gen_kw"][:10]}
        rec10.append(sum(w in g10 for w in real) / len(real))
        rec30.append(sum(w in g30 for w in real) / len(real))
        any_hit.append(any(w in g30 for w in real))
    print(f"\n[①] 정보나루 상위 10 키워드 중 우리 상위 10 에 있는 비율 {np.mean(rec10):.1%} · 상위 30 에 있는 비율 {np.mean(rec30):.1%} · 하나라도 겹침 {np.mean(any_hit):.1%}")
    ex = rows[0]
    print(f"    예: 「{ex['title'][:24]}」 정보나루 {ex['kw'][:8]}\n        우리   {ex['gen_kw'][:8]}")

    # ── ② STRUCT 변형 P@10 ───────────────────────────────────────
    def struct(r, kw_line):
        return (f"제목: {r['title']}\n저자: {r['author']}\n분류: {r.get('d_class_nm') or ''}\n"
                f"키워드: {kw_line}\n소개: {r['desc']} {r['kakao']}")
    arms = {
        "없음":            lambda r: struct(r, ""),
        "정보나루 30":      lambda r: struct(r, " ".join(r["kw"][:30])),
        "우리 TF-IDF 10":   lambda r: struct(r, " ".join(r["gen_kw"][:10])),
        "우리 TF-IDF 30":   lambda r: struct(r, " ".join(r["gen_kw"][:30])),
        "정보나루 30 + 우리 10": lambda r: struct(r, " ".join(r["kw"][:30]) + " " + " ".join(w for w in r["gen_kw"][:10] if w not in r["kw"])),
    }
    model = es.load_model("e5-large")
    pqs, summ = {}, {}
    print("\n[②] e5-large · STRUCT 키워드 줄 교체")
    for name, fn in arms.items():
        cache = es.STUDY / "emb" / "e5-large" / (re.sub(r"[^A-Za-z0-9+_]", "_", "KWFILL_" + name) + f"__{tag}.npy")
        if cache.exists():
            vec = np.load(cache); rate = 0.0
        else:
            vec, rate = es.encode(model, "e5-large", [fn(r) for r in rows])
            np.save(cache, vec)
        idx = es.neighbors(vec)
        pqs[name] = es.per_query(idx, rows)
        summ[name] = es.summarize(pqs[name])
        es.print_row(name, summ[name], f"  {rate:5.0f}/s")
    print("\n  짝 차이 (P@10 · hard)")
    for name in arms:
        if name == "없음":
            continue
        d = es.paired_diff(pqs[name]["P@10"], pqs["없음"]["P@10"])
        dh = es.paired_diff(pqs[name]["P@10 hard"], pqs["없음"]["P@10 hard"])
        print(f"    {name:<22} vs 없음   P@10 {100*d[0]:+.2f} [{100*d[1]:+.2f},{100*d[2]:+.2f}]   hard {100*dh[0]:+.2f} [{100*dh[1]:+.2f},{100*dh[2]:+.2f}]")
    d = es.paired_diff(pqs["우리 TF-IDF 30"]["P@10"], pqs["정보나루 30"]["P@10"])
    print(f"    {'우리 30 vs 정보나루 30':<22}        P@10 {100*d[0]:+.2f} [{100*d[1]:+.2f},{100*d[2]:+.2f}]")

    out = es.REPORTS / "keyword_fill.json"
    out.write_text(json.dumps({"n": len(rows), "recall10": float(np.mean(rec10)), "recall30": float(np.mean(rec30)),
                               "arms": summ}, ensure_ascii=False, indent=1), encoding="utf-8")
    es.log(f"저장 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
