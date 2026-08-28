#!/usr/bin/env python3
"""실제 추천을 뽑아 눈으로 확인한다.

실험(experiment_embedding_source.py)은 지표를 재는 것이고, 이건 **결과를 보는 것**이다.
지표가 좋아도 실제 추천이 엉뚱하면 소용없으므로 사람이 직접 판단할 수 있게 낸다.

실험과 다른 점 — 여기서는 **서비스에 실제로 넣을 구성**을 쓴다.
  실험:  소개문만 (제목을 빼야 '텍스트가 주제를 담는가' 를 잰 것이 된다)
  여기:  제목 + 소개문 (실제 서비스는 제목을 뺄 이유가 없다)

텍스트는 있는 대로 쓴다. 둘 다 있으면 정보나루를 앞에 둔다 (실험에서 D+K 가 K+D 보다 나았다).

실행
    py scripts/demo_recommend.py
    py scripts/demo_recommend.py --query "미드나잇 라이브러리"
    py scripts/demo_recommend.py --top 10
"""

from __future__ import annotations

import argparse
import json
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
MODEL = "jhgan/ko-sroberta-multitask"
MIN_CHARS = 60

# 장르가 갈리게 고른 질의. 없으면 제목이 가장 비슷한 책으로 대신한다.
DEFAULT_QUERIES = [
    "소년이 온다",
    "나미야 잡화점의 기적",
    "아몬드",
    "총, 균, 쇠",
    "사피엔스",
    "미움받을 용기",
    "그리스 로마 신화",
    "부의 추월차선",
]


def load(path: Path, text_key: str) -> dict:
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
            if row.get("ok") and (row.get(text_key) or "").strip():
                rows[row["isbn13"]] = row
    return rows


def clean_title(raw: str) -> str:
    """국중·정보나루 제목에 붙는 부제·권차 표기를 걷어낸다."""
    title = re.sub(r"\s*:\s*.*$", "", raw or "")      # `제목 :부제`
    title = re.sub(r"^\(.*?\)\s*", "", title)          # `(총서명) 제목`
    return title.strip()


def build_corpus() -> list:
    d4l = load(D4L, "desc")
    kakao = load(KAKAO, "contents")
    isbns = set(d4l) | set(kakao)

    books = []
    for isbn in isbns:
        dr, kr = d4l.get(isbn), kakao.get(isbn)
        d_text = (dr or {}).get("desc", "").strip()
        k_text = (kr or {}).get("contents", "").strip()
        body = " ".join(t for t in (d_text, k_text) if t)   # D+K 순서
        if len(body) < MIN_CHARS:
            continue
        title = clean_title((dr or {}).get("bookname") or (kr or {}).get("title") or "")
        if not title:
            continue
        books.append({
            "isbn13": isbn,
            "title": title,
            "author": ((dr or {}).get("authors")
                       or ", ".join((kr or {}).get("authors") or []) or "").strip(),
            "kdc_nm": (dr or {}).get("class_nm", ""),
            "kdc": (dr or {}).get("class_no", ""),
            "year": (dr or {}).get("pub_year") or (kr or {}).get("datetime", "")[:4],
            "src": ("D+K" if d_text and k_text else "D" if d_text else "K"),
            # 서비스 구성: 제목 + 소개문
            "embed_text": f"{title}. {body}",
        })
    return books


# 권차 표기. `수학도둑 71`, `해리 포터 3권`, `~ 제5권`, `... 2 - 부제` 등
VOLUME = re.compile(
    r"(\s*[-–—]\s*.*$)"                    # 대시 뒤 부제·홍보문구
    r"|(\s*제?\s*\d{1,3}\s*(권|편|부|화|집)?\s*$)"   # 끝의 권차
    r"|(\s*\(\s*\d{1,3}\s*\)\s*$)")


def series_key(title: str) -> str:
    """권차를 떼어 시리즈 단위로 묶는 키.

    `수학도둑 71` 과 `수학도둑 51` 은 다른 책이 아니라 같은 시리즈의 다른 권이다.
    소개문이 권마다 거의 같아서 유사도가 0.92 를 넘고, 안 접으면
    추천 10칸이 전부 한 시리즈로 채워진다 (실측: 수학도둑 질의 10/10).
    """
    prev = None
    while prev != title:
        prev = title
        title = VOLUME.sub("", title).strip()
    return re.sub(r"[^가-힣A-Za-z0-9]", "", title)


