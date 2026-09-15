"""검색 색인 층과 추천 후보 층을 만든다.
  검색 색인 = 기존 L1 (큐 = 누적 대출 72+ ∪ 신간, books 안 약 105만) → catalog_layer CORE/NEW/TAIL
  추천 후보 = 「누적 대출 90% 커버리지(843+) ∪ 신간」에서 전자책·학습참고서·교과서·신호 없는 책을 뺀 집합 → is_candidate (약 44만)

  python scripts/build_candidates.py --snapshot ../project_personal/snapshots/2026-09-10 [--coverage 0.90 | --threshold 843]
                                     [--load ../project_personal/load] [--out ../project_personal/candidates/<날짜>]

왜 (2026-09-15 결정)
  · books(L0 331만) 는 메타데이터로 남긴다. L0 만 구간 226만 권은 93% 가 소개·표지가 없고 수요의 0.97% 라 검색·추천에 기여가 없다.
  · 검색은 기존 L1 을 그대로 색인한다(사용자가 아는 책은 찾혀야 한다). 추천 후보만 90% 층으로 좁힌다 — 기존 L1 의 3단계 꼬리 56.6만 권은
    키워드 3.5%·함께대출 40% 로 신호가 약해 임베딩·이웃 탐색에서 잡음이 된다.
  · 임계는 원장 누적 대출의 90% 지점(09-15 실측 843) — 곡선은 스냅샷마다 조금 움직이므로 manifest 에 실제 값을 고정한다.

산출물 (out/)
  d4l_usage.candidates.jsonl.gz   정보나루 스냅샷과 **같은 형식**(줄을 그대로 복사) · 포함 ISBN 만 · isbn13 중복 제거(desc 가 긴 줄) — ai/ 의 d4l-usage 계약 그대로 읽힌다
  kakao_enriched.candidates.jsonl.gz  카카오 스냅샷의 같은 부분집합 (두 번째 소개문·표지 원문)
  candidates.csv                  L1 전체 한 줄씩: isbn13, layer(CORE/NEW/TAIL), loan_cum, pub_year, include(=추천 후보), exclude_reason, has_desc, has_cover, has_keywords, has_relations
                                  검색 색인 대상 = 모든 줄(layer 있음) · 추천 후보 = include=true
  manifest.json                   임계·규칙·건수·입력/출력 SHA-256

DB 반영: candidates.csv 를 load_service_tables.sh --only candidates 가 books.catalog_layer / is_candidate / candidate_exclusion 에 넣는다 (V5 마이그레이션 뒤).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(os.environ.get("PIPELINE_DATA") or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()

# ── 제외 규칙 ────────────────────────────────────────────────────────────────
# 09-15 표본 감사로 조정했다. 부가기호 독자대상 5·6(학습참고서)만으로는 「용선생 만화 한국사」·「쿠키런 어드벤처」·Eloise 영어동화가
# 잡혀서 단독으로 쓰지 않는다. 국중 EBOOK_YN='Y' 3,538권은 원장에 실물 대출이 수만 건 있어(같은 ISBN 을 전자책에도 쓴 경우) 제외하지 않는다.
RE_EBOOK = r"(전자책|e-?book|E-?BOOK|eBook|\[전자자료\]|전자자료)"
RE_TEXTBOOK = r"^\(?(초등학교|중학교|고등학교)\)?\s"           # 「(중학교) 사회」류 교과서·평가문제집
RE_STUDY = (r"(문제집|기출\s*문제|기출문제|모의고사|평가문제|워크북|익힘책|정답\s*(과|및)?\s*해설|해설집|자습서|단원\s*평가|전국연합|학력평가"
            r"|시험\s*대비|실전\s*문제|예상\s*문제|적중\s*문제|출제\s*예상|필기\s*(시험|문제)|실기\s*(시험|문제)|최신\s*기출|모의\s*평가"
            r"|수능\s*특강|수능\s*완성|EBS\s*수능|개념\s*원리|블랙라벨|자이스토리|마더텅|검정고시|한국사능력검정|한능검"
            r"|토익|TOEIC|토플|TOEFL|텝스|TEPS|HSK|JLPT|JPT|오픽|OPIc|공인중개사|주택관리사|전기기사|산업기사|기능사|기술사"
            r"|공무원\s*(시험|기출|수험)|소방설비|소방학개론|NCS)")
RE_STUDY_GUARD = r"(소설|동화|에세이|만화|수기|이야기|토플러)"      # 「무서운 문제집」(동화) · 「나의 토익 만점 수기 : 장편소설」· 「토플러」
# RE2(DuckDB) 는 lookahead 가 없어 guard 를 별도 조건으로 둔다. KDC 8xx(문학) 은 제목 규칙에서 제외한다.


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--load", default=str(BASE / "load"))
    ap.add_argument("--ledger", default=str(BASE / "data4library" / "books_dedup.parquet"))
    ap.add_argument("--nl", default=str(BASE / "nl_books_enriched.parquet"))
    ap.add_argument("--coverage", type=float, default=0.90, help="원장 누적 대출 커버리지 (임계를 여기서 유도)")
    ap.add_argument("--threshold", type=int, default=0, help="임계 직접 지정 (coverage 무시)")
    ap.add_argument("--out", default=str(BASE / "candidates" / datetime.now().strftime("%Y-%m-%d")))
    a = ap.parse_args()

    import duckdb

    snap, load, out = Path(a.snapshot), Path(a.load), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("set threads to 8")
    log(f"스냅샷 {snap} · load {load} · out {out}")

    # ── 1 원장·임계 ───────────────────────────────────────────────────────────
    con.execute(f"create table led as select isbn13, coalesce(loans,0)::bigint lc, pub_year py from read_parquet('{a.ledger.replace(os.sep, '/')}')")
    total = con.execute("select sum(lc) from led").fetchone()[0]
    if a.threshold:
        thr = a.threshold
    else:
        thr = con.execute(f"""select lc from (select lc, sum(sum(lc)) over (order by lc desc) cs from led group by lc)
                              where cs >= {a.coverage} * {total} order by lc desc limit 1""").fetchone()[0]
    cov = con.execute(f"select sum(lc) * 1.0 / {total} from led where lc >= {thr}").fetchone()[0]
    log(f"원장 {con.execute('select count(*) from led').fetchone()[0]:,}종 · 누적 {total:,} · 임계 {thr}+ (커버리지 {cov:.4f})")

    # ── 2 모집단 = books ∩ (임계 이상 ∪ 신간 큐 2단계) ────────────────────────
    con.execute(f"create table q as select isbn13, tier from read_csv_auto('{(snap / 'enrich_queue.csv').as_posix()}', all_varchar=true)")
    con.execute(f"""create table b as select isbn13, title, author, publisher, pub_year, category_code,
        (description is not null and description <> '') has_desc, (cover_url is not null and cover_url <> '') has_cover
        from read_csv('{(load / 'books.csv.gz').as_posix()}', header=true, all_varchar=true)""")
    con.execute(f"create table kw as select distinct isbn13 from read_csv('{(load / 'book_keywords.csv.gz').as_posix()}', header=true, all_varchar=true)")
    con.execute(f"create table rel as select distinct isbn13 from read_csv('{(load / 'book_relations.csv.gz').as_posix()}', header=true, all_varchar=true)")
    con.execute(f"create table nl as select isbn13_norm isbn13, any_value(add_audience) add_audience from read_parquet('{a.nl.replace(os.sep, '/')}') group by 1")
    # ── 2' 층: CORE = 임계 이상 · NEW = 신간(큐 2단계, 임계 미만) · TAIL = 그 외 L1(큐 소속) — 셋 다 검색 색인 대상. 추천 후보 판정은 CORE·NEW 에만 한다
    con.execute(f"""create table c as
        select b.*, coalesce(led.lc, 0) lc,
               case when coalesce(led.lc, 0) >= {thr} then 'CORE' when q.tier = '2' then 'NEW' else 'TAIL' end layer,
               nl.add_audience, kw.isbn13 is not null has_kw, rel.isbn13 is not null has_rel
        from b left join led using(isbn13) left join q using(isbn13) left join nl using(isbn13) left join kw using(isbn13) left join rel using(isbn13)
        where coalesce(led.lc, 0) >= {thr} or q.isbn13 is not null""")

    # ── 3 제외 규칙 (앞 규칙이 이긴다) ───────────────────────────────────────
    con.execute(f"""alter table c add column exclude_reason varchar;
        update c set exclude_reason = case
          when layer = 'TAIL' then null
          when regexp_matches(title, '{RE_EBOOK}') then 'EBOOK'
          when regexp_matches(title, '{RE_TEXTBOOK}') then 'TEXTBOOK'
          when (regexp_matches(title, '{RE_STUDY}') and not regexp_matches(title, '{RE_STUDY_GUARD}') and coalesce(category_code, '') not like '8%')
            or (add_audience in ('5', '6') and coalesce(category_code, '') like '37%') then 'STUDY_AID'
          when not has_desc and not has_cover and not has_kw and not has_rel then 'NO_SIGNAL'
        end""")
    stats = {r[0] or "INCLUDED": r[1] for r in con.execute("select exclude_reason, count(*) from c where layer <> 'TAIL' group by 1").fetchall()}
    by_layer = {f"{r[0]}_{r[1] or ('INCLUDED' if r[0] != 'TAIL' else 'SEARCH_ONLY')}": r[2]
                for r in con.execute("select layer, exclude_reason, count(*) from c group by 1, 2").fetchall()}
    n_search = con.execute("select count(*) from c").fetchone()[0]
    n_tail = con.execute("select count(*) from c where layer = 'TAIL'").fetchone()[0]
    log(f"검색 층(L1) {n_search:,} (TAIL {n_tail:,}) · 후보 모집단 {sum(stats.values()):,} → 포함 {stats.get('INCLUDED', 0):,} · 제외 " +
        " · ".join(f"{k} {v:,}" for k, v in stats.items() if k != "INCLUDED"))

    con.execute(f"""copy (select isbn13, layer, lc as loan_cum, pub_year, (layer <> 'TAIL' and exclude_reason is null) as include, coalesce(exclude_reason, '') exclude_reason,
                            has_desc, has_cover, has_kw as has_keywords, has_rel as has_relations
                     from c order by layer, lc desc, isbn13) to '{(out / 'candidates.csv').as_posix()}' (header, delimiter ',')""")
    include = {r[0] for r in con.execute("select isbn13 from c where layer <> 'TAIL' and exclude_reason is null").fetchall()}

    # ── 4 스냅샷 부분집합 — 줄을 그대로 복사 (형식 동일). isbn13 중복은 desc 가 긴 줄을 남긴다 (ai/d4l.py 는 중복이면 DataError) ──
    def subset(src: Path, dst: Path, want_ok: bool) -> tuple[int, int]:
        best: dict[str, tuple[int, int]] = {}          # isbn -> (score, line_no)
        with gzip.open(src, "rt", encoding="utf-8") as f:
            for n, line in enumerate(f):
                i = line.find('"isbn13"')
                if i < 0:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                isbn = o.get("isbn13")
                if isbn not in include:
                    continue
                if want_ok and not (o.get("ok") and (o.get("bookname") or o.get("title"))):
                    continue
                score = len(o.get("desc") or o.get("contents") or "") + (1 if o.get("ok") else 0)
                if isbn not in best or score > best[isbn][0]:
                    best[isbn] = (score, n)
        keep = {ln for _, ln in best.values()}
        written = 0
        with gzip.open(src, "rt", encoding="utf-8") as f, gzip.open(dst, "wt", encoding="utf-8", compresslevel=1) as g:
            for n, line in enumerate(f):
                if n in keep:
                    g.write(line if line.endswith("\n") else line + "\n")
                    written += 1
        return written, len(include) - written

    d4l_n, d4l_miss = subset(snap / "d4l_usage.jsonl.gz", out / "d4l_usage.candidates.jsonl.gz", want_ok=True)
    log(f"d4l 부분집합 {d4l_n:,}줄 (포함 ISBN 중 정보나루 레코드 없음 {d4l_miss:,})")
    kk_n, kk_miss = subset(snap / "kakao_enriched.jsonl.gz", out / "kakao_enriched.candidates.jsonl.gz", want_ok=False)
    log(f"kakao 부분집합 {kk_n:,}줄 (없음 {kk_miss:,})")

    # ── 5 manifest ───────────────────────────────────────────────────────────
    manifest = {
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "snapshot": snap.as_posix(),
        "threshold_loan_cum": int(thr), "coverage_target": a.coverage, "coverage_actual": round(float(cov), 4),
        "layers": {"CORE": f"원장 누적 대출 >= {thr}", "NEW": "큐 2단계 신간(pub_year 2025+, 임계 미만)", "TAIL": "그 외 L1(큐 소속, 누적 72+) — 검색 색인만, 추천 후보 아님"},
        "search_index": {"rule": "catalog_layer IS NOT NULL (= L1 전체)", "count": n_search},
        "recommendation_candidates": {"rule": "layer IN (CORE, NEW) AND exclude_reason IS NULL", "count": stats.get("INCLUDED", 0)},
        "exclusion_rules": {"EBOOK": RE_EBOOK, "TEXTBOOK": RE_TEXTBOOK, "STUDY_AID": {"title": RE_STUDY, "guard_not": RE_STUDY_GUARD, "not_kdc": "8xx",
                            "or": "부가기호 독자대상 5·6 ∧ KDC 37x"}, "NO_SIGNAL": "소개·표지·키워드·관계 전부 없음"},
        "counts": {"search_layer": n_search, "tail": n_tail, "candidate_population": sum(stats.values()), **{k: v for k, v in stats.items()}, "by_layer": by_layer,
                   "d4l_lines": d4l_n, "d4l_missing": d4l_miss, "kakao_lines": kk_n, "kakao_missing": kk_miss},
        "inputs": {p.name: sha256(p) for p in [snap / "d4l_usage.jsonl.gz", snap / "kakao_enriched.jsonl.gz", snap / "enrich_queue.csv", load / "books.csv.gz"]},
        "outputs": {p.name: sha256(p) for p in [out / "candidates.csv", out / "d4l_usage.candidates.jsonl.gz", out / "kakao_enriched.candidates.jsonl.gz"]},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"완료 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
