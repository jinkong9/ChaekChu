#!/usr/bin/env python3
"""V1 서비스 테이블 적재 파일 빌드 — 스냅샷 → load/books.csv.gz · load/book_tags.csv.gz

읽는 것 (모두 파일, DB 아님)
  스냅샷   d4l_usage.jsonl(.gz) · kakao_enriched.jsonl(.gz) · enrich_queue.csv        ← EC2 snapshots/<날짜>/ 회수본
  로컬     books_dedup.parquet (정보나루 원장 295만 종) · nl_books_enriched.parquet (국중 서지·부가기호)

범위 (--scope)
  L0 (기본)  원장 전체 ∪ 국중에만 있는 책(전자책 제외)  ≈ 350만   ← 검색·찜 표면 (결정 1). 카탈로그
  L1         enrich_queue 의 110만                       ← 추천 후보. L0 가 L1 으로 대체될 수 있어 스위치로 둔다 (09-09)

컬럼 우선순위 (계약 §5.1 · 임베딩 연구 §3.3)
  title/author/publisher/pub_year   원장 최빈값 → 정보나루 usage → 국중 → 카카오
  category_code (KDC)               원장 → 정보나루 class_no → 국중 부가기호 대분류(3자리)
  description                       정보나루 desc(60자+) → 카카오 contents(60자+) → 형제 권(제목 어간+출판사) 의 소개 → NULL
  cover_url                         정보나루 img → 카카오 thumbnail
book_tags                           KDC → 12개 장르 태그 (V1_1__seed_tags 와 같은 코드). 규칙은 KDC_TAGS.

실행
  py scripts/build_service_tables.py --snapshot ../project_personal/snapshots/2026-09-09 [--scope L0|L1] [--out ../project_personal/load]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA") or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
MIN_CHARS = 60

# KDC 3자리 접두 → 태그. 8x1 시 · 8x3 소설 · 8x4 수필 (x = 언어권 1~9). 겹치면 둘 다 붙는다.
KDC_TAGS = {
    "FICTION":    [f"8{x}3" for x in range(1, 10)] + ["808.3", "809.3"],
    "POETRY":     [f"8{x}1" for x in range(1, 10)],
    "ESSAY":      [f"8{x}4" for x in range(1, 10)] + ["818", "828", "838", "848"],
    "TRAVEL":     [f"98{x}" for x in range(0, 10)] + [f"8{x}6" for x in range(1, 10)],
    "HISTORY":    [f"9{x}" for x in range(0, 8)],             # 900~979 (98x 지리는 TRAVEL)
    "HUMANITIES": [f"1{x}" for x in range(0, 9)],             # 100~189 철학·심리·윤리
    "SELF_HELP":  ["199", "189"],                              # 인생훈·교훈, 응용심리
    "SCIENCE":    [f"4{x}" for x in range(0, 10)],
    "ART":        [f"6{x}" for x in range(0, 10)],
    "BUSINESS":   ["320", "321", "322", "323", "324", "325", "326", "327"],
    "SOCIETY":    ["30", "31", "33", "34", "35", "36", "37", "38", "39"],
    "TECH":       [f"5{x}" for x in range(0, 10)] + ["004", "005"],
}

ROLE_WORDS = "지은이|지음|글쓴이|글|그림|옮긴이|옮김|번역|편역|역자|역|저자|저|편저|편집|편|엮음|엮은이|사진|감수|기획|원작|각색|구성|해설|만화|작가|외"
ROLE = re.compile(rf"\s*({ROLE_WORDS})\s*[:：]?\s*")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def clean_author(raw: str) -> str:
    """'지은이: 한강;그림: 김OO' → '한강 · 김OO'. 역할어 제거, 세미콜론·쉼표 분리, 중복 제거, 300자."""
    if not raw:
        return ""
    parts = []
    for p in re.split(r"[;,/]", raw):
        p = ROLE.sub(" ", p).strip(" .·")
        p = re.sub(r"\s+", " ", p)
        if p and p not in parts and len(p) <= 60:
            parts.append(p)
    return " · ".join(parts)[:300]


def flatten_d4l(src: Path, dst: Path) -> int:
    """중첩 응답을 평평한 파케이용 JSONL 로. 같은 ISBN 은 마지막 레코드."""
    rows = {}
    opener = gzip.open if src.suffix == ".gz" else open
    with opener(src, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not r.get("ok") or not r.get("isbn13"):
                continue
            kws = r.get("keywords") or []
            rows[r["isbn13"]] = {
                "isbn13": r["isbn13"],
                "d_title": (r.get("bookname") or "").strip(),
                "d_authors": clean_author(r.get("authors") or ""),
                "d_publisher": (r.get("publisher") or "").strip(),
                "d_pub_year": (r.get("pub_year") or "")[:4],
                "d_class_no": (r.get("class_no") or "").strip(),
                "d_desc": re.sub(r"\s+", " ", r.get("desc") or "").strip(),
                "d_img": (r.get("img") or "").strip(),
                "d_keywords": json.dumps([[w, wt] for w, *rest in ((k[0], *k[1:]) for k in kws if isinstance(k, list) and k) for wt in [rest[0] if rest else None]], ensure_ascii=False) if kws else "[]",
                "co_loan": json.dumps([x[0] for x in (r.get("co_loan") or []) if isinstance(x, list) and x]),
                "mania_rec": json.dumps([x[0] for x in (r.get("mania_rec") or []) if isinstance(x, list) and x]),
                "reader_rec": json.dumps([x[0] for x in (r.get("reader_rec") or []) if isinstance(x, list) and x]),
                "loan_total": r.get("loan_total") or 0,
            }
    with dst.open("w", encoding="utf-8") as f:
        for r in rows.values():
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return len(rows)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--scope", choices=["L0", "L1"], default="L0")
    ap.add_argument("--out", default=str(BASE / "load"))
    ap.add_argument("--ledger", default=str(BASE / "data4library" / "books_dedup.parquet"))
    ap.add_argument("--nl", default=str(BASE / "nl_books_enriched.parquet"))
    args = ap.parse_args()
    import duckdb

    snap = Path(args.snapshot); out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    d4l = next(p for p in [snap / "d4l_usage.jsonl.gz", snap / "d4l_usage.jsonl"] if p.exists())
    kakao = next(p for p in [snap / "kakao_enriched.jsonl.gz", snap / "kakao_enriched.jsonl"] if p.exists())
    queue = snap / "enrich_queue.csv"
    log(f"스냅샷 {snap} · 범위 {args.scope}")

    flat = out / "_d4l_flat.jsonl"
    if flat.exists() and flat.stat().st_mtime > d4l.stat().st_mtime:
        log(f"정보나루 평탄화 재사용 {flat.name}")
    else:
        n = flatten_d4l(d4l, flat)
        log(f"정보나루 평탄화 {n:,}권")

    con = duckdb.connect()
    con.sql(f"""create table d as select * from read_json('{flat.as_posix()}', format='newline_delimited',
      columns={{'isbn13':'VARCHAR','d_title':'VARCHAR','d_authors':'VARCHAR','d_publisher':'VARCHAR','d_pub_year':'VARCHAR',
               'd_class_no':'VARCHAR','d_desc':'VARCHAR','d_img':'VARCHAR','d_keywords':'VARCHAR','co_loan':'VARCHAR',
               'mania_rec':'VARCHAR','reader_rec':'VARCHAR','loan_total':'BIGINT'}})""")
    con.sql(f"""create table k as
      select isbn13, any_value(title) k_title, any_value(list_aggregate(authors, 'string_agg', ' · ')) k_authors,
             any_value(publisher) k_publisher, any_value(substr(cast(datetime as varchar),1,4)) k_year,
             any_value(regexp_replace(contents, '\\s+', ' ', 'g')) k_contents, any_value(thumbnail) k_thumb
      from read_json('{kakao.as_posix()}', format='newline_delimited', union_by_name=true, ignore_errors=true,
                     maximum_object_size=4000000)
      where ok and isbn13 is not null group by 1""")
    con.sql(f"""create table l as select isbn13, title l_title, author l_author, publisher l_publisher,
             pub_year l_year, kdc l_kdc, loans l_loans from '{args.ledger}'""")
    con.sql(f"""create table nl as select isbn13_norm isbn13, any_value(TITLE) n_title, any_value(AUTHOR) n_author,
             any_value(PUBLISHER) n_publisher, any_value(pub_year) n_year, any_value(add_kdc3) n_kdc3,
             any_value(EBOOK_YN) n_ebook from '{args.nl}' where isbn13_norm is not null group by 1""")
    con.sql(f"create table q as select isbn13, tier from read_csv('{queue.as_posix()}')")

    if args.scope == "L1":
        con.sql("create table u as select isbn13 from q")
    else:
        con.sql("""create table u as
          select isbn13 from l
          union select nl.isbn13 from nl left join l using(isbn13) where l.isbn13 is null and coalesce(nl.n_ebook,'N') <> 'Y'""")
    con.sql("delete from u where not regexp_matches(isbn13, '^(978|979)[0-9]{10}$')")
    # ISBN-13 체크섬: 홀수 자리 ×1, 짝수 자리 ×3, 합이 10 의 배수. 원장에 9780000000000 같은 자리표시 ISBN 이 섞여 있다.
    con.sql("""create macro isbn13_ok(s) as (
        (list_sum(list_transform(range(1, 14), i -> cast(substr(s, i, 1) as int) * (case when i % 2 = 1 then 1 else 3 end))) % 10) = 0)""")
    bad = con.sql("select count(*) from u where not isbn13_ok(isbn13)").fetchone()[0]
    con.sql("delete from u where not isbn13_ok(isbn13)")
    log(f"체크섬 불일치 ISBN 제외 {bad:,}")
    n_u = con.sql("select count(*) from u").fetchone()[0]
    log(f"범위 {args.scope}: {n_u:,} ISBN")

    # 저자 정제를 SQL 로 (Python UDF 는 350만 행에서 단일 스레드 30분+ 였다)
    con.sql(r"""create macro clean_author(s) as left(list_aggregate(list_distinct(list_filter(
        list_transform(string_split_regex(coalesce(s, ''), '[;,/]'),
            x -> trim(regexp_replace(regexp_replace(x,
                 '\s*(""" + ROLE_WORDS + r""")\s*[:：]?\s*', ' ', 'g'),
                 '\s+', ' ', 'g'), ' .·')),
        x -> x <> '' and length(x) <= 60)), 'string_agg', ' · '), 300)""")
    log("조인·정제 시작")
    con.sql(f"""create table b as
      select u.isbn13,
        left(coalesce(nullif(trim(l.l_title),''), nullif(d.d_title,''), nullif(trim(nl.n_title),''), nullif(trim(k.k_title),'')), 500) title,
        left(coalesce(nullif(clean_author(l.l_author),''), nullif(d.d_authors,''), nullif(clean_author(nl.n_author),''), nullif(trim(k.k_authors),'')), 300) author,
        left(coalesce(nullif(trim(l.l_publisher),''), nullif(d.d_publisher,''), nullif(trim(nl.n_publisher),''), nullif(trim(k.k_publisher),'')), 200) publisher,
        (select y from (select coalesce(l.l_year, try_cast(d.d_pub_year as int), nl.n_year, try_cast(k.k_year as int)) y) where y between 1000 and 2100) pub_year,
        left(coalesce(nullif(regexp_extract(l.l_kdc, '^([0-9]{{3}}(\\.[0-9]+)?)', 1),''),
                      nullif(regexp_extract(d.d_class_no, '^([0-9]{{3}}(\\.[0-9]+)?)', 1),''),
                      nullif(regexp_extract(nl.n_kdc3, '^([0-9]{{3}})', 1),'')), 10) category_code,
        case when length(d.d_desc) >= {MIN_CHARS} then d.d_desc when length(k.k_contents) >= {MIN_CHARS} then k.k_contents end description,
        case when length(d.d_desc) >= {MIN_CHARS} then 'DATA4LIBRARY' when length(k.k_contents) >= {MIN_CHARS} then 'KAKAO' end description_source,
        left(coalesce(nullif(d.d_img,''), nullif(k.k_thumb,'')), 500) cover_url,
        q.tier
      from u left join l using(isbn13) left join d using(isbn13) left join nl using(isbn13) left join k using(isbn13) left join q using(isbn13)""")
    con.sql("delete from b where title is null or title = ''")

    # 형제 권 소개 빌려오기: 제목 어간 + 출판사 그룹에서 가장 긴 소개
    con.sql("""alter table b add column stem varchar;
      update b set stem = regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(title, '\\s*[:：].*$', ''),
        '[\\(\\[（【].*?[\\)\\]）】]', ' ', 'g'), '[0-9０-９]+\\s*(권|편|부|장|호|집|단계|급)?|제\\s*[0-9]+|vol\\.?\\s*[0-9]+|\\(상\\)|\\(하\\)', ' ', 'g')),
        '[^0-9a-z가-힣]', '', 'g') || '|' || lower(coalesce(publisher, ''))""")
    con.sql("""create table sib as
      select stem, arg_max(description, length(description)) sib_desc from b
      where description is not null and stem not like '|%' and length(stem) > 3 group by stem""")
    before = con.sql("select count(*) from b where description is null").fetchone()[0]
    con.execute("""update b set description = sib.sib_desc, description_source = 'SIBLING'
      from sib where b.stem = sib.stem and b.description is null""")
    after = con.sql("select count(*) from b where description is null").fetchone()[0]
    log(f"형제 권 소개 빌려온 책 {before - after:,}")

    books_csv = out / "books.csv.gz"
    con.sql(f"""copy (select isbn13, title, author, publisher, pub_year, category_code, description, cover_url
                    from b order by isbn13) to '{books_csv.as_posix()}' (format csv, header true, compression gzip)""")
    # KDC → 태그
    rules = [(tag, p) for tag, ps in KDC_TAGS.items() for p in ps]
    con.sql("create table rules (tag_code varchar, prefix varchar)")
    con.executemany("insert into rules values (?, ?)", rules)
    tags_csv = out / "book_tags.csv.gz"
    con.sql(f"""copy (select distinct b.isbn13, r.tag_code from b join rules r
                    on b.category_code like r.prefix || '%' where b.category_code is not null order by 1, 2)
              to '{tags_csv.as_posix()}' (format csv, header true, compression gzip)""")

    stats = {k: v for k, v in zip(
        ["books", "with_desc", "desc_d4l", "desc_kakao", "desc_sibling", "with_cover", "with_kdc", "with_author", "with_year", "l1_rows"],
        con.sql("""select count(*), count(description), sum((description_source='DATA4LIBRARY')::int), sum((description_source='KAKAO')::int),
                          sum((description_source='SIBLING')::int), count(cover_url), count(category_code), count(author), count(pub_year), count(tier) from b""").fetchone())}
    stats["book_tags"] = con.sql(f"select count(*) from read_csv('{tags_csv.as_posix()}')").fetchone()[0]
    stats["tag_dist"] = dict(con.sql(f"select tag_code, count(*) from read_csv('{tags_csv.as_posix()}') group by 1 order by 2 desc").fetchall())
    manifest = {"built_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "scope": args.scope, "snapshot": str(snap),
                "inputs": {p.name: sha256(p) for p in [d4l, kakao, queue]},
                "outputs": {p.name: sha256(p) for p in [books_csv, tags_csv]}, "stats": {k: (int(v) if not isinstance(v, dict) else v) for k, v in stats.items()}}
    (out / "build_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    flat.unlink(missing_ok=True)
    n_b = stats["books"]
    log(f"books {n_b:,} (소개 {stats['with_desc']/n_b:.1%} = 정보나루 {stats['desc_d4l']:,} · 카카오 {stats['desc_kakao']:,} · 형제 {stats['desc_sibling']:,} · "
        f"표지 {stats['with_cover']/n_b:.1%} · KDC {stats['with_kdc']/n_b:.1%} · 저자 {stats['with_author']/n_b:.1%} · 연도 {stats['with_year']/n_b:.1%} · L1 포함 {stats['l1_rows']:,})")
    log(f"book_tags {stats['book_tags']:,} → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
