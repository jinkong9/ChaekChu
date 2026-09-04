#!/usr/bin/env python3
"""정보나루 관별 샤드 -> 보유 원장 Parquet 3종 빌드.

**폐기됨 (2026-09-04).** 이 스크립트가 만들던 shards/*.csv 는
13컬럼 중 3개만 남긴 축약본이라 도서명·저자·KDC 를 버렸다.
collect_full_holdings.py + build_holdings_full.py 로 대체됐고
입력이던 shards/ 와 산출물 holdings.parquet·loans_by_isbn.parquet 은
모두 삭제됐다. 참고용으로만 남긴다 — 실행하지 말 것.

입력 (collect_full_holdings.py 산출, 저장소 밖)
  data4library/shards/{lib_id}.csv        lib_id,isbn13,loans,copies
  data4library/lib_index.jsonl            내부id, 이름, 유형, 최신월, 고유ISBN수
  data4library/participating_libraries.xlsx  정보나루 libCode + 주소/위경도

출력 (같은 폴더)
  libraries.parquet     도서관 마스터: 내부id + API libCode + 위경도 (이름 조인)
  holdings.parquet      보유 원장: lib_id x isbn13_norm x loans x copies
                        <- '이 책을 보유한 근처 도서관' 조회의 원천
  loans_by_isbn.parquet ISBN 합산: loans/copies/holder_libs (필터·랭킹용 파생)

ISBN 정규화: isbn_sql 매크로 + 체크숫자 오류 시 앞 12자리 재계산 폴백
(도서관 데이터의 '978+ISBN10 체크숫자 미재계산' 오류 0.26% 회수).

실행:
    py scripts/build_holdings_parquet.py
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import isbn_sql

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_ROOT = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal\data4library")


def norm_name(value: str) -> str:
    # 수집 인덱스의 이름은 60자 절단으로 '장서/대출 데이터' 꼬리가 부분만 남을 수 있다.
    v = re.sub(r"장서\s*/?\s*대출\s*데이.*$", "", value or "")
    return re.sub(r"[^0-9A-Za-z가-힣]", "", v).lower()


def read_xlsx_master(path: Path) -> list[dict]:
    """참여도서관 XLSX -> [{name, address, tel, lat, lon, homepage, api_libcode}]"""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    import xml.etree.ElementTree as ET
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    shared = ["".join(t.text or "" for t in si.iter(ns + "t"))
              for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(ns + "si")]
    rows = []
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(ns + "row"):
        vals = []
        for c in row.findall(ns + "c"):
            v = c.find(ns + "v")
            vals.append("" if v is None else
                        (shared[int(v.text)] if c.get("t") == "s" else (v.text or "")))
        rows.append(vals)
    header_idx = next(i for i, r in enumerate(rows) if r and r[0] == "도서관명")
    out = []
    for r in rows[header_idx + 1:]:
        if len(r) < 10 or not r[0]:
            continue
        out.append({"name": r[0], "address": r[1], "tel": r[2],
                    "lat": r[4], "lon": r[5], "homepage": r[6],
                    "api_libcode": r[9]})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    root = args.root

    con = duckdb.connect()
    con.execute("SET memory_limit='6GB'")
    con.execute("SET preserve_insertion_order=false")
    isbn_sql.install(con)
    # 체크숫자 오류 폴백: 13자리 숫자인데 체크섬만 틀리면 앞 12자리로 재계산
    con.execute("""
        CREATE OR REPLACE MACRO norm_isbn13_fb(v) AS (
          coalesce(norm_isbn13(v),
            CASE WHEN regexp_matches(isbn_clean(v), '^97[89][0-9]{10}$')
                 THEN substr(isbn_clean(v), 1, 12)
                      || CAST(ean13_check(substr(isbn_clean(v), 1, 12)) AS VARCHAR)
            END)
        )
    """)

    # ---------- 1. 도서관 마스터 ----------
    index_rows = [json.loads(l) for l in
                  (root / "lib_index.jsonl").read_text(encoding="utf-8").splitlines()
                  if l.strip()]
    print(f"수집 인덱스: {len(index_rows)}개관")
    master = read_xlsx_master(root / "participating_libraries.xlsx")
    print(f"참여도서관 XLSX: {len(master)}개관")
    by_name: dict[str, dict] = {}
    for m in master:
        by_name.setdefault(norm_name(m["name"]), m)

    # 접두 일치 폴백용 정렬 키 목록
    master_keys = sorted(by_name.keys())
    joined, missed = 0, []
    lib_rows = []
    for r in index_rows:
        key = norm_name(r["name"])
        m = by_name.get(key)
        if not m and len(key) >= 8:
            cands = [k for k in master_keys if k.startswith(key) or key.startswith(k)]
            if len(cands) == 1:
                m = by_name[cands[0]]
        if m:
            joined += 1
        else:
            missed.append(r["name"])
            m = {}
        lib_rows.append((int(r["lib_id"]), r["name"], r["lib_type"],
                         r.get("latest_month", ""), r.get("unique_isbn", 0),
                         m.get("api_libcode"), m.get("address"),
                         float(m["lat"]) if m.get("lat") else None,
                         float(m["lon"]) if m.get("lon") else None,
                         m.get("tel"), m.get("homepage")))
    print(f"이름 조인 성공 {joined}/{len(index_rows)} "
          f"({100*joined/len(index_rows):.1f}%)  미조인 예시: {missed[:5]}")

    con.execute("""CREATE TABLE libs(
        lib_id INT, lib_name VARCHAR, lib_type VARCHAR, latest_month VARCHAR,
        unique_isbn INT, api_libcode VARCHAR, address VARCHAR,
        lat DOUBLE, lon DOUBLE, tel VARCHAR, homepage VARCHAR)""")
    con.executemany("INSERT INTO libs VALUES (?,?,?,?,?,?,?,?,?,?,?)", lib_rows)
    con.execute(f"COPY libs TO '{(root/'libraries.parquet').as_posix()}' "
                "(FORMAT PARQUET, COMPRESSION ZSTD)")

    # ---------- 2. 보유 원장 ----------
    print("holdings.parquet 빌드 중...", flush=True)
    con.execute(f"""
        COPY (
            SELECT CAST(lib_id AS INT) lib_id,
                   norm_isbn13_fb(isbn13) isbn13,
                   CAST(loans AS INT) loans,
                   CAST(copies AS INT) copies
            FROM read_csv('{(root/'shards').as_posix()}/*.csv', header=true,
                          columns={{'lib_id':'VARCHAR','isbn13':'VARCHAR',
                                    'loans':'VARCHAR','copies':'VARCHAR'}})
            WHERE norm_isbn13_fb(isbn13) IS NOT NULL
        ) TO '{(root/'holdings.parquet').as_posix()}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    # ---------- 3. ISBN 합산 ----------
    con.execute(f"""
        COPY (
            SELECT isbn13, sum(loans) loans, sum(copies) copies,
                   count(DISTINCT lib_id) holder_libs
            FROM '{(root/'holdings.parquet').as_posix()}'
            GROUP BY isbn13
        ) TO '{(root/'loans_by_isbn.parquet').as_posix()}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    for f in ["libraries.parquet", "holdings.parquet", "loans_by_isbn.parquet"]:
        p = root / f
        n = con.execute(f"SELECT count(*) FROM '{p.as_posix()}'").fetchone()[0]
        print(f"  {f:<24} {n:>13,}행  {p.stat().st_size/1024/1024:>8.1f} MB")

    # 근처 도서관 조회 예시 (해리포터 불의 잔)
    print("\n[검증] 9788983920959 보유 도서관 상위 5 (위경도 포함):")
    for row in con.execute(f"""
        SELECT l.lib_name, h.loans, h.copies, l.lat, l.lon
        FROM '{(root/'holdings.parquet').as_posix()}' h
        JOIN '{(root/'libraries.parquet').as_posix()}' l USING(lib_id)
        WHERE h.isbn13='9788983920959' ORDER BY h.loans DESC LIMIT 5
    """).fetchall():
        print(f"    {row[0][:26]:<28} 대출 {row[1]:>5} 권수 {row[2]}  "
              f"({row[3]}, {row[4]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
