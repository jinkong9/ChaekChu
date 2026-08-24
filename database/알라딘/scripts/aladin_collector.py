#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
알라딘 Open API 도서 데이터 수집기 v1

국립중앙도서관 API와 달리 알라딘은 전체 덤프를 제공하지 않는다.
한 조건당 최대 1,000건, 하루 5,000회 호출이라는 두 상한 안에서
분야(CategoryId)를 쪼개 넓히고, ISBN 단건 조회로 깊이를 채우는 구조다.

수집 모드
  list        ItemList.aspx    베스트셀러·신간 리스트 순회   (1호출 = 최대 50건)
  search      ItemSearch.aspx  검색어/분야 기준 순회         (1호출 = 최대 50건)
  lookup      ItemLookUp.aspx  ISBN13 단건 상세 보강         (1호출 = 1건)
  categories  수집된 파트에서 실제 등장한 CategoryId 목록 추출 (호출 없음)
  merge       파트 병합 + 결측 리포트 생성                    (호출 없음)

실제 응답 검증에서 확인된 제약을 코드에 반영했다.
- MaxResults=50 기준 start는 1~20까지만 유효하다. start=21부터는 오류 없이
  1페이지를 다시 돌려주므로, 그대로 두면 중복만 쌓인다.
- totalResults는 ItemList에서 1000으로 고정되고, ItemSearch는 실제 건수를
  보여주지만 접근 가능한 것은 앞의 1,000건뿐이다.
- 결측이 null이 아니라 ""(문자열)와 0(숫자)으로 온다.
- 기본형 TTBKey로는 OptResult의 Toc/Story/fulldescription/authors 등이
  요청해도 채워지지 않는다.

설치:
    py -m pip install requests

실행:
    $env:ALADIN_TTB_KEY = "발급받은_TTBKey"
    py aladin_collector.py --mode list       --output-dir "C:\\data\\aladin_output"
    py aladin_collector.py --mode categories --output-dir "C:\\data\\aladin_output"
    py aladin_collector.py --mode list       --output-dir "C:\\data\\aladin_output" \
        --category-file "C:\\data\\aladin_output\\metadata\\category_ids.txt"
    py aladin_collector.py --mode lookup     --output-dir "C:\\data\\aladin_output" \
        --seed-nl "C:\\data\\nl_isbn_split_output\\processed\\books_all_years.jsonl"
    py aladin_collector.py --mode merge      --output-dir "C:\\data\\aladin_output"

--output-dir 아래에 database/API_DATA_STANDARD.md 의 표준 폴더가 생성된다.

    {output-dir}/
    ├── raw/parts/                              # 조건별 원본 JSONL과 .done.json
    ├── processed/items_normalized_{scope}.jsonl
    ├── samples/sample_items.jsonl
    ├── samples/sample_items.pretty.json
    ├── reports/missing_report_{scope}.csv
    ├── reports/data_quality_summary_{scope}.txt
    └── metadata/
        ├── collection_plan.json      # 조회 조건별 실행 계획
        ├── category_ids.txt          # 다음 회차 분야 순회 입력
        ├── category_index.jsonl      # 분야 ID·명·깊이·건수
        ├── unresolved_targets.json   # 실패한 조회 조건
        ├── isbn_not_found.jsonl      # 알라딘 미등록·절판 ISBN
        └── quota_state.json          # 날짜별 호출 사용량
