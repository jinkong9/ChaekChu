#!/usr/bin/env python3
"""임베딩 입력용 텍스트 정제.

회수 원문(nl_url_text.csv)에서 실측으로 확인된 오염 패턴을 걷어낸다.
원문은 보존하고 정제본을 별도 산출한다 — 규칙이 바뀌면 원문에서 다시 만든다.

실측 오염 패턴 (랜덤 10건 표본에서 3건 발견)
  1. 필드 오분류    field=intro 인데 내용이 목차 (`차례 재출판본 서문 ...`)
  2. 판권지 혼입    `초판 1쇄 발행_2015년 6월 1일 ... 주소_충남 천안시 ... Fax: 041-...`
                   -> 주소·전화번호가 벡터에 섞여 '천안', '논밭출판사' 가 신호가 된다
  3. 목차 페이지번호 `머리말 5`, `데이터 가공 과정 36` — 숫자가 주제 신호를 흐린다

산출
  nl_text_clean.csv   isbn13, field_orig, field, chars_orig, chars, text

실행
    py scripts/clean_text_for_embedding.py --sample 100   # 효과 확인
    py scripts/clean_text_for_embedding.py                # 전량
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from collections import Counter
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

csv.field_size_limit(50_000_000)
BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
SRC = BASE / "nl_url_text.csv"
OUT = BASE / "nl_text_clean.csv"
MIN_CHARS = 100          # 이 미만은 임베딩 입력으로 쓰지 않는다
MAX_CHARS = 100_000

# ── 1. 필드 재분류 ────────────────────────────────────────────
# intro 로 들어왔지만 실제로는 목차인 경우를 앞부분 패턴으로 판별한다
TOC_HEAD = re.compile(r"^\s*(차\s*례|목\s*차|Contents|CONTENTS)\b")

# 머리에 표식이 없는 목차도 있다(실측). 구조로 판별한다:
# 장/절 표기가 반복되고 항목 끝에 페이지번호가 자주 붙으면 목차다.
TOC_MARK = re.compile(r"(제\s*\d+\s*[장편부]|[IVXivx]{1,4}\.\s|\(\d{1,2}\)\s|\d{1,2}\.\s)")
TOC_PAGE = re.compile(r"[가-힣A-Za-z\]\)]\s+\d{1,4}(?=\s|$)")

# ── 2. 판권지(콜로폰) 블록 ────────────────────────────────────
# 이 표지가 나오면 그 지점부터 끝까지 서지·연락처라 잘라낸다
COLOPHON = re.compile(
    r"(초판\s*\d*\s*쇄?\s*발행|1쇄\s*발행|펴낸곳\s*[_:]|펴낸이\s*[_:]|"
    r"등록번호\s*[_:]|주소\s*[_:]|전화\s*[_:]|Fax\s*[:_]|팩스\s*[_:]|"
    r"ISBN\s*[:：]|값\s*\d{1,3},\d{3}\s*원)")

# 남아 있는 연락처·주소 조각 제거
CONTACT = re.compile(
    r"(\(?\d{2,4}\)?[-\s]\d{3,4}[-\s]\d{4})"          # 전화번호
    r"|([\w.+-]+@[\w-]+\.[\w.]+)"                      # 이메일
    r"|(https?://\S+)"                                 # URL
    r"|(제?\s*\d{2,4}-\d{4}-\d{5,6}\s*호)")            # 등록번호

# ── 3. 목차 페이지번호 ────────────────────────────────────────
# '머리말 5', '데이터 가공 과정 36' 처럼 항목 끝에 붙는 숫자를 없앤다.
# 항목 구분자(| 또는 공백 다수) 앞이나 문자열 끝의 1~4자리 숫자만 대상으로 한다.
PAGE_NUM = re.compile(r"(?<=[가-힣A-Za-z?!\)\]])\s+\d{1,4}(?=\s*(\||$))")
PAGE_NUM_MID = re.compile(r"(?<=[가-힣A-Za-z])\s+\d{1,4}\s+(?=[가-힣A-Za-z])")


def reclassify(field: str, text: str) -> str:
    """내용 기반 필드 재분류. 국중 원본에 필드 오분류가 존재한다.

    표식(`차례`/`목차`)이 없는 목차도 있어 구조로도 판별한다.
    장 표기가 5회 이상이고 페이지번호 패턴이 5회 이상이면 목차로 본다.
    """
    if field != "intro":
        return field
    if TOC_HEAD.match(text):
        return "toc"
    head = text[:3000]
    if len(TOC_MARK.findall(head)) >= 5 and len(TOC_PAGE.findall(head)) >= 5:
        return "toc"
    return field


def strip_colophon(text: str) -> str:
    match = COLOPHON.search(text)
    if not match:
        return text
    head = text[:match.start()].strip()
    # 판권지가 맨 앞에 있으면(=본문이 그 뒤) 자르지 않고 그 부분만 제거
    if len(head) < MIN_CHARS:
        tail = COLOPHON.sub(" ", text)
        return tail
    return head


def strip_page_numbers(text: str) -> str:
    text = PAGE_NUM.sub("", text)
    for _ in range(2):        # 연속 항목은 한 번에 안 걸린다
        text = PAGE_NUM_MID.sub(" ", text)
    return text


def clean(field: str, text: str) -> tuple[str, str]:
    """(재분류된 field, 정제 텍스트)

    순서가 중요하다. 장식 구분선을 먼저 지우면 `항목 ··· 12` 가 `항목 12` 가 되어
    목차 판별이 오히려 쉬워지므로, 장식 제거 -> 재분류 -> 페이지번호 제거 순으로 간다.
    """
    text = " ".join(text.split())
    # 장식 구분선·점선 리더 (··, ……, ----, ____ 등). 2개 이상 반복이면 장식이다.
    text = re.sub(r"[·․‥…⋯._\-=~*]{2,}", " ", text)
    text = " ".join(text.split())

    field = reclassify(field, text)
    text = strip_colophon(text)
    text = CONTACT.sub(" ", text)
    if field == "toc":
        text = strip_page_numbers(text)
    # 판권지 절단 후 남는 조각 (`_2015년 6월 1일`, 앞뒤로 떨어진 밑줄 등)
    text = re.sub(r"_+\s*\d{4}년[^ ]*(\s*\d+월)?(\s*\d+일)?", " ", text)
    text = re.sub(r"(?<![가-힣A-Za-z0-9])_+(?![가-힣A-Za-z0-9])", " ", text)
    text = " ".join(text.split())
    return field, text[:MAX_CHARS]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", type=int, default=0,
                        help="지정 시 그 건수만 처리하고 변화를 출력")
    parser.add_argument("--src", type=Path, default=SRC)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    raw = args.src.read_bytes().decode("utf-8")
    reader = csv.DictReader(io.StringIO(raw))
    stats = Counter()
    changed_examples: list[tuple] = []
    rows_out: list[tuple] = []

    for index, row in enumerate(reader):
        if args.sample and index >= args.sample:
            break
        isbn = row["isbn13"]
        field_orig = row["field"]
        original = row["text"] or ""
        field, text = clean(field_orig, original)

        stats["total"] += 1
        if field != field_orig:
            stats["reclassified"] += 1
        removed = len(original) - len(text)
        if removed > 0:
            stats["shortened"] += 1
            stats["chars_removed"] += removed
        if len(text) < MIN_CHARS:
            stats["dropped_short"] += 1
            continue
        rows_out.append((isbn, field_orig, field, len(original), len(text), text))
        if removed > 200 and len(changed_examples) < 4:
            changed_examples.append((isbn, field_orig, field, original, text))

    if not args.sample:
        with args.out.open("w", encoding="utf-8", newline="") as sink:
            writer = csv.writer(sink)
            writer.writerow(["isbn13", "field_orig", "field", "chars_orig", "chars", "text"])
            writer.writerows(rows_out)

    print(f"=== 정제 결과 ({'표본 ' + str(args.sample) if args.sample else '전량'}) ===")
    print(f"  처리          {stats['total']:>9,}")
    print(f"  필드 재분류    {stats['reclassified']:>9,}  (intro -> toc)")
    print(f"  텍스트 축소    {stats['shortened']:>9,}")
    print(f"  제거 문자      {stats['chars_removed']:>9,}자")
    print(f"  100자 미만 탈락 {stats['dropped_short']:>9,}")
    print(f"  최종 보존      {len(rows_out):>9,}")
    if not args.sample:
        print(f"  출력: {args.out}  ({args.out.stat().st_size/1024/1024:.1f} MB)")

    for isbn, fo, fn, before, after in changed_examples:
        tag = f"{fo}->{fn}" if fo != fn else fo
        print(f"\n  [{isbn} · {tag}] {len(before):,}자 -> {len(after):,}자")
        print(f"    전: {before[:150]}")
        print(f"    후: {after[:150]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
