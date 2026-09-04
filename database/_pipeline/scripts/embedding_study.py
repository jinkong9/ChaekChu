#!/usr/bin/env python3
"""임베딩 모델·입력 조합 선정 연구 — 1단계(노출 90%) 밴드.

무엇을 정하려는가
  추천 임베딩에 **어느 모델**을 쓰고, 네 소스(국중 · 정보나루 원장 ·
  정보나루 usageAnalysisList · 카카오)의 **어떤 필드를 어떻게 합쳐** 넣을지.
  이 답이 원천 데이터를 DB 에 어떻게 두는지(어떤 컬럼을 보존하고 어떤 것을
  버리는지)를 결정하므로, 결론이 데이터의 잡음이 아니라 신호에서 나와야 한다.

앞선 실험과 다른 점
  · 모집단을 **1단계 밴드**(대출 940+, 343,683권)로 고정한다. 운영에서 먼저
    임베딩될 구간이고, 정답(함께대출)이 가장 촘촘한 구간이다.
  · 모델을 **여러 개** 비교한다. 앞선 실험은 사전 등록 규칙으로 모델을 하나에
    묶었다("여러 개 돌려 좋은 것을 고르면 실험이 아니다"). 그 규칙은 *입력*
    비교에는 맞았지만, 이번 질문은 모델 자체다. 대신 다른 방식으로 낚시를 막는다:
    모델 비교(screen)와 입력 비교(sweep)를 **표본을 갈라** 하고, 최종 수치는
    두 단계에서 쓰지 않은 **검증 표본**(final)에서만 낸다.
  · 잡음 폭을 반쪽 분할 하나가 아니라 **부트스트랩 신뢰구간**으로 잰다.
    두 실험군의 차이는 같은 질의를 짝지어 재는 **짝 부트스트랩**이다.
  · 무작위 기준선 외에 **이길 만한 기준선**을 둔다 — 인기순 · 같은 KDC 무작위 ·
    같은 저자 · TF-IDF. 임베딩이 이들을 못 이기면 임베딩을 쓸 이유가 없다.
  · 함께대출 정답의 **구조**를 먼저 해부한다 (인기 편향 · 시리즈 · 같은 저자 ·
    주제 일치). 정답이 쉬운 부분(시리즈 다음 권)을 맞혀 점수가 오르는 것과
    어려운 부분(다른 저자 · 다른 주제)을 맞히는 것은 다른 능력이다. 그래서
    **어려운 정답만 따로** 잰다.

단계
  prepare   네 소스를 ISBN 으로 이어 1단계 표본 파케이를 만든다
  labels    정답 후보(함께대출 · 마니아 · 다독자 · KDC)의 결측·구조를 해부한다
  screen    모델 비교 — 입력을 고정하고 모델만 바꾼다             (표본 A)
  sweep     입력 조합 비교 — 상위 모델에서 조합만 바꾼다          (표본 B)
  final     최종 검증 — 이긴 조합을 처음 보는 표본에서 잰다        (표본 C)

실행
    py scripts/embedding_study.py prepare
    py scripts/embedding_study.py labels
    py scripts/embedding_study.py screen --n 20000
    py scripts/embedding_study.py sweep  --n 40000 --models kure,sroberta
    py scripts/embedding_study.py final  --model kure --arm "T+D+KW+K"
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
STUDY = BASE / "tmp" / "study"                    # 표본·임베딩 캐시 (저장소 밖)
REPORTS = (BASE.parent / "S15P21B102" / "database" / "_pipeline"
           / "reports" / "embedding_study")       # 결과 JSON (저장소 안)

# 입력 파일. EC2 회수본이 있으면 그것을 쓴다 (로컬 정본은 220k 로 1단계를 못 덮는다).
D4L = next((p for p in [BASE / "tmp" / "d4l_usage.ec2.jsonl",
                        BASE / "data4library" / "d4l_usage.jsonl"] if p.exists()), None)
KAKAO = next((p for p in [BASE / "tmp" / "kakao_enriched.ec2.jsonl",
                          BASE / "kakao_enriched.jsonl"] if p.exists()), None)
QUEUE = BASE / "data4library" / "enrich_queue.csv"
LEDGER = BASE / "data4library" / "books_dedup.parquet"
NL = BASE / "nl_books_enriched.parquet"

SAMPLE = STUDY / "tier1.parquet"
SPLITS = STUDY / "splits.json"
MIN_CHARS = 60
TOP_K = 10
SEQ_LEN = 512
SEED = 20260904
BOOT = 300


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def kdc3(code) -> str:
    """'813.7' -> '813'. 숫자로 시작하지 않으면 빈 문자열 (청구기호 오염 방어)."""
    m = re.match(r"^\s*(\d{3})", str(code or ""))
    return m.group(1) if m else ""


def title_stem(title: str) -> str:
    """시리즈 판별용 어간. 부제(':' 이후)·권차·괄호를 떼고 공백을 지운다."""
    t = re.sub(r"\s*[:：].*$", "", title or "")
    t = re.sub(r"[\(\[（【].*?[\)\]）】]", " ", t)
    t = re.sub(r"\b\d+\s*(권|편|부|장|호|vol\.?|v\.?)?\b", " ", t, flags=re.I)
    t = re.sub(r"[^0-9A-Za-z가-힣]", "", t)
    return t.lower()


# ══════════════════════════════════════════════════════════════════════
# prepare — 네 소스를 이어 1단계 표본을 만든다
# ══════════════════════════════════════════════════════════════════════

def flatten_d4l(src: Path, dst: Path) -> int:
    """중첩 리스트(함께대출 등)를 JSON 문자열로 펴서 DuckDB 가 읽을 수 있게 한다.
    같은 ISBN 이 여러 번 있으면 **마지막** 레코드를 쓴다 (재수집이 나중)."""
    rows = {}
    n = 0
    for line in src.open(encoding="utf-8", errors="replace"):
        n += 1
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok") or not r.get("isbn13"):
            continue

        def isbns(field):
            return [str(x[0]) for x in (r.get(field) or [])
                    if isinstance(x, (list, tuple)) and x and x[0]]

        kws = r.get("keywords") or []
        if kws and isinstance(kws[0], (list, tuple)):
            kws = [w for w, *_ in kws if w]
        else:
            kws = [w for w in kws if w]
        rows[r["isbn13"]] = {
            "isbn13": r["isbn13"],
            "d_title": clean(r.get("bookname")),
            "d_authors": clean(r.get("authors")),
            "d_publisher": clean(r.get("publisher")),
            "d_pub_year": clean(r.get("pub_year"))[:4],
            "d_class_no": clean(r.get("class_no")),
            "d_class_nm": clean(r.get("class_nm")),
            "d_loan_total": r.get("loan_total") or 0,
            "d_desc": clean(r.get("desc")),
            "d_keywords": json.dumps(kws, ensure_ascii=False),
            "co_loan": json.dumps(isbns("co_loan")),
            "mania_rec": json.dumps(isbns("mania_rec")),
            "reader_rec": json.dumps(isbns("reader_rec")),
        }
    with dst.open("w", encoding="utf-8") as f:
        for r in rows.values():
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"  정보나루 {n:,}줄 -> ok 고유 {len(rows):,}권")
    return len(rows)


def cmd_prepare(args) -> int:
    import duckdb
    STUDY.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    log(f"정보나루 {D4L.name} · 카카오 {KAKAO.name}")

    flat = STUDY / "d4l_flat.jsonl"
    flatten_d4l(D4L, flat)

    con = duckdb.connect()
    con.sql(f"""
    create table q as
      select isbn13, tier, loans as q_loans, row_number() over (order by loans desc) as loan_rank
      from read_csv('{QUEUE.as_posix()}') where tier = 1""")
    con.sql(f"""
    create table d as select * from read_json('{flat.as_posix()}',
      format='newline_delimited', union_by_name=true,
      columns={{'isbn13':'VARCHAR','d_title':'VARCHAR','d_authors':'VARCHAR','d_publisher':'VARCHAR',
               'd_pub_year':'VARCHAR','d_class_no':'VARCHAR','d_class_nm':'VARCHAR','d_loan_total':'BIGINT',
               'd_desc':'VARCHAR','d_keywords':'VARCHAR','co_loan':'VARCHAR','mania_rec':'VARCHAR',
               'reader_rec':'VARCHAR'}})""")
    con.sql(f"""
    create table k as
      select isbn13, any_value(title) k_title, any_value(contents) k_contents
      from read_json('{KAKAO.as_posix()}', format='newline_delimited', union_by_name=true,
                     ignore_errors=true, maximum_object_size=4000000)
      where ok and contents is not null group by 1""")
    con.sql(f"""
    create table l as
      select isbn13, title l_title, author l_author, publisher l_publisher, pub_year l_pub_year,
             kdc l_kdc, loans l_loans, lib_count l_lib_count, set_isbn l_set_isbn
      from '{LEDGER.as_posix()}'""")
    con.sql(f"""
    create table n as
      select isbn13_norm isbn13, any_value(KDC) n_kdc, any_value(SUBJECT) n_subject,
             any_value(add_audience) n_audience, any_value(r_intro) n_intro,
             any_value(r_toc) n_toc, any_value(r_summary) n_summary
      from '{NL.as_posix()}' where isbn13_norm is not null group by 1""")
    con.sql(f"""
    copy (
      select q.*, d.* exclude(isbn13), k.* exclude(isbn13), l.* exclude(isbn13), n.* exclude(isbn13)
      from q left join d using(isbn13) left join k using(isbn13)
             left join l using(isbn13) left join n using(isbn13)
      order by loan_rank
    ) to '{SAMPLE.as_posix()}' (format parquet, compression zstd)""")

    r = con.sql(f"""
    select count(*) n,
      count(d_title) d_seen,
      sum((length(d_desc) >= {MIN_CHARS})::int) d_desc,
      sum((d_keywords <> '[]')::int) d_kw,
      sum((co_loan <> '[]')::int) co_loan,
      sum((mania_rec <> '[]')::int) mania,
      sum((reader_rec <> '[]')::int) reader,
      sum((length(k_contents) >= {MIN_CHARS})::int) k_desc,
      sum((regexp_matches(l_kdc, '^[0-9]{{3}}'))::int) l_kdc,
      sum((regexp_matches(d_class_no, '^[0-9]{{3}}'))::int) d_kdc,
      sum((regexp_matches(n_kdc, '^[0-9]{{3}}'))::int) n_kdc,
      sum((length(n_intro) >= {MIN_CHARS} or length(n_toc) >= {MIN_CHARS}
           or length(n_summary) >= {MIN_CHARS})::int) n_text,
      sum((length(d_desc) >= {MIN_CHARS} and length(k_contents) >= {MIN_CHARS}
           and d_keywords <> '[]')::int) all_src,
      sum((length(d_desc) < {MIN_CHARS} and length(k_contents) < {MIN_CHARS})::int) no_desc,
      sum((length(d_desc) < {MIN_CHARS} and length(k_contents) < {MIN_CHARS}
           and (length(n_intro) >= {MIN_CHARS} or length(n_toc) >= {MIN_CHARS}
                or length(n_summary) >= {MIN_CHARS}))::int) nl_rescue
    from '{SAMPLE.as_posix()}'""").fetchone()
    names = ["n", "d_seen", "d_desc", "d_kw", "co_loan", "mania", "reader", "k_desc",
             "l_kdc", "d_kdc", "n_kdc", "n_text", "all_src", "no_desc", "nl_rescue"]
    cov = dict(zip(names, [int(x or 0) for x in r]))
    log("1단계 표본 커버리지")
    for k_, v in cov.items():
        print(f"    {k_:10s} {v:>9,}  {v/cov['n']:6.1%}")
    (REPORTS / "coverage.json").write_text(json.dumps(cov, indent=2), encoding="utf-8")
    log(f"저장 {SAMPLE}")
    return 0


# ══════════════════════════════════════════════════════════════════════
# 표본 로딩 (labels / screen / sweep / final 공용)
# ══════════════════════════════════════════════════════════════════════

def load_sample(need_all_sources: bool = True) -> list[dict]:
    import duckdb
    con = duckdb.connect()
    where = (f"where length(d_desc) >= {MIN_CHARS} and length(k_contents) >= {MIN_CHARS} "
             f"and d_keywords <> '[]' and d_title <> ''") if need_all_sources else ""
    cols = con.sql(f"select * from '{SAMPLE.as_posix()}' {where}")
    names = [c[0] for c in cols.description]
    rows = []
    for rec in cols.fetchall():
        r = dict(zip(names, rec))
        for f in ("co_loan", "mania_rec", "reader_rec", "d_keywords"):
            r[f] = json.loads(r[f]) if r.get(f) else []
        r["kdc3"] = kdc3(r.get("l_kdc")) or kdc3(r.get("d_class_no")) or kdc3(r.get("n_kdc"))
        r["title"] = clean(r.get("d_title") or r.get("l_title") or r.get("k_title"))
        r["author"] = clean(r.get("d_authors") or r.get("l_author"))
        r["publisher"] = clean(r.get("d_publisher") or r.get("l_publisher"))
        r["stem"] = title_stem(r["title"])
        r["author_key"] = re.sub(r"[^0-9A-Za-z가-힣]", "", (r["author"] or "").split(";")[0])[:12]
        r["desc"] = clean(r.get("d_desc"))
        r["kakao"] = clean(r.get("k_contents"))
        r["kw"] = r["d_keywords"]
        r["nl_text"] = " ".join(clean(r.get(f)) for f in ("n_intro", "n_summary", "n_toc")
                                if r.get(f) and len(clean(r.get(f))) >= MIN_CHARS)
        rows.append(r)
    return rows


def get_splits(rows: list[dict]) -> dict:
    """전 소스 보유 표본을 A(모델) · B(입력) · C(검증) 로 한 번만 가른다. 이후 고정."""
    if SPLITS.exists():
        return json.loads(SPLITS.read_text(encoding="utf-8"))
    isbns = [r["isbn13"] for r in rows]
    random.Random(SEED).shuffle(isbns)
    n = len(isbns)
    a, b = int(n * 0.15), int(n * 0.30)
    splits = {"A": isbns[:a], "B": isbns[a:a + b], "C": isbns[a + b:]}
    SPLITS.write_text(json.dumps(splits), encoding="utf-8")
    log(f"표본 분할 저장: A {a:,} · B {b:,} · C {n - a - b:,}")
    return splits


def take(rows: list[dict], isbns: list[str], n: int) -> list[dict]:
    by = {r["isbn13"]: r for r in rows}
    picked = [by[i] for i in isbns if i in by]
    if n:
        picked = picked[:n]
    return picked


def attach_truth(rows: list[dict]) -> None:
    """정답을 표본 안으로 제한하고, '어려운 정답'(다른 시리즈·다른 저자)을 따로 둔다."""
    by = {r["isbn13"]: r for r in rows}
    for r in rows:
        union = set(r["co_loan"]) | set(r["mania_rec"]) | set(r["reader_rec"])
        union.discard(r["isbn13"])
        r["t_union"] = {t for t in union if t in by}
        r["t_co"] = {t for t in r["co_loan"] if t in by and t != r["isbn13"]}
        # 마니아 정답은 인기 편향이 가장 약하다 (상위 1% 책 비율 3.9% vs 함께대출 25.7%)
        r["t_mania"] = {t for t in r["mania_rec"] if t in by and t != r["isbn13"]}
        r["t_hard"] = {t for t in r["t_union"]
                       if not (r["stem"] and r["stem"] == by[t]["stem"])
                       and not (r["author_key"] and r["author_key"] == by[t]["author_key"])}


# ══════════════════════════════════════════════════════════════════════
# labels — 정답 후보의 결측과 구조
# ══════════════════════════════════════════════════════════════════════

def cmd_labels(args) -> int:
    rows = load_sample(need_all_sources=False)
    by = {r["isbn13"]: r for r in rows}
    pool = set(by)
    n = len(rows)
    out = {"pool": n}
    log(f"1단계 {n:,}권 · 정답 구조 해부")

    print("\n  [결측] 정답 후보별 보유 책 수 · 책당 정답 수 · 정답이 1단계 안에 있는 비율")
    for f in ("co_loan", "mania_rec", "reader_rec"):
        have = [r for r in rows if r[f]]
        total = sum(len(r[f]) for r in have)
        inside = sum(1 for r in have for t in r[f] if t in pool)
        self_ref = sum(1 for r in have for t in r[f] if t == r["isbn13"])
        out[f] = {"books": len(have), "targets": total, "in_pool": inside,
                  "per_book": total / max(len(have), 1), "self": self_ref}
        print(f"    {f:10s} {len(have):>8,}권 ({len(have)/n:5.1%})  책당 {total/max(len(have),1):4.1f}  "
              f"1단계 안 {inside/max(total,1):5.1%}  자기참조 {self_ref}")
    union_books = sum(1 for r in rows if r["co_loan"] or r["mania_rec"] or r["reader_rec"])
    kdc_have = sum(1 for r in rows if r["kdc3"])
    out["union_books"] = union_books
    out["kdc3_books"] = kdc_have
    print(f"    {'합집합':10s} {union_books:>8,}권 ({union_books/n:5.1%})")
    print(f"    {'KDC3':10s} {kdc_have:>8,}권 ({kdc_have/n:5.1%})  (원장 → 정보나루 → 국중 순 보완)")

    print("\n  [겹침] 같은 책의 세 목록이 얼마나 같은 ISBN 을 가리키는가 (Jaccard 평균)")

    def jacc(a, b):
        a, b = set(a), set(b)
        return len(a & b) / len(a | b) if (a | b) else None
    for x, y in (("co_loan", "mania_rec"), ("co_loan", "reader_rec"), ("mania_rec", "reader_rec")):
        js = [jacc(r[x], r[y]) for r in rows if r[x] and r[y]]
        js = [j for j in js if j is not None]
        out[f"jaccard_{x}_{y}"] = float(np.mean(js)) if js else None
        print(f"    {x:10s} ∩ {y:10s}  {np.mean(js):.3f}  (n={len(js):,})")

    print("\n  [성격] 1단계 안 정답 중 … 인 비율")
    for f in ("co_loan", "mania_rec", "reader_rec"):
        pairs = [(r, by[t]) for r in rows for t in r[f] if t in by and t != r["isbn13"]]
        if not pairs:
            continue
        top1 = sum(1 for _, t in pairs if t["loan_rank"] <= n * 0.01) / len(pairs)
        top10 = sum(1 for _, t in pairs if t["loan_rank"] <= n * 0.10) / len(pairs)
        same_stem = sum(1 for s, t in pairs if s["stem"] and s["stem"] == t["stem"]) / len(pairs)
        same_auth = sum(1 for s, t in pairs if s["author_key"] and s["author_key"] == t["author_key"]) / len(pairs)
        same_kdc = [s["kdc3"] == t["kdc3"] for s, t in pairs if s["kdc3"] and t["kdc3"]]
        same_kdc1 = [s["kdc3"][0] == t["kdc3"][0] for s, t in pairs if s["kdc3"] and t["kdc3"]]
        hard = sum(1 for s, t in pairs
                   if not (s["stem"] and s["stem"] == t["stem"])
                   and not (s["author_key"] and s["author_key"] == t["author_key"])) / len(pairs)
        out[f"nature_{f}"] = {"pairs": len(pairs), "target_top1pct": top1, "target_top10pct": top10,
                              "same_series": same_stem, "same_author": same_auth,
                              "same_kdc3": float(np.mean(same_kdc)), "same_kdc1": float(np.mean(same_kdc1)),
                              "hard_share": hard}
        print(f"    {f:10s} 상위1%책 {top1:5.1%} · 상위10%책 {top10:5.1%} · 같은시리즈 {same_stem:5.1%} · "
              f"같은저자 {same_auth:5.1%} · 같은KDC3 {np.mean(same_kdc):5.1%} · 같은KDC대분류 {np.mean(same_kdc1):5.1%} · "
              f"**어려운 정답(다른 시리즈·다른 저자) {hard:5.1%}**")

    print("\n  [KDC] 소스 간 3자리 일치 (둘 다 있는 책)")
    for a, b in (("l_kdc", "d_class_no"), ("l_kdc", "n_kdc"), ("d_class_no", "n_kdc")):
        both = [(kdc3(r[a]), kdc3(r[b])) for r in rows if kdc3(r.get(a)) and kdc3(r.get(b))]
        agree = sum(1 for x, y in both if x == y) / max(len(both), 1)
        out[f"kdc_agree_{a}_{b}"] = {"n": len(both), "agree": agree}
        print(f"    {a:10s} vs {b:10s}  {agree:5.1%}  (n={len(both):,})")

    sym = tot = 0
    for r in rows:
        for t in r["co_loan"]:
            if t in by:
                tot += 1
                sym += r["isbn13"] in by[t]["co_loan"]
    out["co_loan_symmetry"] = sym / max(tot, 1)
    print(f"\n  [대칭] A 의 함께대출에 B 가 있을 때 B 의 목록에도 A 가 있는 비율 {sym/max(tot,1):5.1%}")

    (REPORTS / "labels.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"저장 {REPORTS / 'labels.json'}")
    return 0


# ══════════════════════════════════════════════════════════════════════
# 모델 · 입력 조합
# ══════════════════════════════════════════════════════════════════════

MODELS = {
    # key: (HF 이름, 접두어, 풀링 강제)
    "sroberta":  ("jhgan/ko-sroberta-multitask",           "",        None),
    "kosimcse":  ("BM-K/KoSimCSE-roberta",                 "",        "cls"),
    "krsbert":   ("snunlp/KR-SBERT-V40K-klueNLI-augSTS",   "",        None),
    "e5-base":   ("intfloat/multilingual-e5-base",         "query: ", None),
    "e5-large":  ("intfloat/multilingual-e5-large",        "query: ", None),
    "bge-m3":    ("BAAI/bge-m3",                           "",        None),
    "kure":      ("nlpai-lab/KURE-v1",                     "",        None),
    "bge-m3-ko": ("dragonkue/BGE-m3-ko",                   "",        None),
}


def kws(r, n=30) -> str:
    return " ".join(r["kw"][:n])


# 이어붙임 실험군. 값이 리스트면 소스별로 따로 임베딩해 평균낸다.
ARMS = {
    "T":          lambda r: r["title"],
    "TAP":        lambda r: f"{r['title']} / {r['author']} / {r['publisher']}",
    "KW":         lambda r: kws(r),
    "D":          lambda r: r["desc"],
    "K":          lambda r: r["kakao"],
    "T+KW":       lambda r: f"{r['title']}. {kws(r)}",
    "T+D":        lambda r: f"{r['title']}. {r['desc']}",
    "T+D+KW":     lambda r: f"{r['title']}. {r['desc']} {kws(r)}",
    "T+D+K":      lambda r: f"{r['title']}. {r['desc']} {r['kakao']}",
    "T+D+KW+K":   lambda r: f"{r['title']}. {r['desc']} {kws(r)} {r['kakao']}",
    "T+KW+D+K":   lambda r: f"{r['title']}. {kws(r)}. {r['desc']} {r['kakao']}",
    "STRUCT":     lambda r: (f"제목: {r['title']}\n저자: {r['author']}\n분류: {r.get('d_class_nm') or ''}\n"
                             f"키워드: {kws(r)}\n소개: {r['desc']} {r['kakao']}"),
    "MEAN T+D|K|KW":   lambda r: [f"{r['title']}. {r['desc']}", r["kakao"], kws(r)],
    "MEAN T+KW|D|K":   lambda r: [f"{r['title']}. {kws(r)}", r["desc"], r["kakao"]],
    "T+D+KW+K+N": lambda r: f"{r['title']}. {r['desc']} {kws(r)} {r['kakao']} {r['nl_text']}",
}
SCREEN_ARMS = ["T+D+KW+K", "T+KW"]


def load_model(key: str):
    import torch
    from sentence_transformers import SentenceTransformer, models
    name, _, pool = MODELS[key]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    kwargs = {"torch_dtype": torch.float16} if device == "cuda" else {}
    if pool:
        tr = models.Transformer(name, max_seq_length=SEQ_LEN, model_kwargs=kwargs)
        pl = models.Pooling(tr.get_word_embedding_dimension(), pooling_mode=pool)
        model = SentenceTransformer(modules=[tr, pl], device=device)
    else:
        model = SentenceTransformer(name, device=device, model_kwargs=kwargs)
    model.max_seq_length = SEQ_LEN
    return model


def encode(model, key: str, texts: list[str]) -> tuple[np.ndarray, float]:
    prefix = MODELS[key][1]
    big = key in ("e5-large", "bge-m3", "kure", "bge-m3-ko")
    t = time.time()
    vec = model.encode([prefix + x for x in texts], batch_size=32 if big else 64,
                       convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)
    return vec.astype(np.float32), len(texts) / (time.time() - t)


def embed_arm(model, key: str, arm: str, rows: list[dict], tag: str) -> tuple[np.ndarray, float]:
    """캐시된 임베딩이 있으면 그것을 쓴다. 없으면 인코딩하고 저장한다."""
    cache = STUDY / "emb" / key / f"{re.sub(r'[^A-Za-z0-9+_]', '_', arm)}__{tag}.npy"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        return np.load(cache), 0.0
    sample = ARMS[arm](rows[0])
    if isinstance(sample, list):
        stacks, rate = [], []
        for s in range(len(sample)):
            v, r_ = encode(model, key, [ARMS[arm](r)[s] for r in rows])
            stacks.append(v)
            rate.append(r_)
        vec = np.mean(stacks, axis=0)
        vec /= np.maximum(np.linalg.norm(vec, axis=1, keepdims=True), 1e-9)
        rate = 1 / sum(1 / x for x in rate)      # 소스 셋을 다 인코딩하는 데 드는 처리량
    else:
        vec, rate = encode(model, key, [ARMS[arm](r) for r in rows])
    np.save(cache, vec.astype(np.float32))
    return vec.astype(np.float32), rate


def truncation_rate(model, key: str, arm: str, rows: list[dict], n: int = 2000) -> float:
    """입력이 창(512)을 넘어 잘리는 비율."""
    tok = model.tokenizer
    prefix = MODELS[key][1]
    texts = [ARMS[arm](r) for r in rows[:n]]
    texts = [t if isinstance(t, str) else " ".join(t) for t in texts]
    lens = [len(tok(prefix + t, add_special_tokens=True, truncation=False)["input_ids"]) for t in texts]
    return float(np.mean([L > SEQ_LEN for L in lens]))


# ══════════════════════════════════════════════════════════════════════
# 이웃 탐색 · 지표 · 기준선
# ══════════════════════════════════════════════════════════════════════

def neighbors(vec: np.ndarray, k: int = TOP_K) -> np.ndarray:
    import torch
    n = len(vec)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    V = torch.from_numpy(vec).to(dev)
    out = np.empty((n, k), dtype=np.int32)
    step = 1024
    for s in range(0, n, step):
        e = min(s + step, n)
        sims = V[s:e] @ V.T
        sims[torch.arange(e - s), torch.arange(s, e)] = -2.0
        out[s:e] = sims.topk(k, dim=1).indices.cpu().numpy()
    return out


def per_query(idx: np.ndarray, rows: list[dict]) -> dict[str, np.ndarray]:
    """질의별 지표. 평균은 나중에 (부트스트랩을 위해 질의 단위로 남긴다)."""
    n = len(rows)
    isbn = [r["isbn13"] for r in rows]
    p_union = np.full(n, np.nan); r_union = np.full(n, np.nan); mrr = np.full(n, np.nan)
    p_co = np.full(n, np.nan); p_hard = np.full(n, np.nan); kdc = np.full(n, np.nan)
    p_mania = np.full(n, np.nan)
    for i, r in enumerate(rows):
        picks = [isbn[j] for j in idx[i]]
        if r["t_union"]:
            hits = [p in r["t_union"] for p in picks]
            p_union[i] = sum(hits) / TOP_K
            r_union[i] = sum(hits) / len(r["t_union"])
            first = next((k for k, h in enumerate(hits) if h), None)
            mrr[i] = 1 / (first + 1) if first is not None else 0.0
        if r["t_co"]:
            p_co[i] = sum(p in r["t_co"] for p in picks) / TOP_K
        if r["t_hard"]:
            p_hard[i] = sum(p in r["t_hard"] for p in picks) / TOP_K
        if r["t_mania"]:
            p_mania[i] = sum(p in r["t_mania"] for p in picks) / TOP_K
        if r["kdc3"]:
            same = [rows[j]["kdc3"] == r["kdc3"] for j in idx[i] if rows[j]["kdc3"]]
            if same:
                kdc[i] = np.mean(same)
    return {"P@10": p_union, "R@10": r_union, "MRR": mrr, "P@10 co_loan": p_co,
            "P@10 mania": p_mania, "P@10 hard": p_hard, "KDC3@10": kdc}


def recall_at(idx_wide: np.ndarray, rows: list[dict]) -> float:
    """상위 K(idx 폭) 안에 든 정답 비율의 평균. 후보 생성 단계의 지표."""
    isbn = [r["isbn13"] for r in rows]
    vals = []
    for i, r in enumerate(rows):
        if r["t_union"]:
            vals.append(sum(isbn[j] in r["t_union"] for j in idx_wide[i]) / len(r["t_union"]))
    return float(np.mean(vals)) if vals else float("nan")


def boot_ci(x: np.ndarray, seed: int = SEED) -> tuple[float, float, float]:
    x = x[~np.isnan(x)]
    if len(x) == 0:
        return (float("nan"),) * 3
    rng = np.random.default_rng(seed)
    means = np.array([x[rng.integers(0, len(x), len(x))].mean() for _ in range(BOOT)])
    return float(x.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def paired_diff(a: np.ndarray, b: np.ndarray, seed: int = SEED) -> tuple[float, float, float]:
    """같은 질의에서 a - b. 둘 다 값이 있는 질의만."""
    m = ~np.isnan(a) & ~np.isnan(b)
    d = a[m] - b[m]
    if len(d) == 0:
        return (float("nan"),) * 3
    rng = np.random.default_rng(seed)
    means = np.array([d[rng.integers(0, len(d), len(d))].mean() for _ in range(BOOT)])
    return float(d.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def summarize(pq: dict[str, np.ndarray]) -> dict:
    out = {}
    for k, v in pq.items():
        m, lo, hi = boot_ci(v)
        out[k] = {"mean": m, "lo": lo, "hi": hi, "n": int((~np.isnan(v)).sum())}
    return out


def baselines(rows: list[dict], text_arm: str = "T+D+KW+K", tfidf: bool = True) -> dict[str, np.ndarray]:
    """임베딩 없는 기준선들의 이웃 인덱스."""
    n = len(rows)
    rng = np.random.default_rng(SEED)
    out = {}

    # 무작위
    out["무작위"] = rng.integers(0, n, size=(n, TOP_K)).astype(np.int32)

    # 인기순 — 모두에게 대출 상위 10권 (자기 자신 제외)
    order = np.argsort([r["loan_rank"] for r in rows])
    pop = np.empty((n, TOP_K), dtype=np.int32)
    for i in range(n):
        top = [j for j in order[:TOP_K + 1] if j != i][:TOP_K]
        pop[i] = top
    out["인기순"] = pop

    # 같은 KDC3 무작위 · 같은 저자(대출순) 채우기
    by_kdc: dict[str, list[int]] = {}
    by_auth: dict[str, list[int]] = {}
    for i, r in enumerate(rows):
        if r["kdc3"]:
            by_kdc.setdefault(r["kdc3"], []).append(i)
        if r["author_key"]:
            by_auth.setdefault(r["author_key"], []).append(i)
    for v in by_auth.values():
        v.sort(key=lambda j: rows[j]["loan_rank"])
    kdc_idx = np.empty((n, TOP_K), dtype=np.int32)
    auth_idx = np.empty((n, TOP_K), dtype=np.int32)
    for i, r in enumerate(rows):
        cand = [j for j in by_kdc.get(r["kdc3"], []) if j != i] if r["kdc3"] else []
        pick = list(rng.choice(cand, min(TOP_K, len(cand)), replace=False)) if cand else []
        while len(pick) < TOP_K:
            j = int(rng.integers(0, n))
            if j != i:
                pick.append(j)
        kdc_idx[i] = pick
        a = [j for j in by_auth.get(r["author_key"], []) if j != i][:TOP_K] if r["author_key"] else []
        a += [j for j in kdc_idx[i] if j not in a][:TOP_K - len(a)]
        auth_idx[i] = a[:TOP_K]
    out["같은 KDC3 무작위"] = kdc_idx
    out["같은 저자 → KDC3"] = auth_idx

    if tfidf:
        out[f"TF-IDF({text_arm})"] = tfidf_neighbors(rows, text_arm, TOP_K)
    return out


def tfidf_neighbors(rows: list[dict], text_arm: str, k: int) -> np.ndarray:
    """문자 2~3gram TF-IDF 코사인 이웃. 어휘 겹침(인명·시리즈명·고유 주제어)을 그대로 쓰는 기준선."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    import torch
    n = len(rows)
    texts = [ARMS[text_arm](r) for r in rows]
    texts = [t if isinstance(t, str) else " ".join(t) for t in texts]
    X = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3), min_df=3, max_features=400_000,
                        sublinear_tf=True, dtype=np.float32).fit_transform(texts)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    idx = np.empty((n, k), dtype=np.int32)
    XT = X.T.tocsr()
    step = max(200, int(2e8 // n))          # 밀집 블록을 약 0.8GB 이하로
    for s in range(0, n, step):
        e = min(s + step, n)
        block = torch.from_numpy((X[s:e] @ XT).toarray()).to(dev)
        block[torch.arange(e - s), torch.arange(s, e)] = -2.0
        idx[s:e] = block.topk(k, dim=1).indices.cpu().numpy()
    return idx


def prefer_same(idx_wide: np.ndarray, rows: list[dict], key, k: int = TOP_K) -> np.ndarray:
    """넓은 후보(예: 상위 50)에서 질의와 같은 키(독자대상·KDC 대분류)를 가진 것을 앞으로 당긴다.
    질의의 키가 없으면 그대로. 임베딩 위에 구조 신호를 얹는 가장 값싼 방법."""
    n = len(rows)
    out = np.empty((n, k), dtype=np.int32)
    keys = [key(r) for r in rows]
    for i in range(n):
        q = keys[i]
        cand = list(idx_wide[i])
        if q:
            same = [j for j in cand if keys[j] == q]
            rest = [j for j in cand if keys[j] != q]
            cand = same + rest
        out[i] = cand[:k]
    return out


def rrf(*lists: np.ndarray, k: int = TOP_K, c: int = 60) -> np.ndarray:
    """역순위 융합. 각 목록의 순위 r 에 1/(c+r) 을 더해 상위 k 를 뽑는다."""
    n = len(lists[0])
    out = np.empty((n, k), dtype=np.int32)
    for i in range(n):
        score: dict[int, float] = {}
        for lst in lists:
            for r, j in enumerate(lst[i]):
                score[int(j)] = score.get(int(j), 0.0) + 1.0 / (c + r + 1)
        out[i] = sorted(score, key=lambda j: -score[j])[:k]
    return out


def save_topk(idx: np.ndarray, tag: str) -> None:
    d = STUDY / "topk"
    d.mkdir(parents=True, exist_ok=True)
    np.save(d / (re.sub(r"[^A-Za-z0-9+_-]", "_", tag) + ".npy"), idx)


def print_row(name: str, s: dict, extra: str = "") -> None:
    def f(k):
        v = s[k]
        return f"{100*v['mean']:5.2f} [{100*v['lo']:.2f},{100*v['hi']:.2f}]"
    print(f"  {name:<34} P@10 {f('P@10')}  hard {f('P@10 hard')}  "
          f"mania {100*s['P@10 mania']['mean']:5.2f}  R@10 {100*s['R@10']['mean']:5.2f}  "
          f"MRR {100*s['MRR']['mean']:5.2f}  KDC {100*s['KDC3@10']['mean']:5.1f}{extra}", flush=True)


# ══════════════════════════════════════════════════════════════════════
# screen — 모델 비교 (표본 A)
# ══════════════════════════════════════════════════════════════════════

def cmd_screen(args) -> int:
    rows_all = load_sample()
    splits = get_splits(rows_all)
    rows = take(rows_all, splits["A"], args.n)
    attach_truth(rows)
    tag = f"A{len(rows)}"
    scored = sum(1 for r in rows if r["t_union"])
    log(f"screen · 표본 A {len(rows):,}권 · 채점 가능 {scored:,}권 · "
        f"어려운 정답 보유 {sum(1 for r in rows if r['t_hard']):,}권")

    results = {"n": len(rows), "scored": scored, "arms": SCREEN_ARMS, "models": {}, "baselines": {}}
    prev = REPORTS / "screen.json"
    if prev.exists():
        results = json.loads(prev.read_text(encoding="utf-8"))
        results.setdefault("models", {}); results.setdefault("baselines", {})

    print("\n  기준선")
    for name, idx in baselines(rows, "T+D+KW+K").items():
        s = summarize(per_query(idx, rows))
        results["baselines"][name] = s
        save_topk(idx, f"{tag}__base__{name}")
        print_row(name, s)

    keys = args.models.split(",") if args.models else list(MODELS)
    for key in keys:
        if key in results["models"] and all(a in results["models"][key] for a in SCREEN_ARMS) and not args.redo:
            log(f"{key}: 결과 있음, 건너뜀")
            continue
        try:
            model = load_model(key)
        except Exception as e:
            log(f"{key}: 로딩 실패 {type(e).__name__}: {str(e)[:100]}")
            continue
        results["models"].setdefault(key, {})
        results["models"][key]["dim"] = int(model.get_sentence_embedding_dimension())
        print(f"\n  {key}  ({MODELS[key][0]} · {results['models'][key]['dim']}d)")
        for arm in SCREEN_ARMS:
            vec, rate = embed_arm(model, key, arm, rows, tag)
            idx = neighbors(vec)
            save_topk(idx, f"{tag}__{key}__{arm}")
            s = summarize(per_query(idx, rows))
            s["_rate"] = rate
            s["_trunc"] = truncation_rate(model, key, arm, rows)
            results["models"][key][arm] = s
            print_row(arm, s, f"  {rate:5.0f}/s 절단 {100*s['_trunc']:.0f}%")
            prev.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
        del model
        import torch; torch.cuda.empty_cache()

    prev.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"저장 {prev}")
    return 0


# ══════════════════════════════════════════════════════════════════════
# sweep — 입력 조합 비교 (표본 B)
# ══════════════════════════════════════════════════════════════════════

def cmd_sweep(args) -> int:
    rows_all = load_sample()
    splits = get_splits(rows_all)
    rows = take(rows_all, splits["B"], args.n)
    attach_truth(rows)
    tag = f"B{len(rows)}"
    scored = sum(1 for r in rows if r["t_union"])
    with_nl = sum(1 for r in rows if r["nl_text"])
    log(f"sweep · 표본 B {len(rows):,}권 · 채점 가능 {scored:,}권 · 국중 텍스트 보유 {with_nl:,}권")

    out_path = REPORTS / "sweep.json"
    results = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    results.update({"n": len(rows), "scored": scored, "with_nl": with_nl})
    results.setdefault("models", {}); results.setdefault("baselines", {})

    print("\n  기준선")
    for name, idx in baselines(rows, "T+D+KW+K", tfidf=False).items():
        results["baselines"][name] = summarize(per_query(idx, rows))
        save_topk(idx, f"{tag}__base__{name}")
        print_row(name, results["baselines"][name])
    # TF-IDF 는 입력 조합마다 — 어휘 겹침이 어느 필드에서 오는지 보기 위해
    for arm in args.tfidf_arms.split(","):
        name = f"TF-IDF({arm})"
        if name in results["baselines"] and not args.redo:
            print_row(name, results["baselines"][name], "  (캐시)")
            continue
        idx = tfidf_neighbors(rows, arm, TOP_K)
        results["baselines"][name] = summarize(per_query(idx, rows))
        save_topk(idx, f"{tag}__base__{name}")
        print_row(name, results["baselines"][name])
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

    arms = args.arms.split(",") if args.arms else list(ARMS)
    for key in args.models.split(","):
        model = load_model(key)
        results["models"].setdefault(key, {})
        print(f"\n  {key}")
        pqs = {}
        for arm in arms:
            if arm in results["models"][key] and not args.redo:
                idx = np.load(STUDY / "topk" / (re.sub(r"[^A-Za-z0-9+_-]", "_", f"{tag}__{key}__{arm}") + ".npy"))
                pqs[arm] = per_query(idx, rows)
                print_row(arm, results["models"][key][arm], "  (캐시)")
                continue
            vec, rate = embed_arm(model, key, arm, rows, tag)
            idx = neighbors(vec)
            save_topk(idx, f"{tag}__{key}__{arm}")
            pqs[arm] = per_query(idx, rows)
            s = summarize(pqs[arm]); s["_rate"] = rate
            results["models"][key][arm] = s
            print_row(arm, s, f"  {rate:5.0f}/s")
            out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
        # 짝 부트스트랩: 모든 조합을 기준 조합(T+D+KW+K)과 비교
        ref = "T+D+KW+K"
        if ref in pqs:
            print(f"\n  {key} · {ref} 대비 짝 차이 (P@10 · hard)")
            results["models"][key]["_paired_vs_ref"] = {}
            for arm, pq in pqs.items():
                if arm == ref:
                    continue
                d1 = paired_diff(pq["P@10"], pqs[ref]["P@10"])
                d2 = paired_diff(pq["P@10 hard"], pqs[ref]["P@10 hard"])
                results["models"][key]["_paired_vs_ref"][arm] = {"P@10": d1, "P@10 hard": d2}
                sig = lambda d: "유의" if (d[1] > 0 or d[2] < 0) else "  —"
                print(f"    {arm:<20} P@10 {100*d1[0]:+.2f} [{100*d1[1]:+.2f},{100*d1[2]:+.2f}] {sig(d1)}   "
                      f"hard {100*d2[0]:+.2f} [{100*d2[1]:+.2f},{100*d2[2]:+.2f}] {sig(d2)}")
        del model
        import torch; torch.cuda.empty_cache()

    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"저장 {out_path}")
    return 0