"""

import argparse
import csv
import getpass
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

# categories·merge 모드는 네트워크를 쓰지 않으므로 requests 없이도 동작해야 한다.
try:
    import requests
except ImportError:
    requests = None

API_BASE = "https://www.aladin.co.kr/ttb/api"
API_VERSION = "20131101"

# 기본형 TTBKey 기준 하루 5,000회. 여유분을 남기고 4,800으로 잡는다.
DEFAULT_DAILY_LIMIT = 4800

# 실제 응답 검증 결과. MaxResults=50 기준 start는 20까지만 유효하다.
MAX_RESULTS_PER_CALL = 50
MAX_START_PAGE = 20
MAX_ITEMS_PER_QUERY = MAX_RESULTS_PER_CALL * MAX_START_PAGE  # 1000

BACKOFF_SECONDS = [5, 15, 30, 60, 120]

# 기본형 키로 실제 값이 채워지는 것만 요청한다. (표본 7건 조회로 확인)
DEFAULT_OPT_RESULT = [
    "ratingInfo",
    "bestSellerRank",
    "packing",
    "subbarcode",
    "categoryIdList",
    "ebookList",
    "usedList",
    "c2binfo",
    "cardReviewImgList",
]

# 요청해도 응답에 나타나지 않은 항목. 프리미엄 키 승인 후 재확인 대상이다.
UNAVAILABLE_OPT_RESULT = [
    "Toc", "Story", "fulldescription", "fulldescription2", "authors",
    "reviewList", "phraseList", "mdrecommend", "eventList",
    "previewImgList", "b2bSupply",
]

LIST_QUERY_TYPES = [
    "Bestseller",
    "ItemNewAll",
    "ItemNewSpecial",
    "ItemEditorChoice",
    "BlogBest",
]

# 분야를 모르는 상태에서 시작하므로 전체(0)부터 훑고,
# categories 모드로 실제 등장한 CategoryId를 뽑아 다음 회차의 입력으로 쓴다.
DEFAULT_CATEGORY_IDS = [0]


# ---------------------------------------------------------------- 공통 유틸


def normalize_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def flatten(obj, prefix=""):
    """
    dict를 점 표기 경로로 평탄화한다.
    list는 `필드[]`로 표시하고 내부 구조는 첫 원소를 기준으로 펼친다.
    알라딘 응답은 subInfo 아래가 중첩이라 이 형태여야 결측을 필드 단위로 볼 수 있다.
    """
    out = {}
    if not isinstance(obj, dict):
        return out

    for k, v in obj.items():
        path = f"{prefix}{k}"
        if isinstance(v, dict):
            if not v:
                out[path] = {}
            else:
                out.update(flatten(v, path + "."))
        elif isinstance(v, list):
            out[path + "[]"] = v
            if v and isinstance(v[0], dict):
                out.update(flatten(v[0], path + "[]."))
        else:
            out[path] = v
    return out


def blank_kind(v):
    """
    알라딘식 결측 분류.
    전 필드 null이 0%이고 문자열은 "", 숫자는 0으로 오기 때문에
    'null / 빈값 / 0값'을 나눠서 세야 실제 결측률이 보인다.
    """
    if v is None:
        return "null"
    if isinstance(v, str):
        return "empty" if v.strip() == "" else None
    if isinstance(v, (list, dict)):
        return "empty" if len(v) == 0 else None
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0:
        return "zero"
    return None


def part_name(*chunks) -> str:
    parts = []
    for chunk in chunks:
        text = normalize_text(chunk)
        if not text:
            continue
        for bad in ' /\\:*?"<>|':
            text = text.replace(bad, "_")
        parts.append(text)
    return "__".join(parts)


def load_lines(path):
    if not path:
        return None
    values = []
    with Path(path).open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                values.append(line)
    return values


# ---------------------------------------------------------------- 오류 정의


class AladinApiError(RuntimeError):
    """알라딘이 HTTP 200 본문에 errorCode로 내려주는 오류."""

    def __init__(self, code, message):
        super().__init__(f"errorCode={code} {message}")
        self.code = normalize_text(code)
        self.message = normalize_text(message)

    @property
    def fatal(self) -> bool:
        """키 오류·차단은 재시도해도 같으므로 수집 자체를 멈춘다."""
        text = self.message.lower()
        return "ttbkey" in text or "key" in text or "차단" in self.message


class QuotaExhausted(RuntimeError):
    pass


# ---------------------------------------------------------------- 호출 쿼터


class QuotaGuard:
    """
    하루 호출 제한을 파일에 기록한다.
    수집이 며칠에 걸쳐 이어지므로 실행 단위가 아니라 날짜 단위로 센다.
    """

    def __init__(self, path: Path, daily_limit: int):
        self.path = path
        self.daily_limit = daily_limit
        self.state = {"date": "", "used": 0}

        if path.exists():
            try:
                self.state = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                pass

        today = date.today().isoformat()
        if self.state.get("date") != today:
            self.state = {"date": today, "used": 0}
            self._save()

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(self.path)

    @property
    def used(self) -> int:
        return int(self.state.get("used", 0))

    @property
    def remaining(self) -> int:
        return max(0, self.daily_limit - self.used)

    def consume(self, count: int = 1):
        if self.remaining < count:
            raise QuotaExhausted(
                f"오늘 호출 한도 {self.daily_limit:,}회를 모두 사용했습니다. "
                "내일 같은 명령을 다시 실행하면 완료된 파트를 건너뛰고 이어서 수집합니다."
            )
        self.state["used"] = self.used + count
        self._save()


# ---------------------------------------------------------------- API 클라이언트


class ApiClient:
    def __init__(self, key, quota, retries, timeout, sleep_sec, cover):
        if requests is None:
            raise SystemExit(
                "requests 패키지가 필요합니다: python -m pip install requests"
            )
        self.key = key
        self.quota = quota
        self.retries = retries
        self.timeout = timeout
        self.sleep_sec = sleep_sec
        self.cover = cover
        self.session = self._new_session()

    def _new_session(self):
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (compatible; aladin-book-collector/1.0)"
        })
        return s

    @staticmethod
    def _parse_body(text: str) -> dict:
        """
        output=js 응답이 표준 JSON이 아닐 때가 있다.
        책소개 문자열 안에 이스케이프되지 않은 제어문자가 섞여 오므로
        strict=False로 파싱하고, 후행 세미콜론도 걷어낸다.
        """
        body = text.strip()
        if body.endswith(";"):
            body = body[:-1].strip()
        return json.loads(body, strict=False)

    def request(self, endpoint: str, params: dict) -> dict:
        full = {k: v for k, v in params.items() if v not in (None, "")}
        full.update({
            "ttbkey": self.key,
            "output": "js",
            "Version": API_VERSION,
            "Cover": self.cover,
        })

        url = f"{API_BASE}/{endpoint}"
        last_error = None

        for attempt in range(1, self.retries + 1):
            self.quota.consume(1)

            try:
                r = self.session.get(url, params=full, timeout=self.timeout)
                r.raise_for_status()
                data = self._parse_body(r.text)

                if isinstance(data, dict) and data.get("errorCode"):
                    raise AladinApiError(
                        data.get("errorCode"), data.get("errorMessage")
                    )

                if self.sleep_sec > 0:
                    time.sleep(self.sleep_sec)

                return data

            except AladinApiError:
                # 본문 오류는 재시도 대상이 아니다. 호출자가 판단한다.
                raise

            except (requests.RequestException, ValueError) as e:
                last_error = e

            if attempt >= self.retries:
                break

            wait = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
            print(f"\n[재시도] {endpoint} {attempt}/{self.retries} 실패: {last_error}")
            print(f"{wait}초 후 다시 요청합니다.")
            time.sleep(wait)

            try:
                self.session.close()
            except Exception:
                pass
            self.session = self._new_session()

        raise RuntimeError(str(last_error))

    def item_list(self, query_type, category_id, start, max_results,
                  search_target, year=None, month=None, week=None):
        return self.request("ItemList.aspx", {
            "QueryType": query_type,
            "SearchTarget": search_target,
            "CategoryId": category_id,
            "start": start,
            "MaxResults": max_results,
            "Year": year,
            "Month": month,
            "Week": week,
        })

    def item_search(self, query, query_type, category_id, start,
                    max_results, search_target, sort):
        return self.request("ItemSearch.aspx", {
            "Query": query,
            "QueryType": query_type,
            "SearchTarget": search_target,
            "CategoryId": category_id,
            "start": start,
            "MaxResults": max_results,
            "Sort": sort,
        })

    def item_lookup(self, item_id, item_id_type, opt_result):
        return self.request("ItemLookUp.aspx", {
            "ItemId": item_id,
            "ItemIdType": item_id_type,
            "OptResult": ",".join(opt_result),
        })


# ---------------------------------------------------------------- 결측 통계


class FieldStats:
    def __init__(self):
        self.total_docs = 0
        self.present = defaultdict(int)
        self.null = defaultdict(int)
        self.empty = defaultdict(int)
        self.zero = defaultdict(int)
        self.types = defaultdict(set)
        self.examples = defaultdict(list)
        self.all_fields = set()

    def add(self, doc):
        self.total_docs += 1
        for path, value in flatten(doc).items():
            self.all_fields.add(path)
            self.present[path] += 1
            self.types[path].add(type(value).__name__)

            kind = blank_kind(value)
            if kind == "null":
                self.null[path] += 1
            elif kind == "empty":
                self.empty[path] += 1
            elif kind == "zero":
                self.zero[path] += 1
            elif len(self.examples[path]) < 3:
                text = json.dumps(value, ensure_ascii=False)
                if len(text) > 120:
                    text = text[:117] + "..."
                if text not in self.examples[path]:
                    self.examples[path].append(text)

    def report(self):
        rows = []
        total = self.total_docs

        for path in sorted(self.all_fields):
            present = self.present[path]
            key_missing = total - present
            null_n = self.null[path]
            empty_n = self.empty[path]
            zero_n = self.zero[path]

            # 0값은 '진짜 0'일 수도 있으므로 결측에 포함하지 않고 따로 센다.
            missing = key_missing + null_n + empty_n
            rate = missing / total * 100 if total else 0
            zero_rate = zero_n / total * 100 if total else 0

            rows.append({
                "field": path,
                "total_count": total,
                "key_present_count": present,
                "key_missing_count": key_missing,
                "null_count": null_n,
                "blank_count": empty_n,
                "effective_missing_count": missing,
                "effective_missing_rate_percent": round(rate, 2),
                "zero_count": zero_n,
                "zero_rate_percent": round(zero_rate, 2),
                "types": ",".join(sorted(self.types[path])),
                "example_valid_values": " | ".join(
                    x.replace("\r", " ").replace("\n", " ")
                    for x in self.examples[path]
                ),
            })

        rows.sort(key=lambda x: (-x["effective_missing_rate_percent"], x["field"]))
        return rows


# ---------------------------------------------------------------- 파트 관리


def completed_part(parts_dir: Path, name: str):
    data_path = parts_dir / f"{name}.jsonl"
    meta_path = parts_dir / f"{name}.done.json"

    if not data_path.exists() or not meta_path.exists():
        return None

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return data_path, int(meta["count"])
    except Exception:
        return None


def write_done_meta(meta_path: Path, name, count, extra=None):
    payload = {"name": name, "count": int(count)}
    if extra:
        payload.update(extra)
    meta_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def collect_paged(client, parts_dir, name, fetch_page, max_items,
                  max_results, unresolved, label):
    """
    ItemList / ItemSearch 공통 페이지 순회.

    알라딘은 start가 유효 범위를 넘어도 오류를 주지 않고 1페이지를 되돌려준다.
    그래서 페이지 상한과 itemId 중복 검사 두 가지로 루프를 끊는다.
    """
    done = completed_part(parts_dir, name)
    if done:
        path, count = done
        print(f"[건너뜀] {label} — {count:,}건 이미 완료")
        return [(path, count)]

    final_path = parts_dir / f"{name}.jsonl"
    meta_path = parts_dir / f"{name}.done.json"
    temp_path = parts_dir / f"{name}.part"
    temp_path.unlink(missing_ok=True)

    seen_ids = set()
    collected = 0
    total_results = None
    start = 1
    stop_reason = "정상 종료"

    print(f"[수집] {label}")

    try:
        with temp_path.open("w", encoding="utf-8") as f:
            while collected < max_items and start <= MAX_START_PAGE:
                data = fetch_page(start, max_results)

                if total_results is None:
                    total_results = int(data.get("totalResults", 0) or 0)
                    print(f"  totalResults={total_results:,}")

                items = data.get("item", []) or []
                if not items:
                    stop_reason = "빈 페이지"
                    break

                new_in_page = 0
                for item in items:
                    item_id = item.get("itemId")
                    if item_id in seen_ids:
                        continue
                    seen_ids.add(item_id)
                    item["_source_label"] = label
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")
                    collected += 1
                    new_in_page += 1

                print(
                    f"\r  start={start:>2} | 누적 {collected:,}건",
                    end="", flush=True,
                )

                if new_in_page == 0:
                    # 같은 페이지가 다시 온 경우다. 더 진행해도 중복만 쌓인다.
                    stop_reason = f"start={start}에서 중복 페이지 감지"
                    break

                if len(items) < max_results:
                    stop_reason = "마지막 페이지"
                    break

                start += 1

        print()

    except QuotaExhausted:
        print()
        temp_path.unlink(missing_ok=True)
        raise

    except AladinApiError as e:
        print()
        temp_path.unlink(missing_ok=True)
        if e.fatal:
            raise
        print(f"[구간 실패] {label}: {e}")
        unresolved.append({"name": name, "label": label, "reason": str(e)})
        return []

    except Exception as e:
        print()
        print(f"[구간 실패] {label}: {e}")
        temp_path.unlink(missing_ok=True)
        unresolved.append({"name": name, "label": label, "reason": str(e)})
        return []

    if start > MAX_START_PAGE:
        stop_reason = f"페이지 상한 {MAX_START_PAGE} 도달"

    if collected == 0:
        temp_path.unlink(missing_ok=True)
        final_path.write_text("", encoding="utf-8")
    else:
        temp_path.replace(final_path)

    write_done_meta(meta_path, name, collected, {
        "label": label,
        "total_results": total_results,
        "stop_reason": stop_reason,
    })
    return [(final_path, collected)]


# ---------------------------------------------------------------- 수집 모드


def write_collection_plan(path: Path, mode, targets, max_items):
    """
    실행 계획을 metadata/collection_plan.json 에 남긴다.
    국립중앙도서관 수집기의 range_plan.json 과 같은 역할이다.
    알라딘은 사전에 건수를 알 수 없으므로 조건별 상한값을 예상치로 기록한다.
    """
    path.write_text(
        json.dumps({
            "mode": mode,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "target_count": len(targets),
            "max_items_per_target": max_items,
            "estimated_calls": len(targets) * (max_items // MAX_RESULTS_PER_CALL),
            "estimated_max_rows": len(targets) * max_items,
            "targets": targets,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"실행 계획 {len(targets):,}개 조건 저장: {path}\n"
        f"  예상 최대 호출 {len(targets) * (max_items // MAX_RESULTS_PER_CALL):,}회"
    )


def build_week_targets(year_from, year_to):
    """
    Bestseller 조회용 (year, month, week) 목록.
    알라딘 주간 베스트셀러는 월 1~5주 단위로 조회된다.
    """
    targets = []
    today = date.today()
    for year in range(year_from, year_to + 1):
        for month in range(1, 13):
            if year == today.year and month > today.month:
                break
            for week in range(1, 6):
                targets.append((year, month, week))
    return targets


def build_list_targets(categories, query_types, search_target, weeks):
    """수집 전에 조회 조건을 모두 펼쳐 실행 계획으로 만든다."""
    targets = []
    for query_type in query_types:
        for category_id in categories:
            weeks_for_type = weeks if (query_type == "Bestseller" and weeks) \
                else [(None, None, None)]

            for year, month, week in weeks_for_type:
                suffix = f"{year}-{month:02d}-w{week}" if year else ""
                targets.append({
                    "name": part_name(
                        "list", query_type, search_target, category_id, suffix
                    ),
                    "label": (
                        f"ItemList {query_type} target={search_target} "
                        f"cat={category_id} {suffix}".strip()
                    ),
                    "query_type": query_type,
                    "search_target": search_target,
                    "category_id": category_id,
                    "year": year,
                    "month": month,
                    "week": week,
                })
    return targets


def run_list_mode(client, parts_dir, targets, max_results, max_items,
                  unresolved):
    results = []

    for target in targets:
        def fetch(start, size, _t=target):
            return client.item_list(
                query_type=_t["query_type"], category_id=_t["category_id"],
                start=start, max_results=size,
                search_target=_t["search_target"],
                year=_t["year"], month=_t["month"], week=_t["week"],
            )

        results.extend(collect_paged(
            client, parts_dir, target["name"], fetch,
            max_items, max_results, unresolved, target["label"],
        ))

    return results


def build_search_targets(queries, query_type, categories, search_target, sort):
    targets = []
    for query in queries:
        for category_id in categories:
            targets.append({
                "name": part_name(
                    "search", query_type, sort, search_target,
                    category_id, query
                ),
                "label": (
                    f"ItemSearch '{query}' type={query_type} "
                    f"sort={sort} cat={category_id}"
                ),
                "query": query,
                "query_type": query_type,
                "search_target": search_target,
                "category_id": category_id,
                "sort": sort,
            })
    return targets


def run_search_mode(client, parts_dir, targets, max_results, max_items,
                    unresolved):
    results = []

    for target in targets:
        def fetch(start, size, _t=target):
            return client.item_search(
                query=_t["query"], query_type=_t["query_type"],
                category_id=_t["category_id"], start=start, max_results=size,
                search_target=_t["search_target"], sort=_t["sort"],
            )

        results.extend(collect_paged(
            client, parts_dir, target["name"], fetch,
            max_items, max_results, unresolved, target["label"],
        ))

    return results


def load_seed_isbns(seed_nl, seed_txt, limit):
    """
    보강 대상 ISBN13 목록을 만든다.
    국립중앙도서관 수집 결과(JSONL)의 EA_ISBN 또는 줄 단위 텍스트를 받는다.
    ISBN-10은 알라딘 ISBN13 조회에 쓸 수 없으므로 13자리만 남긴다.
    """
    seen = set()
    isbns = []

    def push(value):
        code = normalize_text(value).replace("-", "").replace(" ", "")
        if len(code) != 13 or not code.isdigit():
            return False
        if code in seen:
            return False
        seen.add(code)
        isbns.append(code)
        return True

    if seed_nl:
        with Path(seed_nl).open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    doc = json.loads(line)
                except json.JSONDecodeError:
                    continue
                push(doc.get("EA_ISBN"))
                if limit and len(isbns) >= limit:
                    return isbns

    if seed_txt:
        with Path(seed_txt).open("r", encoding="utf-8") as f:
            for line in f:
                push(line)
                if limit and len(isbns) >= limit:
                    return isbns

    return isbns


def run_lookup_mode(client, parts_dir, isbns, opt_result, chunk_size,
                    not_found_path, unresolved):
    """
    ISBN13 단건 조회. 1 ISBN = 1 호출이므로 하루 처리량이 쿼터와 같다.
    알라딘에 없는 ISBN(절판·미등록)은 오류가 아니라 빈 item 배열로 온다.
    """
    results = []
    total_chunks = (len(isbns) + chunk_size - 1) // chunk_size
    print(f"보강 대상 ISBN13 {len(isbns):,}건 / {total_chunks:,}청크")

    for idx in range(total_chunks):
        chunk = isbns[idx * chunk_size:(idx + 1) * chunk_size]
        name = part_name("lookup", f"{idx:06d}")

        done = completed_part(parts_dir, name)
        if done:
            path, count = done
            print(f"[건너뜀] 청크 {idx + 1}/{total_chunks} — {count:,}건")
            results.append((path, count))
            continue

        final_path = parts_dir / f"{name}.jsonl"
        meta_path = parts_dir / f"{name}.done.json"
        temp_path = parts_dir / f"{name}.part"
        temp_path.unlink(missing_ok=True)

        collected = 0
        not_found = []
        print(f"[수집] 청크 {idx + 1}/{total_chunks} (ISBN {len(chunk):,}건)")

        try:
            with temp_path.open("w", encoding="utf-8") as f:
                for pos, isbn in enumerate(chunk, start=1):
                    try:
                        data = client.item_lookup(isbn, "ISBN13", opt_result)
                        items = data.get("item", []) or []
                    except AladinApiError as e:
                        if e.fatal:
                            raise
                        not_found.append({
                            "isbn13": isbn, "code": e.code, "message": e.message
                        })
                        items = []

                    if not items:
                        if not not_found or not_found[-1]["isbn13"] != isbn:
                            not_found.append({
                                "isbn13": isbn, "code": "EMPTY",
                                "message": "item 배열이 비어 있음(미등록·절판)",
                            })
                    for item in items:
                        item["_seed_isbn13"] = isbn
                        f.write(json.dumps(item, ensure_ascii=False) + "\n")
                        collected += 1

                    print(
                        f"\r  {pos:,}/{len(chunk):,} | 수집 {collected:,}건 "
                        f"| 미매칭 {len(not_found):,}건",
                        end="", flush=True,
                    )

            print()

        except QuotaExhausted:
            print()
            # 부분 결과는 버린다. 다음 실행에서 이 청크를 처음부터 다시 한다.
            temp_path.unlink(missing_ok=True)
            append_jsonl(not_found_path, not_found)
            raise

        except AladinApiError as e:
            print()
            temp_path.unlink(missing_ok=True)
            append_jsonl(not_found_path, not_found)
            raise

        except Exception as e:
            print()
            print(f"[청크 실패] {name}: {e}")
            temp_path.unlink(missing_ok=True)
            unresolved.append({"name": name, "label": name, "reason": str(e)})
            append_jsonl(not_found_path, not_found)
            continue

        if collected == 0:
            temp_path.unlink(missing_ok=True)
            final_path.write_text("", encoding="utf-8")
        else:
            temp_path.replace(final_path)

        write_done_meta(meta_path, name, collected, {
            "isbn_count": len(chunk),
            "not_found_count": len(not_found),
        })
        append_jsonl(not_found_path, not_found)
        results.append((final_path, collected))

    return results


def append_jsonl(path: Path, rows):
    if not rows:
        return
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def run_categories_mode(parts_dir, category_path, index_path):
    """
    수집된 파트에서 실제로 등장한 CategoryId를 모은다.
    알라딘 분야 목록을 따로 구하지 않아도 다음 회차의 분야 순회 입력을 만들 수 있다.
    """
    counts = defaultdict(int)
    names = {}

    for part in sorted(parts_dir.glob("*.jsonl")):
        with part.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    doc = json.loads(line)
                except json.JSONDecodeError:
                    continue

                cid = doc.get("categoryId")
                if cid:
                    counts[int(cid)] += 1
                    names.setdefault(int(cid), normalize_text(doc.get("categoryName")))

                for entry in doc.get("categoryIdList") or []:
                    sub = entry.get("categoryId")
                    if sub:
                        counts[int(sub)] += 0
                        names.setdefault(int(sub), normalize_text(entry.get("categoryName")))

    rows = []
    for cid, name in names.items():
        rows.append({
            "categoryId": cid,
            "categoryName": name,
            "depth": name.count(">") + 1 if name else 0,
            "item_count": counts.get(cid, 0),
        })

    rows.sort(key=lambda x: (x["depth"], -x["item_count"], x["categoryId"]))

    with index_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    with category_path.open("w", encoding="utf-8") as f:
        f.write("# aladin_collector.py --category-file 로 넘길 CategoryId 목록\n")
        for row in rows:
            f.write(f"{row['categoryId']}\n")

    print(f"CategoryId {len(rows):,}개 추출")
    print(f"  목록  : {category_path}")
    print(f"  상세  : {index_path}")
    return rows


# ---------------------------------------------------------------- 병합·리포트


def merge_and_analyze(parts_dir, merged_path, report_path, summary_path,
                      unresolved, not_found_path, dedup_key):
    parts = sorted(parts_dir.glob("*.jsonl"))
    if not parts:
        print("병합할 파트가 없습니다.")
        return 0

    stats = FieldStats()
    temp = merged_path.with_suffix(".part")
    seen = set()
    duplicated = 0
    no_key = 0

    print(f"\n[병합 + 결측률 분석] 파트 {len(parts):,}개")

    with temp.open("w", encoding="utf-8") as out:
        for idx, part in enumerate(parts, start=1):
            with part.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    doc = json.loads(line)

                    key = normalize_text(doc.get(dedup_key))
                    if key:
                        if key in seen:
                            duplicated += 1
                            continue
                        seen.add(key)
                    else:
                        no_key += 1

                    stats.add(doc)
                    out.write(json.dumps(doc, ensure_ascii=False) + "\n")

            print(
                f"\r파트 {idx:,}/{len(parts):,} | 누적 {stats.total_docs:,}건",
                end="", flush=True,
            )

    print()
    temp.replace(merged_path)

    report = stats.report()

    if report:
        with report_path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(report[0].keys()))
            writer.writeheader()
            writer.writerows(report)

    not_found_count = 0
    if not_found_path.exists():
        with not_found_path.open("r", encoding="utf-8") as f:
            not_found_count = sum(1 for line in f if line.strip())

    with summary_path.open("w", encoding="utf-8") as f:
        f.write("알라딘 Open API 도서 데이터 품질 요약\n")
        f.write("=" * 70 + "\n")
        f.write(f"생성 시각: {datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"병합 대상 파트 수: {len(parts):,}\n")
        f.write(f"중복 제거 기준 필드: {dedup_key}\n")
        f.write(f"최종 고유 레코드 수: {stats.total_docs:,}\n")
        f.write(f"중복으로 제외된 레코드 수: {duplicated:,}\n")
        f.write(f"중복 기준 키가 없는 레코드 수: {no_key:,}\n")
        f.write(f"알라딘에서 찾지 못한 ISBN 수: {not_found_count:,}\n")
        f.write(f"미해결 수집 구간 수: {len(unresolved):,}\n\n")

        if unresolved:
            f.write("[미해결 구간]\n")
            for x in unresolved[:100]:
                f.write(f"{x['label']} : {x['reason']}\n")
            f.write("\n")

        f.write("[결측률 높은 필드 TOP 20]  결측 = 키 없음 + null + 빈 문자열\n")
        for row in report[:20]:
            f.write(
                f"{row['field']}: "
                f"{row['effective_missing_count']:,}/{row['total_count']:,} "
                f"({row['effective_missing_rate_percent']:.2f}%)\n"
            )

        f.write("\n[0값 비율 높은 필드 TOP 20]  0이 결측인지 실제 0인지 별도 판단 필요\n")
        for row in sorted(report, key=lambda x: -x["zero_rate_percent"])[:20]:
            if row["zero_count"] == 0:
                break
            f.write(
                f"{row['field']}: "
                f"{row['zero_count']:,}/{row['total_count']:,} "
                f"({row['zero_rate_percent']:.2f}%)\n"
            )

        f.write("\n[결측률 낮은 필드 TOP 20]\n")
        for row in sorted(
            report, key=lambda x: (x["effective_missing_rate_percent"], x["field"])
        )[:20]:
            f.write(
                f"{row['field']}: "
                f"{row['effective_missing_count']:,}/{row['total_count']:,} "
                f"({row['effective_missing_rate_percent']:.2f}%)\n"
            )

    return stats.total_docs


def write_sample(merged_path: Path, sample_path: Path,
                 pretty_path: Path, sample_size: int):
    """
    표준에 따라 소형 샘플을 두 형식으로 남긴다.
    - sample_{resource}.jsonl        : 한 줄에 레코드 하나
    - sample_{resource}.pretty.json  : 사람이 읽기 좋게 들여쓴 JSON 배열
    """
    if not merged_path.exists() or sample_size <= 0:
        return

    rows = []
    with merged_path.open("r", encoding="utf-8") as src, \
            sample_path.open("w", encoding="utf-8") as dst:
        for idx, line in enumerate(src):
            if idx >= sample_size:
                break
            dst.write(line)
            rows.append(json.loads(line))

    # pretty 파일은 검토용이므로 앞부분만 담아 크기를 억제한다.
    pretty_path.write_text(
        json.dumps(rows[:50], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------- 엔트리포인트


def build_parser():
    parser = argparse.ArgumentParser(
        description="알라딘 Open API 도서 데이터 수집기"
    )

    parser.add_argument(
        "--mode",
        choices=["list", "search", "lookup", "categories", "merge"],
        required=True,
        help="list=리스트 순회, search=검색 순회, lookup=ISBN 상세 보강, "
             "categories=CategoryId 추출, merge=병합만",
    )
    parser.add_argument("--output-dir", default="aladin_output")
    parser.add_argument("--key", default=os.getenv("ALADIN_TTB_KEY"))

    parser.add_argument(
        "--daily-limit", type=int, default=DEFAULT_DAILY_LIMIT,
        help=f"하루 호출 상한 기본 {DEFAULT_DAILY_LIMIT} (알라딘 기본형 키는 5000)",
    )
    parser.add_argument("--sleep", type=float, default=0.3)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument(
        "--cover", default="Big",
        choices=["Big", "MidBig", "Mid", "Small", "Mini", "None"],
    )

    parser.add_argument(
        "--search-target", default="Book",
        choices=["Book", "Foreign", "Music", "DVD", "Used", "eBook", "All"],
    )
    parser.add_argument(
        "--max-results", type=int, default=MAX_RESULTS_PER_CALL,
        help="1회 호출당 건수. 알라딘 실제 상한은 50",
    )
    parser.add_argument(
        "--max-items", type=int, default=MAX_ITEMS_PER_QUERY,
        help="한 조건당 최대 수집 건수. 알라딘 실제 상한은 1000",
    )
    parser.add_argument(
        "--category-file",
        help="CategoryId를 줄 단위로 적은 파일. 없으면 전체(0)만 순회",
    )

    parser.add_argument(
        "--query-types", default=",".join(LIST_QUERY_TYPES),
        help="list 모드에서 순회할 QueryType 목록",
    )
    parser.add_argument(
        "--bestseller-year-from", type=int,
        help="지정하면 Bestseller를 주간 단위로 과거까지 순회",
    )
    parser.add_argument("--bestseller-year-to", type=int, default=date.today().year)

    parser.add_argument("--query-file", help="search 모드 검색어 목록 파일")
    parser.add_argument(
        "--query-type", default="Keyword",
        choices=["Keyword", "Title", "Author", "Publisher"],
    )
    parser.add_argument(
        "--sort", default="SalesPoint",
        choices=["Accuracy", "PublishTime", "Title",
                 "SalesPoint", "CustomerRating", "MyReviewCount"],
    )

    parser.add_argument("--seed-nl", help="국립중앙도서관 수집 JSONL 경로")
    parser.add_argument("--seed-txt", help="ISBN13 줄 단위 텍스트 경로")
    parser.add_argument(
        "--seed-limit", type=int, default=0,
        help="보강 대상 ISBN 상한. 0이면 제한 없음",
    )
    parser.add_argument("--chunk-size", type=int, default=500)
    parser.add_argument(
        "--opt-result", default=",".join(DEFAULT_OPT_RESULT),
        help="ItemLookUp OptResult 목록. 기본형 키에서 값이 오는 항목만 기본값",
    )

    parser.add_argument(
        "--dedup-key", default="itemId",
        help="병합 시 중복 제거 기준 필드. isbn13은 결측이 있어 itemId가 기본",
    )
    parser.add_argument(
        "--scope", default="all",
        help="리포트 파일명에 들어갈 수집 범위 식별자 "
             "(reports/data_quality_summary_{scope}.txt)",
    )
    parser.add_argument("--sample-size", type=int, default=3000)
    parser.add_argument(
        "--no-merge", action="store_true",
        help="수집만 하고 병합·리포트는 건너뜀",
    )

    return parser


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = build_parser()
    args = parser.parse_args()

    # database/API_DATA_STANDARD.md 의 표준 폴더 구조를 그대로 만든다.
    outdir = Path(args.output_dir)
    raw_dir = outdir / "raw"
    processed_dir = outdir / "processed"
    reports_dir = outdir / "reports"
    metadata_dir = outdir / "metadata"
    samples_dir = outdir / "samples"
    parts_dir = raw_dir / "parts"

    for directory in (
        raw_dir, processed_dir, reports_dir,
        metadata_dir, samples_dir, parts_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    scope = args.scope
    merged_path = processed_dir / f"items_normalized_{scope}.jsonl"
    report_path = reports_dir / f"missing_report_{scope}.csv"
    summary_path = reports_dir / f"data_quality_summary_{scope}.txt"
    sample_path = samples_dir / "sample_items.jsonl"
    sample_pretty_path = samples_dir / "sample_items.pretty.json"
    plan_path = metadata_dir / "collection_plan.json"
    unresolved_path = metadata_dir / "unresolved_targets.json"
    not_found_path = metadata_dir / "isbn_not_found.jsonl"
    category_path = metadata_dir / "category_ids.txt"
    category_index_path = metadata_dir / "category_index.jsonl"
    quota_path = metadata_dir / "quota_state.json"

    unresolved = []

    if args.mode == "categories":
        run_categories_mode(parts_dir, category_path, category_index_path)
        return

    if args.mode != "merge":
        key = args.key or getpass.getpass("알라딘 TTBKey: ").strip()
        if not key:
            parser.error("TTBKey가 필요합니다. ALADIN_TTB_KEY 환경변수를 쓰세요.")

        quota = QuotaGuard(quota_path, args.daily_limit)
        print(
            f"오늘 사용 호출 {quota.used:,} / 한도 {quota.daily_limit:,} "
            f"(남은 호출 {quota.remaining:,})"
        )

        client = ApiClient(
            key=key, quota=quota, retries=args.retries,
            timeout=args.timeout, sleep_sec=args.sleep, cover=args.cover,
        )

        categories = (
            [int(x) for x in load_lines(args.category_file)]
            if args.category_file else DEFAULT_CATEGORY_IDS
        )

        try:
            if args.mode == "list":
                weeks = []
                if args.bestseller_year_from:
                    weeks = build_week_targets(
                        args.bestseller_year_from, args.bestseller_year_to
                    )
                targets = build_list_targets(
                    categories=categories,
                    query_types=[
                        x.strip() for x in args.query_types.split(",") if x.strip()
                    ],
                    search_target=args.search_target,
                    weeks=weeks,
                )
                write_collection_plan(plan_path, args.mode, targets, args.max_items)
                run_list_mode(
                    client=client, parts_dir=parts_dir, targets=targets,
                    max_results=args.max_results, max_items=args.max_items,
                    unresolved=unresolved,
                )

            elif args.mode == "search":
                queries = load_lines(args.query_file)
                if not queries:
                    parser.error("search 모드에는 --query-file 이 필요합니다.")
                targets = build_search_targets(
                    queries=queries, query_type=args.query_type,
                    categories=categories, search_target=args.search_target,
                    sort=args.sort,
                )
                write_collection_plan(plan_path, args.mode, targets, args.max_items)
                run_search_mode(
                    client=client, parts_dir=parts_dir, targets=targets,
                    max_results=args.max_results, max_items=args.max_items,
                    unresolved=unresolved,
                )

            elif args.mode == "lookup":
                if not args.seed_nl and not args.seed_txt:
                    parser.error(
                        "lookup 모드에는 --seed-nl 또는 --seed-txt 가 필요합니다."
                    )
                isbns = load_seed_isbns(args.seed_nl, args.seed_txt, args.seed_limit)
                run_lookup_mode(
                    client=client, parts_dir=parts_dir, isbns=isbns,
                    opt_result=[
                        x.strip() for x in args.opt_result.split(",") if x.strip()
                    ],
                    chunk_size=args.chunk_size,
                    not_found_path=not_found_path, unresolved=unresolved,
                )

        except QuotaExhausted as e:
            print(f"\n[쿼터 종료] {e}")

        except AladinApiError as e:
            print(f"\n[치명적 오류로 중단] {e}")

        unresolved_path.write_text(
            json.dumps(unresolved, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n오늘 누적 호출 {quota.used:,} / {quota.daily_limit:,}")

        if args.no_merge:
            return

    total = merge_and_analyze(
        parts_dir=parts_dir, merged_path=merged_path,
        report_path=report_path, summary_path=summary_path,
        unresolved=unresolved, not_found_path=not_found_path,
        dedup_key=args.dedup_key,
    )

    write_sample(merged_path, sample_path, sample_pretty_path, args.sample_size)

    print(f"\n최종 고유 레코드 {total:,}건")
    print(f"정제 결과   : {merged_path}")
    print(f"결측 리포트 : {report_path}")
    print(f"품질 요약   : {summary_path}")
    print(f"샘플        : {sample_path}")
    print(f"가독성 샘플 : {sample_pretty_path}")


if __name__ == "__main__":
    main()
