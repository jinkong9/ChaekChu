"""알라딘 OpenAPI 탐색용 CLI.

TTBKey는 환경변수 ALADIN_TTB_KEY 또는 같은 폴더의 .env 에서 읽는다.
표준 라이브러리만 사용한다.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = "https://www.aladin.co.kr/ttb/api"
VERSION = "20131101"
UA = "Mozilla/5.0 (compatible; aladin-api-explorer/1.0)"


def load_key():
    key = os.environ.get("ALADIN_TTB_KEY")
    if key:
        return key.strip()
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "ALADIN_TTB_KEY":
                    return v.strip().strip("'\"")
    sys.exit(
        "ALADIN_TTB_KEY 가 없습니다.\n"
        "  .env 파일에  ALADIN_TTB_KEY=발급받은키  한 줄을 넣거나\n"
        "  $env:ALADIN_TTB_KEY = '발급받은키'  로 설정하세요."
    )


def call(endpoint, params):
    params = {k: v for k, v in params.items() if v not in (None, "")}
    params.update({"ttbkey": load_key(), "output": "js", "Version": VERSION})
    url = f"{BASE}/{endpoint}?" + urllib.parse.urlencode(params, encoding="utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    # 알라딘 JSON 응답에 raw 제어문자가 섞여 오는 경우가 있어 strict=False 로 파싱
    try:
        data = json.loads(raw, strict=False)
    except json.JSONDecodeError as e:
        sys.exit(f"JSON 파싱 실패: {e}\n응답 앞부분: {raw[:500]}")

    if isinstance(data, dict) and data.get("errorCode"):
        sys.exit(f"API 오류 {data['errorCode']}: {data.get('errorMessage', '')}")
    return data


def fmt(items, verbose=False):
    if not items:
        print("결과 없음")
        return
    for i, it in enumerate(items, 1):
        print(f"\n[{i}] {it.get('title', '')}")
        print(f"    저자   : {it.get('author', '')}")
        print(f"    출판사 : {it.get('publisher', '')}  ({it.get('pubDate', '')})")
        price = it.get("priceSales")
        std = it.get("priceStandard")
        disc = f" (정가 {std:,})" if std and price and std != price else ""
        print(f"    가격   : {price:,}원{disc}" if price else "    가격   : -")
        print(f"    ISBN13 : {it.get('isbn13') or it.get('isbn', '')}   itemId: {it.get('itemId')}")
        print(f"    분류   : {it.get('categoryName', '')}")
        if it.get("customerReviewRank") is not None:
            print(f"    평점   : {it['customerReviewRank']}/10   판매지수: {it.get('salesPoint', 0):,}")
        if it.get("bestRank"):
            print(f"    순위   : {it['bestRank']}위")
        if verbose:
            desc = (it.get("description") or "").replace("\n", " ")
            if desc:
                print(f"    설명   : {desc[:300]}")
            if it.get("link"):
                print(f"    링크   : {it['link']}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    p = argparse.ArgumentParser(description="알라딘 OpenAPI 탐색")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="상품 검색 (ItemSearch)")
    s.add_argument("query")
    s.add_argument("--type", default="Keyword",
                   choices=["Keyword", "Title", "Author", "Publisher"])
    s.add_argument("--target", default="Book",
                   choices=["Book", "Foreign", "eBook", "Used", "Music", "DVD", "All"])
    s.add_argument("--sort", default="Accuracy",
                   choices=["Accuracy", "PublishTime", "Title", "SalesPoint",
                            "CustomerRating", "MyReviewCount"])
    s.add_argument("-n", "--max", type=int, default=10, help="최대 50")
    s.add_argument("--start", type=int, default=1, help="페이지 번호")

    l = sub.add_parser("list", help="상품 리스트 (ItemList) - 신간/베스트셀러 등")
    l.add_argument("--type", default="Bestseller",
                   choices=["Bestseller", "ItemNewAll", "ItemNewSpecial",
                            "ItemEditorChoice", "BlogBest"])
    l.add_argument("--target", default="Book",
                   choices=["Book", "Foreign", "eBook", "Used", "Music", "DVD"])
    l.add_argument("--category", type=int, help="CategoryId (0=전체)")
    l.add_argument("-n", "--max", type=int, default=10)
    l.add_argument("--start", type=int, default=1)

    k = sub.add_parser("lookup", help="상품 조회 (ItemLookUp) - ISBN/itemId 단건")
    k.add_argument("item_id", help="ISBN13 또는 itemId")
    k.add_argument("--id-type", default="ISBN13",
                   choices=["ISBN13", "ISBN", "ItemId"])

    for parser in (s, l, k):
        parser.add_argument("--raw", metavar="FILE", help="응답 원본 JSON 저장")
        parser.add_argument("-v", "--verbose", action="store_true")

    a = p.parse_args()

    if a.cmd == "search":
        data = call("ItemSearch.aspx", {
            "Query": a.query, "QueryType": a.type, "SearchTarget": a.target,
            "Sort": a.sort, "MaxResults": min(a.max, 50), "start": a.start,
            "Cover": "Big",
        })
        print(f"검색어 '{a.query}' — 총 {data.get('totalResults', 0)}건 중 "
              f"{len(data.get('item', []))}건 표시")
    elif a.cmd == "list":
        data = call("ItemList.aspx", {
            "QueryType": a.type, "SearchTarget": a.target,
            "CategoryId": a.category, "MaxResults": min(a.max, 50),
            "start": a.start, "Cover": "Big",
        })
        print(f"{a.type} / {a.target} — 총 {data.get('totalResults', 0)}건")
    else:
        data = call("ItemLookUp.aspx", {
            "ItemId": a.item_id, "ItemIdType": a.id_type, "Cover": "Big",
            "OptResult": "ratingInfo,bestSellerRank,Toc,authors,fulldescription",
        })
        print(f"조회: {a.item_id}")

    fmt(data.get("item", []), a.verbose)

    if a.raw:
        with open(a.raw, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n원본 저장: {a.raw}")


if __name__ == "__main__":
    main()