def dedupe(books: list) -> list:
    """같은 저작의 다른 판본과 같은 시리즈의 다른 권을 하나로 접는다.

    두 가지를 접는다.
      판본  `그리스 로마 신화` 가 쇄만 다르게 5권 — 소개문이 같아 유사도 ~1.0
      권차  `수학도둑 71/51/81/…` — 권차가 제목에 박혀 있어 제목 키로는 안 걸린다

    남기는 것은 소개문이 가장 긴 것 — 정보량이 가장 많다.
    """
    best: dict = {}
    for book in books:
        key = (series_key(book["title"]),
               re.sub(r"[^가-힣A-Za-z0-9]", "", book["author"])[:12])
        kept = best.get(key)
        if kept is None or len(book["embed_text"]) > len(kept["embed_text"]):
            best[key] = book
    return list(best.values())


def find(books: list, name: str) -> int:
    """제목으로 책을 찾는다. 정확히 없으면 가장 가깝게 포함하는 것."""
    key = re.sub(r"\s+", "", name)
    exact = [i for i, b in enumerate(books) if re.sub(r"\s+", "", b["title"]) == key]
    if exact:
        return exact[0]
    part = [i for i, b in enumerate(books) if key in re.sub(r"\s+", "", b["title"])]
    return part[0] if part else -1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", help="질의 도서 제목 (반복 가능)")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--no-dedupe", action="store_true",
                        help="판본 병합을 끄고 원래 상태를 본다")
    args = parser.parse_args()

    books = build_corpus()
    raw_n = len(books)
    books = books if args.no_dedupe else dedupe(books)
    print(f"수집분 {raw_n:,}권 -> 판본 병합 후 {len(books):,}권 "
          f"({raw_n - len(books):,}권이 같은 저작의 다른 판본이었다)")
    print(f"추천 대상 {len(books):,}권 "
          f"(D+K {sum(1 for b in books if b['src']=='D+K'):,} · "
          f"D {sum(1 for b in books if b['src']=='D'):,} · "
          f"K {sum(1 for b in books if b['src']=='K'):,})\n", flush=True)

    from sentence_transformers import SentenceTransformer
    import torch
    model = SentenceTransformer(MODEL,
                                device="cuda" if torch.cuda.is_available() else "cpu")
    vectors = model.encode([b["embed_text"] for b in books], batch_size=64,
                           convert_to_numpy=True, normalize_embeddings=True,
                           show_progress_bar=False).astype(np.float32)

    queries = args.query or DEFAULT_QUERIES
    same3 = same1 = total = 0
    for name in queries:
        i = find(books, name)
        if i < 0:
            print(f"[{name}] 수집분에 없다 — 건너뜀\n")
            continue
        q = books[i]
        scores = vectors @ vectors[i]
        scores[i] = -2.0
        top = np.argpartition(-scores, args.top)[:args.top]
        top = top[np.argsort(-scores[top])]

        print("━" * 76)
        print(f"질의  {q['title']}  ({q['author'][:28]}, {q['year']})")
        print(f"      {q['kdc_nm'] or q['kdc'] or '분류없음'}")
        print("─" * 76)
        for rank, j in enumerate(top, 1):
            b = books[j]
            mark = "◎" if b["kdc"][:3] == q["kdc"][:3] and q["kdc"] else \
                   "○" if b["kdc"][:1] == q["kdc"][:1] and q["kdc"] else "·"
            print(f"  {rank}. {mark} {b['title'][:34]:<34} {b['author'][:16]:<16} "
                  f"{b['year']:<5} {scores[j]:.3f}")
            if q["kdc"]:
                total += 1
                same3 += b["kdc"][:3] == q["kdc"][:3]
                same1 += b["kdc"][:1] == q["kdc"][:1]
        print()

    if total:
        print("━" * 76)
        print(f"◎ 세부분류(KDC3) 일치 {same3}/{total} = {100*same3/total:.0f}%   "
              f"○ 대분류(KDC1) 일치 {same1}/{total} = {100*same1/total:.0f}%")
        print("  ※ 분류 일치는 참고용이다. 같은 분류라도 엉뚱할 수 있고,")
        print("     다른 분류라도 좋은 추천일 수 있다. 실제 판단은 목록을 보고 할 것.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
