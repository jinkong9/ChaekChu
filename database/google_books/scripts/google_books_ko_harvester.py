#!/usr/bin/env python3
"""Google Books 색인에서 한국어 도서를 대량 수확한다.

ISBN 단건 조회(google_books_collector.py)와 목적이 다르다.
저쪽은 "국중 ISBN을 Google이 아는가"(매칭률)를 재고,
이쪽은 "Google이 아는 한국서에 실제로 소개문이 있는가, 그리고 그것이
발간연도에 따라 어떻게 달라지는가"를 수천 건 규모로 잰다.

한계: 여기서 나오는 결측률은 **색인 포함을 조건으로 한 값**이다.
색인에 없는 책은 애초에 표본에 들어오지 않으므로 매칭률과 혼동하면 안 된다.

관측된 API 제약
- maxResults 를 40으로 줘도 실제 반환은 20건이다.
- startIndex 는 약 380까지만 유효하고 그 이상은 items 가 비어서 온다.
- totalItems 는 300으로 고정돼 나오는 경우가 많아 신뢰할 수 없다.

실행:
    py scripts/google_books_ko_harvester.py --max-calls 500
    py scripts/google_books_ko_harvester.py --max-calls 200 --resume
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from google_books_collector import (  # noqa: E402
    API_URL,
    AuthenticationError,
    DailyQuotaExceeded,
    load_env_file,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "raw" / f"ko_harvest_raw_{date.today():%Y%m%d}.jsonl"
DEFAULT_CHECKPOINT = ROOT / "metadata" / "harvest_checkpoint.json"
DEFAULT_PLAN = ROOT / "metadata" / "harvest_plan.json"

PAGE_SIZE = 20          # 실제 반환 상한
MAX_START_INDEX = 380   # 이 이상은 빈 응답

# 시대 분산을 위해 출판사 축을 주력으로 쓴다.
# 오래된 출판사와 최근 출판사를 섞어 특정 연대에 쏠리지 않게 했다.
PUBLISHERS = [
    "민음사", "문학동네", "창비", "김영사", "열린책들", "웅진지식하우스",
    "시공사", "다산북스", "돌베개", "사계절", "을유문화사", "까치",
    "한길사", "현암사", "푸른숲", "북하우스", "위즈덤하우스", "알에이치코리아",
    "학지사", "박영사", "법문사", "교보문고", "삼성출판사", "비룡소",
    "한빛미디어", "위키북스", "길벗", "이지스퍼블리싱", "인사이트", "제이펍",
    "에이콘출판", "정보문화사", "영진닷컴", "생능출판사", "한티미디어",
    "시대고시기획", "SD에듀", "메가스터디", "동아출판", "천재교육",
    "지학사", "미래엔", "EBS", "성안당", "청림출판", "쌤앤파커스",
    "북21", "arte", "은행나무", "자음과모음", "문학과지성사", "실천문학사",
]

# 주제 축. 출판사로 잡히지 않는 롱테일을 보완한다.
SUBJECTS = [
    "소설", "시집", "수필", "역사", "철학", "종교", "심리학", "경제",
    "경영", "정치", "사회학", "법률", "교육", "수학", "물리학", "화학",
    "생물학", "의학", "간호", "약학", "공학", "건축", "컴퓨터", "인공지능",
    "통계", "요리", "여행", "육아", "건강", "운동", "음악", "미술",
    "사진", "영화", "만화", "아동", "청소년", "자기계발", "인문학", "고전",
    "환경", "농업", "군사", "언어학", "영어", "일본어", "중국어", "한국사",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_plan() -> list[dict[str, Any]]:
    """(쿼리, startIndex) 조합의 실행 계획을 만든다."""
    plan: list[dict[str, Any]] = []
    # 출판사 축은 깊게, 주제 축은 넓게 판다.
    for name in PUBLISHERS:
        for start in range(0, MAX_START_INDEX + 1, PAGE_SIZE):
            plan.append({"q": f"inpublisher:{name}", "startIndex": start,
                         "axis": "publisher", "term": name})
    for term in SUBJECTS:
        for start in range(0, MAX_START_INDEX + 1, PAGE_SIZE):
            plan.append({"q": term, "startIndex": start,
                         "axis": "subject", "term": term})
    return plan


def load_checkpoint(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"planIndex": 0, "apiCalls": 0, "uniqueVolumes": 0, "deadQueries": []}


def save_checkpoint(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def seen_volume_ids(path: Path) -> set[str]:
    found: set[str] = set()
    if not path.exists():
        return found
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                found.add(json.loads(line)["volume_id"])
            except (json.JSONDecodeError, KeyError):
                continue
    return found


def fetch(api_key: str, params: dict[str, Any], retries: int = 2) -> dict[str, Any]:
    query = dict(params)
    query.update({"key": api_key, "maxResults": 40, "printType": "books"})
    url = API_URL + "?" + urlencode(query)
    request = Request(url, headers={"User-Agent": "b102-google-books-harvester/1.0"})
    last: str | None = None
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            lowered = body.lower()
            if error.code == 429 or ("quota" in lowered or "ratelimitexceeded" in lowered):
                raise DailyQuotaExceeded(body[:400])
            if error.code in (401, 403):
                raise AuthenticationError("HTTP " + str(error.code) + ": " + body[:300])
            last = "HTTP " + str(error.code)
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            last = type(error).__name__ + ": " + str(error)
        if attempt < retries:
            time.sleep(min(2 ** attempt, 8))
    return {"__request_error__": last}


def isbn13_of(info: dict[str, Any]) -> str | None:
    for entry in info.get("industryIdentifiers") or []:
        if entry.get("type") == "ISBN_13":
            return entry.get("identifier")
    return None


def flatten(volume: dict[str, Any], hit: dict[str, Any]) -> dict[str, Any]:
    info = volume.get("volumeInfo", {})
    description = info.get("description") or ""
    return {
        "collected_at_utc": utc_now(),
        "volume_id": volume.get("id"),
        "query_axis": hit["axis"],
        "query_term": hit["term"],
        "query_start_index": hit["startIndex"],
        "isbn13": isbn13_of(info),
        "title": info.get("title"),
        "authors": info.get("authors"),
        "publisher": info.get("publisher"),
        "publishedDate": info.get("publishedDate"),
        "publishedYear": (info.get("publishedDate") or "")[:4] or None,
        "language": info.get("language"),
        "pageCount": info.get("pageCount"),
        "categories": info.get("categories"),
        "averageRating": info.get("averageRating"),
        "ratingsCount": info.get("ratingsCount"),
        "description_length": len(description.strip()),
        "description": description,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--max-calls", type=int, default=400, help="이번 실행의 호출 예산")
    parser.add_argument("--sleep", type=float, default=0.08)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    api_key = os.environ.get("GOOGLE_BOOKS_API_KEY", "").strip()
    if not api_key:
        raise AuthenticationError("GOOGLE_BOOKS_API_KEY 가 없습니다.")

    plan = build_plan()
    DEFAULT_PLAN.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_PLAN.write_text(json.dumps({
        "created_at": utc_now(),
        "api": "Google Books volumes",
        "strategy": "publisher axis (deep) + subject axis (broad), paginated to startIndex 380",
        "page_size": PAGE_SIZE,
        "max_start_index": MAX_START_INDEX,
        "publishers": len(PUBLISHERS),
        "subjects": len(SUBJECTS),
        "total_planned_calls": len(plan),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    state = load_checkpoint(args.checkpoint) if args.resume else {
        "planIndex": 0, "apiCalls": 0, "uniqueVolumes": 0, "deadQueries": []}
    seen = seen_volume_ids(args.output) if args.resume else set()
    dead = set(state.get("deadQueries", []))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    calls = 0
    added = 0
    quota_hit = False
    index = state["planIndex"]

    with args.output.open("a", encoding="utf-8") as sink:
        while index < len(plan) and calls < args.max_calls:
            hit = plan[index]
            index += 1
            # 앞 페이지가 비었던 쿼리는 뒷페이지도 비어 있다. 예산을 아낀다.
            if hit["term"] in dead and hit["startIndex"] > 0:
                continue
            try:
                payload = fetch(api_key, {"q": hit["q"], "startIndex": hit["startIndex"]})
            except DailyQuotaExceeded:
                quota_hit = True
                print("일일 쿼터 소진. 중단한다.")
                break
            calls += 1
            items = payload.get("items") or []
            if not items:
                dead.add(hit["term"])
                continue
            for volume in items:
                vid = volume.get("id")
                if not vid or vid in seen:
                    continue
                seen.add(vid)
                sink.write(json.dumps(flatten(volume, hit), ensure_ascii=False) + "\n")
                added += 1
            if calls % 25 == 0:
                sink.flush()
                print(f"  호출 {calls}/{args.max_calls}  누적 고유 {len(seen)}건  "
                      f"(현재 {hit['axis']}:{hit['term']})")
            if args.sleep:
                time.sleep(args.sleep)

    state.update({
        "planIndex": index,
        "apiCalls": state.get("apiCalls", 0) + calls,
        "uniqueVolumes": len(seen),
        "deadQueries": sorted(dead),
        "lastRunAtUtc": utc_now(),
        "lastRunQuotaExceeded": quota_hit,
    })
    save_checkpoint(args.checkpoint, state)

    print("")
    print("=== 수확 요약 ===")
    print(f"이번 실행 호출 수: {calls}")
    print(f"이번 실행 신규 레코드: {added}")
    print(f"누적 고유 volume: {len(seen)}")
    print(f"계획 소진: {index}/{len(plan)}")
    print(f"쿼터 소진: {quota_hit}")
    print(f"출력: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