# ══════════════════════════════════════════════════════════════════════
# final — 검증 표본 C 에서 최종 수치 · 인기 구간별 · 국중 대체재
# ══════════════════════════════════════════════════════════════════════

def cmd_final(args) -> int:
    rows_all = load_sample()
    splits = get_splits(rows_all)
    if args.full:
        # 운영 그대로: 1단계 전체를 풀로. 각 책은 **있는 텍스트만으로** 임베딩된다.
        # 채점은 A·B 에서 본 책을 뺀 나머지에서만 (풀에는 남긴다 — 이웃 후보이므로).
        rows = [r for r in load_sample(need_all_sources=False) if r["title"]]
        tag = f"FULL{len(rows)}"
        seen = set(splits["A"]) | set(splits["B"])
        for r in rows:
            r["_holdout"] = r["isbn13"] not in seen
            r["_group"] = ("전 소스" if r["kw"] and len(r["desc"]) >= MIN_CHARS and len(r["kakao"]) >= MIN_CHARS
                           else "소개 둘 다(키워드 없음)" if len(r["desc"]) >= MIN_CHARS and len(r["kakao"]) >= MIN_CHARS
                           else "정보나루 소개만" if len(r["desc"]) >= MIN_CHARS
                           else "카카오 소개만" if len(r["kakao"]) >= MIN_CHARS
                           else "제목·서지만")
        from collections import Counter
        log(f"final(full) · 1단계 전체 {len(rows):,}권 · 채점 대상(A·B 제외) {sum(r['_holdout'] for r in rows):,}권")
        for g, c in Counter(r["_group"] for r in rows).most_common():
            print(f"    {g:22s} {c:>8,}  {c/len(rows):5.1%}")
    elif args.broad:
        # 키워드 없는 책까지 — 1단계 절반이 여기 속한다. A·B 에서 본 책은 뺀다.
        seen = set(splits["A"]) | set(splits["B"])
        rows = [r for r in load_sample(need_all_sources=False)
                if r["isbn13"] not in seen and r["title"]
                and len(r["desc"]) >= MIN_CHARS and len(r["kakao"]) >= MIN_CHARS]
        if args.n:
            random.Random(SEED).shuffle(rows)
            rows = rows[:args.n]
        tag = f"W{len(rows)}"
        log(f"final(broad) · 키워드 조건 없는 표본 {len(rows):,}권 · "
            f"키워드 보유 {sum(1 for r in rows if r['kw']):,}권")
    else:
        rows = take(rows_all, splits["C"], args.n)
        tag = f"C{len(rows)}"
    attach_truth(rows)
    log(f"final · 표본 {tag} {len(rows):,}권 · 채점 가능 {sum(1 for r in rows if r['t_union']):,}권")
    out = {"n": len(rows), "tag": tag, "model": args.model, "arm": args.arm,
           "arms": {}, "baselines": {}, "decile": {}, "hybrid": {}}

    print("\n  기준선")
    tf50 = None
    for name, idx in baselines(rows, args.arm, tfidf=False).items():
        out["baselines"][name] = summarize(per_query(idx, rows))
        print_row(name, out["baselines"][name])
    if not args.no_tfidf:
        tf50 = tfidf_neighbors(rows, args.arm, 50)
        out["baselines"][f"TF-IDF({args.arm})"] = summarize(per_query(tf50[:, :TOP_K], rows))
        print_row(f"TF-IDF({args.arm})", out["baselines"][f"TF-IDF({args.arm})"])

    model = load_model(args.model)
    arms = [args.arm] + [a for a in (args.compare.split(",") if args.compare else []) if a != args.arm]
    pqs = {}
    print(f"\n  {args.model}")
    for arm in arms:
        vec, rate = embed_arm(model, args.model, arm, rows, tag)
        idx50 = neighbors(vec, 50)
        idx = idx50[:, :TOP_K]
        save_topk(idx, f"{tag}__{args.model}__{arm}")
        pqs[arm] = per_query(idx, rows)
        s = summarize(pqs[arm]); s["_rate"] = rate
        s["R@50"] = recall_at(idx50, rows)          # 후보 생성 관점: 정답이 상위 50 안에 드는 비율
        out["arms"][arm] = s
        print_row(arm, s, f"  R@50 {100*s['R@50']:5.1f}  {rate:5.0f}/s")
        if tf50 is not None and arm == args.arm:
            out["baselines"][f"TF-IDF({args.arm})"]["R@50"] = recall_at(tf50, rows)
            print(f"    (TF-IDF R@50 {100*out['baselines'][f'TF-IDF({args.arm})']['R@50']:5.1f})")
        if tf50 is not None and arm == args.arm:
            # 하이브리드: 밀집 임베딩과 TF-IDF 의 역순위 융합
            fused = rrf(idx50, tf50)
            pqs["hybrid"] = per_query(fused, rows)
            out["hybrid"] = summarize(pqs["hybrid"])
            print_row(f"RRF({arm} ‖ TF-IDF)", out["hybrid"])
            d = paired_diff(pqs["hybrid"]["P@10"], pqs[arm]["P@10"])
            dh = paired_diff(pqs["hybrid"]["P@10 hard"], pqs[arm]["P@10 hard"])
            out["hybrid"]["_paired_vs_dense"] = {"P@10": d, "P@10 hard": dh}
            print(f"    하이브리드 − 밀집: P@10 {100*d[0]:+.2f} [{100*d[1]:+.2f},{100*d[2]:+.2f}]  "
                  f"hard {100*dh[0]:+.2f} [{100*dh[1]:+.2f},{100*dh[2]:+.2f}]")
        if arm == args.arm:
            # 구조 신호 얹기: 상위 50 안에서 같은 독자대상 / 같은 KDC 대분류를 앞으로
            out["rerank"] = {}
            variants = {
                "+독자대상 우선": lambda r: (r.get("n_audience") or ""),
                "+KDC 대분류 우선": lambda r: r["kdc3"][:1] if r["kdc3"] else "",
                "+독자대상+KDC1 우선": lambda r: ((r.get("n_audience") or "") + "/" + (r["kdc3"][:1] if r["kdc3"] else "")
                                           if r.get("n_audience") and r["kdc3"] else ""),
            }
            base_src = fused if tf50 is not None else idx50
            base_name = "RRF" if tf50 is not None else "밀집"
            for vname, keyf in variants.items():
                if tf50 is not None:
                    wide = rrf(idx50, tf50, k=50)
                else:
                    wide = idx50
                rer = prefer_same(wide, rows, keyf)
                pqs[f"{base_name}{vname}"] = per_query(rer, rows)
                out["rerank"][f"{base_name}{vname}"] = summarize(pqs[f"{base_name}{vname}"])
                print_row(f"{base_name}{vname}", out["rerank"][f"{base_name}{vname}"])

    if args.full:
        # 채점은 A·B 밖의 책만. 텍스트 보유 상태별로 나눠 본다.
        hold = np.array([r["_holdout"] for r in rows])
        groups = np.array([r["_group"] for r in rows])
        print(f"\n  텍스트 보유 상태별 (A·B 제외 채점)  —  {args.arm}")
        out["by_group"] = {}
        for pq_name, pq in list(pqs.items()) + [(k_, per_query(v, rows)) for k_, v in
                                                 baselines(rows, args.arm, tfidf=False).items()
                                                 if k_ in ("같은 저자 → KDC3",)]:
            print(f"    [{pq_name}]")
            out["by_group"][pq_name] = {}
            for g in ["전 소스", "소개 둘 다(키워드 없음)", "정보나루 소개만", "카카오 소개만", "제목·서지만", "전체"]:
                m = hold & ((groups == g) if g != "전체" else True)
                if not m.any():
                    continue
                vals = {k: boot_ci(v[m]) for k, v in pq.items()}
                out["by_group"][pq_name][g] = {k: {"mean": v[0], "lo": v[1], "hi": v[2]} for k, v in vals.items()}
                print(f"      {g:22s} P@10 {100*vals['P@10'][0]:5.2f} [{100*vals['P@10'][1]:.2f},{100*vals['P@10'][2]:.2f}]  "
                      f"hard {100*vals['P@10 hard'][0]:5.2f}  mania {100*vals['P@10 mania'][0]:5.2f}  "
                      f"KDC {100*vals['KDC3@10'][0]:5.1f}  (n={int(m.sum()):,})")
        # 이하 십분위·짝 비교도 채점 대상만으로
        keep = hold
        for pq in pqs.values():
            for k in pq:
                pq[k] = np.where(keep, pq[k], np.nan)

    # 인기 십분위별 (질의 책의 대출 순위 기준)
    ranks = np.array([r["loan_rank"] for r in rows])
    edges = np.quantile(ranks, np.linspace(0, 1, 11))
    print(f"\n  인기 십분위별 P@10 (1 = 가장 많이 빌린 10%)  —  {args.arm}")
    pq = pqs[args.arm]
    for d in range(10):
        m = (ranks >= edges[d]) & (ranks <= edges[d + 1])
        vals = {k: float(np.nanmean(v[m])) for k, v in pq.items()}
        out["decile"][d + 1] = vals
        print(f"    {d+1:>2}  P@10 {100*vals['P@10']:5.2f}  hard {100*vals['P@10 hard']:5.2f}  "
              f"KDC {100*vals['KDC3@10']:5.1f}   (n={int(m.sum()):,})")

    for a in arms[1:]:
        d1 = paired_diff(pqs[a]["P@10"], pq["P@10"])
        out["arms"][a]["_paired_vs_main"] = d1
        print(f"\n  {a} − {args.arm}: P@10 {100*d1[0]:+.2f} [{100*d1[1]:+.2f},{100*d1[2]:+.2f}]")

    path = REPORTS / (f"final_full_{args.model}.json" if args.full else f"final_broad_{args.model}.json" if args.broad
                      else f"final_{args.model}.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"저장 {path}")
    return 0


# ══════════════════════════════════════════════════════════════════════
# examples — 유명한 책 몇 권의 이웃을 눈으로 본다 (저장된 topk 재사용, 재계산 없음)
# ══════════════════════════════════════════════════════════════════════

def cmd_examples(args) -> int:
    rows_all = load_sample()
    splits = get_splits(rows_all)
    rows = take(rows_all, splits[args.split], args.n)
    attach_truth(rows)
    tag = f"{args.split}{len(rows)}"
    by_rank = sorted(range(len(rows)), key=lambda i: rows[i]["loan_rank"])
    rng = random.Random(args.seed)
    picks = []
    if args.isbn:
        idx_of = {r["isbn13"]: i for i, r in enumerate(rows)}
        picks = [idx_of[x] for x in args.isbn.split(",") if x in idx_of]
    if not picks:
        # 대출 상위 300 안에서 무작위 — "유명한 책". 정답이 있는 것만.
        top = [i for i in by_rank[:300] if rows[i]["t_union"]]
        picks = rng.sample(top, min(args.k, len(top)))

    methods = []
    for arm in args.tfidf_arms.split(","):
        if arm:
            methods.append((f"TF-IDF {arm}", f"{tag}__base__TF-IDF({arm})"))
    for key in args.models.split(","):
        for arm in args.arms.split(","):
            methods.append((f"{key} {arm}", f"{tag}__{key}__{arm}"))
    loaded = {}
    for name, fn in methods:
        p = STUDY / "topk" / (re.sub(r"[^A-Za-z0-9+_-]", "_", fn) + ".npy")
        if p.exists():
            loaded[name] = np.load(p)
        else:
            log(f"없음: {fn}")

    def short(r, n=26):
        t = re.sub(r"\s*[:：].*$", "", r["title"])
        a = (r["author"] or "").split(";")[0].split(",")[0].strip()
        a = re.sub(r"\s*(지음|글|저|옮김|그림|엮음)\s*$", "", a)[:8]
        return (t[:n] + ("…" if len(t) > n else "")) + (f" — {a}" if a else "")

    out_lines = []
    for i in picks:
        r = rows[i]
        head = (f"\n▶ {short(r, 40)}  (대출 순위 {r['loan_rank']:,} · KDC {r['kdc3']} · "
                f"정답 {len(r['t_union'])}권, 어려운 정답 {len(r['t_hard'])}권)")
        print(head); out_lines.append(head)
        truth_titles = [short(rows[j]) for j in range(len(rows)) if rows[j]["isbn13"] in r["t_union"]][:6]
        line = "   정답 예: " + " · ".join(truth_titles)
        print(line); out_lines.append(line)
        for name, idx in loaded.items():
            items = []
            for j in idx[i][:args.top]:
                nb = rows[j]
                mark = "✓" if nb["isbn13"] in r["t_hard"] else ("○" if nb["isbn13"] in r["t_union"] else " ")
                items.append(f"{mark}{short(nb)}")
            hits = sum(1 for j in idx[i][:TOP_K] if rows[j]["isbn13"] in r["t_union"])
            line = f"   [{name:<22}] {hits}/10  " + " | ".join(items)
            print(line); out_lines.append(line)
    (REPORTS / f"examples_{tag}.txt").write_text("\n".join(out_lines), encoding="utf-8")
    print("\n  ✓ 어려운 정답(다른 시리즈·다른 저자)  ○ 쉬운 정답(같은 시리즈/저자)  공백 = 정답 아님")
    return 0


# ══════════════════════════════════════════════════════════════════════
# 진입점
# ══════════════════════════════════════════════════════════════════════

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    sub.add_parser("labels")
    s = sub.add_parser("screen"); s.add_argument("--n", type=int, default=20000)
    s.add_argument("--models", default=""); s.add_argument("--redo", action="store_true")
    s = sub.add_parser("sweep"); s.add_argument("--n", type=int, default=40000)
    s.add_argument("--models", required=True); s.add_argument("--arms", default="")
    s.add_argument("--tfidf-arms", default="T+D+KW+K,T+D+K,T+KW,KW,TAP")
    s.add_argument("--redo", action="store_true")
    s = sub.add_parser("final"); s.add_argument("--n", type=int, default=0)
    s.add_argument("--model", required=True); s.add_argument("--arm", required=True)
    s.add_argument("--compare", default=""); s.add_argument("--no-tfidf", action="store_true")
    s.add_argument("--broad", action="store_true", help="키워드 조건을 빼고 A·B 밖의 책으로 잰다")
    s.add_argument("--full", action="store_true", help="1단계 34만 권 전체를 풀로 (운영 그대로)")
    s = sub.add_parser("examples"); s.add_argument("--split", default="B"); s.add_argument("--n", type=int, default=40000)
    s.add_argument("--models", default="sroberta,e5-large"); s.add_argument("--arms", default="T+D+KW+K")
    s.add_argument("--tfidf-arms", default="T+D+KW+K"); s.add_argument("--k", type=int, default=5)
    s.add_argument("--top", type=int, default=5); s.add_argument("--seed", type=int, default=7)
    s.add_argument("--isbn", default="")
    args = p.parse_args()
    return {"prepare": cmd_prepare, "labels": cmd_labels, "screen": cmd_screen,
            "sweep": cmd_sweep, "final": cmd_final, "examples": cmd_examples}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
