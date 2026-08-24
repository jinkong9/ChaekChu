#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
국립중앙도서관 ISBN 서지정보 API
전체연도 안정 수집기 v2

기능
- 날짜 자동 분할
- 특정 페이지가 105 오류로 계속 실패하면 해당 날짜 구간을 다시 자동 분할
- 완료한 구간은 재실행 시 건너뜀
- 마지막에는 모든 파트를 병합하고 필드별 결측률 계산
- 날짜 검색으로 잡히지 않는 자료 수를 별도로 보고

설치:
    py -m pip install requests

실행:
    py nl_isbn_collector_adaptive.py

기존 nl_isbn_split_output 폴더가 있으면 완료된 .done.json 파트를 재사용합니다.
"""

import argparse
import csv
import getpass
import json
import math
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

API_URL = "https://www.nl.go.kr/seoji/SearchApi.do"

DEFAULT_PLACEHOLDERS = {
    "추후 보완", "추후보완", "없음", "미정", "미상",
    "n/a", "na", "null", "none", "-", "--",
}

BACKOFF_SECONDS = [5, 15, 30, 60, 120]


def normalize_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def is_blank(value: Any) -> bool:
    return normalize_text(value) == ""


def is_placeholder(value: Any, placeholders: set[str]) -> bool:
    if is_blank(value):
        return False
    return normalize_text(value).lower() in placeholders


def parse_date(s: str):
    try:
        return datetime.strptime(s, "%Y%m%d").date()
    except ValueError as e:
        raise argparse.ArgumentTypeError(
            f"날짜는 YYYYMMDD 형식이어야 합니다: {s}"
        ) from e


def fmt(d) -> str:
    return d.strftime("%Y%m%d")


def split_range(start, end):
    if start >= end:
        return None
    days = (end - start).days
    mid = start + timedelta(days=days // 2)
    return (start, mid), (mid + timedelta(days=1), end)


def range_name(start, end):
    return f"{fmt(start)}_{fmt(end)}"


class MissingStats:
    def __init__(self, placeholders):
        self.placeholders = placeholders
        self.total_docs = 0
        self.present_count = defaultdict(int)
        self.blank_count = defaultdict(int)
        self.placeholder_count = defaultdict(int)
        self.examples = defaultdict(list)
        self.all_fields = set()

    def add(self, doc):
        self.total_docs += 1
        for field, value in doc.items():
            self.all_fields.add(field)
            self.present_count[field] += 1

            if is_blank(value):
                self.blank_count[field] += 1
                continue

            if is_placeholder(value, self.placeholders):
                self.placeholder_count[field] += 1
                continue

            if len(self.examples[field]) < 3:
                text = normalize_text(value)
                if text not in self.examples[field]:
                    self.examples[field].append(text)

    def report(self):
        rows = []
        for field in sorted(self.all_fields):
            missing_field = self.total_docs - self.present_count[field]
            blank = self.blank_count[field]
            placeholder = self.placeholder_count[field]
            missing = missing_field + blank + placeholder
            valid = self.total_docs - missing
            rate = missing / self.total_docs * 100 if self.total_docs else 0

            rows.append({
                "field": field,
                "total_count": self.total_docs,
                "missing_field_count": missing_field,
                "blank_or_null_count": blank,
                "placeholder_missing_count": placeholder,
                "effective_missing_count": missing,
                "effective_missing_rate_percent": round(rate, 2),
                "valid_count": valid,
                "example_valid_values": " | ".join(
                    x.replace("\r", " ").replace("\n", " ")[:120]
                    for x in self.examples[field]
                ),
            })

        rows.sort(
            key=lambda x: (-x["effective_missing_rate_percent"], x["field"])
        )
        return rows


class CountCache:
    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                self.data = {}
        else:
            self.data = {}

    def get(self, start, end):
        return self.data.get(range_name(start, end))

    def set(self, start, end, count):
        self.data[range_name(start, end)] = int(count)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(self.path)


class ApiClient:
    def __init__(
        self, key, default_page_size, deposit_yn, ebook_yn,
        retries, timeout
    ):
        self.key = key
        self.default_page_size = default_page_size
        self.deposit_yn = deposit_yn
        self.ebook_yn = ebook_yn
        self.retries = retries
        self.timeout = timeout
        self.session = self._new_session()

    def _new_session(self):
        s = requests.Session()
        s.headers.update({
            "User-Agent": "NL-ISBN-Adaptive-Collector/2.0"
        })
        return s

    def _params(
        self, page_no, page_size,
        start=None, end=None, use_date=True, include_sort=True
    ):
        p = {
            "cert_key": self.key,
            "result_style": "json",
            "page_no": page_no,
            "page_size": page_size,
        }

        if include_sort:
            p["sort"] = "PUBLISH_PREDATE"
            p["order_by"] = "ASC"

        if use_date:
            p["start_publish_date"] = fmt(start)
            p["end_publish_date"] = fmt(end)

        if self.deposit_yn:
            p["deposit_yn"] = self.deposit_yn
        if self.ebook_yn:
            p["ebook_yn"] = self.ebook_yn

        return p

    def request(
        self, page_no=1, start=None, end=None,
        use_date=True, page_size=None, include_sort=True
    ):
        page_size = page_size or self.default_page_size
        params = self._params(
            page_no, page_size, start, end, use_date, include_sort
        )

        last_error = None

        for attempt in range(1, self.retries + 1):
            try:
                r = self.session.get(
                    API_URL, params=params, timeout=self.timeout
                )
                r.raise_for_status()
                data = r.json()

                if "docs" in data and "TOTAL_COUNT" in data:
                    return data

                code = str(data.get("resultCode", ""))
                msg = str(data.get("resultMsg", ""))
                raise RuntimeError(f"API 응답 오류: {code} {msg}")

            except (
                requests.RequestException,
                ValueError,
                RuntimeError,
            ) as e:
                last_error = e

                if attempt >= self.retries:
                    break

                wait = BACKOFF_SECONDS[
                    min(attempt - 1, len(BACKOFF_SECONDS) - 1)
                ]
                print(
                    f"\n[재시도] page={page_no}, "
                    f"{attempt}/{self.retries} 실패: {e}"
                )
                print(f"{wait}초 후 다시 요청합니다.")
                time.sleep(wait)

                try:
                    self.session.close()
                except Exception:
                    pass
                self.session = self._new_session()

        raise RuntimeError(str(last_error))

    def count(self, start, end):
        # TOTAL_COUNT만 필요하므로 결과 정렬을 하지 않고 1건만 요청한다.
        # 오래된 데이터 구간에서 정렬 자체가 105 오류를 유발하는 경우를 피한다.
        data = self.request(
            page_no=1, start=start, end=end, use_date=True,
            page_size=1, include_sort=False
        )
        return int(data["TOTAL_COUNT"])

    def all_count(self):
        data = self.request(
            page_no=1, use_date=False, page_size=1, include_sort=False
        )
        return int(data["TOTAL_COUNT"])


def get_count(client, cache, start, end, sleep_sec):
    cached = cache.get(start, end)
    if cached is not None:
        return int(cached)

    count = client.count(start, end)
    cache.set(start, end, count)

    if sleep_sec > 0:
        time.sleep(sleep_sec)

    return count


def build_initial_safe_ranges(
    client, cache, start, end, safe_limit, sleep_sec
):
    safe = []
    stack = [(start, end)]

    while stack:
        s, e = stack.pop()
        count = get_count(
            client, cache, s, e, sleep_sec
        )

        print(
            f"범위 확인 {fmt(s)} ~ {fmt(e)} : {count:,}건"
        )

        if count == 0:
            continue

        if count <= safe_limit:
            safe.append((s, e, count))
            continue

        children = split_range(s, e)
        if children is None:
            safe.append((s, e, count))
            continue

        left, right = children
        stack.append(right)
        stack.append(left)

    safe.sort(key=lambda x: x[0])
    return safe


def completed_part(parts_dir, start, end, expected_count=None):
    name = range_name(start, end)
    data_path = parts_dir / f"{name}.jsonl"
    meta_path = parts_dir / f"{name}.done.json"

    if not data_path.exists() or not meta_path.exists():
        return None

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        count = int(meta["count"])
    except Exception:
        return None

    if expected_count is not None and count != expected_count:
        return None

    return data_path, count


def write_done_meta(meta_path, start, end, count, page_size):
    meta_path.write_text(
        json.dumps(
            {
                "start": fmt(start),
                "end": fmt(end),
                "count": int(count),
                "page_size": int(page_size),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def try_collect_exact_range(
    client,
    start,
    end,
    expected_count,
    parts_dir,
    sleep_sec,
    page_size,
):
    done = completed_part(
        parts_dir, start, end, expected_count
    )
    if done:
        path, count = done
        print(
            f"[건너뜀] {fmt(start)}~{fmt(end)} "
            f"{count:,}건 이미 완료"
        )
        return True, path, count

    name = range_name(start, end)
    final_path = parts_dir / f"{name}.jsonl"
    meta_path = parts_dir / f"{name}.done.json"
    temp_path = parts_dir / f"{name}.part"

    temp_path.unlink(missing_ok=True)

    total_pages = math.ceil(expected_count / page_size)
    actual = 0

    print(
        f"[수집] {fmt(start)} ~ {fmt(end)} "
        f"{expected_count:,}건 / "
        f"{total_pages:,}페이지 "
        f"(page_size={page_size})"
    )

    try:
        with temp_path.open("w", encoding="utf-8") as f:
            for page in range(1, total_pages + 1):
                data = client.request(
                    page_no=page,
                    start=start,
                    end=end,
                    use_date=True,
                    page_size=page_size,
                )
                docs = data.get("docs", [])

                for doc in docs:
                    f.write(
                        json.dumps(doc, ensure_ascii=False)
                        + "\n"
                    )
                    actual += 1

                print(
                    f"\r  {page:,}/{total_pages:,} 페이지 "
                    f"| {actual:,}/{expected_count:,}건",
                    end="",
                    flush=True,
                )

                if page < total_pages and sleep_sec > 0:
                    time.sleep(sleep_sec)

        print()

    except Exception as e:
        print()
        print(
            f"[구간 실패] {fmt(start)} ~ {fmt(end)} "
            f": {e}"
        )
        temp_path.unlink(missing_ok=True)
        return False, None, 0

    if actual != expected_count:
        try:
            current = client.count(start, end)
        except Exception:
            current = expected_count

        if actual != current:
            print(
                f"[구간 불일치] 예상 {expected_count:,}, "
                f"현재 {current:,}, 실제 {actual:,}"
            )
            temp_path.unlink(missing_ok=True)
            return False, None, 0

        expected_count = current

    temp_path.replace(final_path)
    write_done_meta(
        meta_path, start, end, actual, page_size
    )

    return True, final_path, actual


def collect_unknown_count(
    client,
    cache,
    start,
    end,
    parts_dir,
    sleep_sec,
    page_size,
    unresolved,
    depth=0,
):
    """
    날짜 범위의 TOTAL_COUNT 요청 자체가 105로 실패할 때 사용한다.
    count가 성공할 때까지 날짜를 더 작게 나눈 뒤 수집으로 넘긴다.
    """
    indent = "  " * depth

    try:
        count = get_count(
            client, cache, start, end, sleep_sec
        )
    except Exception as e:
        print(
            f"{indent}[건수 조회 실패] {fmt(start)}~{fmt(end)}: {e}"
        )

        children = split_range(start, end)
        if children is not None:
            left, right = children
            print(
                f"{indent}→ 건수 조회도 실패하여 날짜를 더 분할합니다: "
                f"{fmt(left[0])}~{fmt(left[1])}, "
                f"{fmt(right[0])}~{fmt(right[1])}"
            )
            results = []
            for s, e in (left, right):
                results.extend(
                    collect_unknown_count(
                        client=client,
                        cache=cache,
                        start=s,
                        end=e,
                        parts_dir=parts_dir,
                        sleep_sec=sleep_sec,
                        page_size=page_size,
                        unresolved=unresolved,
                        depth=depth + 1,
                    )
                )
            return results

        # 하루 단위 TOTAL_COUNT도 못 받으면 이 구간은 별도 기록하고 넘어간다.
        unresolved.append({
            "start": fmt(start),
            "end": fmt(end),
            "expected_count": 0,
            "reason": f"하루 단위 TOTAL_COUNT 조회도 API 오류: {e}",
        })
        print(f"{indent}[미해결-count] {fmt(start)}")
        return []

    if count == 0:
        return []

    return collect_adaptively(
        client=client,
        cache=cache,
        start=start,
        end=end,
        expected_count=count,
        parts_dir=parts_dir,
        sleep_sec=sleep_sec,
        page_size=page_size,
        unresolved=unresolved,
        depth=depth,
    )


def collect_adaptively(
    client,
    cache,
    start,
    end,
    expected_count,
    parts_dir,
    sleep_sec,
    page_size,
    unresolved,
    depth=0,
):
    indent = "  " * depth

    done = completed_part(
        parts_dir, start, end, expected_count
    )
    if done:
        path, count = done
        print(
            f"{indent}[건너뜀] {fmt(start)}~{fmt(end)} "
            f"{count:,}건"
        )
        return [(path, count)]

    ok, path, count = try_collect_exact_range(
        client=client,
        start=start,
        end=end,
        expected_count=expected_count,
        parts_dir=parts_dir,
        sleep_sec=sleep_sec,
        page_size=page_size,
    )

    if ok:
        return [(path, count)]

    children = split_range(start, end)

    if children is not None:
        left, right = children

        print(
            f"{indent}→ 실패 구간을 날짜 기준으로 다시 분할:"
        )
        print(
            f"{indent}  {fmt(left[0])}~{fmt(left[1])}"
        )
        print(
            f"{indent}  {fmt(right[0])}~{fmt(right[1])}"
        )

        results = []

        for s, e in (left, right):
            results.extend(
                collect_unknown_count(
                    client=client,
                    cache=cache,
                    start=s,
                    end=e,
                    parts_dir=parts_dir,
                    sleep_sec=sleep_sec,
                    page_size=page_size,
                    unresolved=unresolved,
                    depth=depth + 1,
                )
            )

        return results

    print(
        f"{indent}→ 하루 범위도 실패. "
        "page_size를 낮춰 재시도합니다."
    )

    for smaller in (50, 20, 10, 5, 1):
        if smaller >= page_size:
            continue

        ok, path, count = try_collect_exact_range(
            client=client,
            start=start,
            end=end,
            expected_count=expected_count,
            parts_dir=parts_dir,
            sleep_sec=sleep_sec,
            page_size=smaller,
        )

        if ok:
            return [(path, count)]

    unresolved.append({
        "start": fmt(start),
        "end": fmt(end),
        "expected_count": expected_count,
        "reason": "날짜 단위 + page_size 1까지 시도했으나 API 오류",
    })

    print(
        f"{indent}[미해결] {fmt(start)} "
        f"{expected_count:,}건"
    )

    return []


def merge_and_analyze(
    part_results,
    merged_path,
    placeholders,
    report_path,
    summary_path,
    api_all_count,
    planned_date_count,
    unresolved,
):
    unique = {}
    for path, count in part_results:
        unique[str(path.resolve())] = (path, count)

    parts = sorted(
        unique.values(),
        key=lambda x: x[0].name,
    )

    stats = MissingStats(placeholders)
    temp = merged_path.with_suffix(".part")

    print("\n[병합 + 결측률 분석]")

    with temp.open("w", encoding="utf-8") as out:
        for idx, (part, _) in enumerate(parts, start=1):
            with part.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    doc = json.loads(line)
                    stats.add(doc)
                    out.write(line + "\n")

            print(
                f"\r파트 {idx:,}/{len(parts):,} "
                f"| 누적 {stats.total_docs:,}건",
                end="",
                flush=True,
            )

    print()
    temp.replace(merged_path)

    report = stats.report()

    if report:
        with report_path.open(
            "w", encoding="utf-8-sig", newline=""
        ) as f:
            writer = csv.DictWriter(
                f, fieldnames=list(report[0].keys())
            )
            writer.writeheader()
            writer.writerows(report)

    date_missing_or_outside = max(
        0, api_all_count - planned_date_count
    )

    unresolved_count = sum(
        int(x["expected_count"])
        for x in unresolved
    )

    with summary_path.open("w", encoding="utf-8") as f:
        f.write(
            "국립중앙도서관 ISBN 서지정보 데이터 품질 요약\n"
        )
        f.write("=" * 70 + "\n")
        f.write(
            f"날짜조건 없는 API 전체 건수: "
            f"{api_all_count:,}\n"
        )
        f.write(
            f"날짜검색으로 잡힌 계획 건수: "
            f"{planned_date_count:,}\n"
        )
        f.write(
            f"실제 수집/병합 건수: "
            f"{stats.total_docs:,}\n"
        )
        f.write(
            f"날짜검색 미포함 추정 건수: "
            f"{date_missing_or_outside:,}\n"
        )
        f.write(
            f"API 오류 미해결 구간 건수: "
            f"{unresolved_count:,}\n"
        )

        coverage = (
            stats.total_docs / api_all_count * 100
            if api_all_count else 0
        )
        f.write(
            f"전체 API 대비 최종 커버리지: "
            f"{coverage:.4f}%\n\n"
        )

        if unresolved:
            f.write("[미해결 구간]\n")
            for x in unresolved:
                f.write(
                    f"{x['start']}~{x['end']} : "
                    f"{x['expected_count']:,}건 "
                    f"({x['reason']})\n"
                )
            f.write("\n")

        f.write("[결측률 높은 필드 TOP 20]\n")
        for row in report[:20]:
            f.write(
                f"{row['field']}: "
                f"{row['effective_missing_count']:,}/"
                f"{row['total_count']:,} "
                f"({row['effective_missing_rate_percent']:.2f}%)\n"
            )

        f.write("\n[결측률 낮은 필드 TOP 20]\n")
        for row in sorted(
            report,
            key=lambda x: (
                x["effective_missing_rate_percent"],
                x["field"],
            ),
        )[:20]:
            f.write(
                f"{row['field']}: "
                f"{row['effective_missing_count']:,}/"
                f"{row['total_count']:,} "
                f"({row['effective_missing_rate_percent']:.2f}%)\n"
            )

    return stats.total_docs


def main():
    parser = argparse.ArgumentParser(
        description=(
            "국립중앙도서관 ISBN 전체연도 "
            "동적 날짜분할 안정 수집기"
        )
    )

    parser.add_argument(
        "--start",
        type=parse_date,
        default=parse_date("19000101"),
        help="수집 시작일 기본 19000101",
    )
    parser.add_argument(
        "--end",
        type=parse_date,
        default=parse_date("20991231"),
        help="수집 종료일 기본 20991231",
    )
    parser.add_argument(
        "--safe-limit",
        type=int,
        default=20000,
        help="초기 한 구간 최대 건수 기본 20000",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="기본 page_size=100",
    )
    parser.add_argument(
        "--deposit-yn",
        choices=["Y", "N", "ALL"],
        default="Y",
    )
    parser.add_argument(
        "--ebook-yn",
        choices=["Y", "N", "ALL"],
        default="ALL",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.5,
        help="정상 요청 간격 기본 0.5초",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=5,
        help="구간 분할 전 재시도 횟수 기본 5",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
    )
    parser.add_argument(
        "--output-dir",
        default="nl_isbn_split_output",
        help=(
            "기존 split 프로그램 결과와 같은 폴더를 사용해 "
            "완료 파트 재사용"
        ),
    )
    parser.add_argument(
        "--key",
        default=os.getenv("NL_API_KEY"),
    )

    args = parser.parse_args()

    if args.start > args.end:
        parser.error("시작일이 종료일보다 늦을 수 없습니다.")

    key = args.key or getpass.getpass(
        "국립중앙도서관 API Key: "
    ).strip()

    if not key:
        parser.error("API Key가 필요합니다.")

    deposit = (
        None if args.deposit_yn == "ALL"
        else args.deposit_yn
    )
    ebook = (
        None if args.ebook_yn == "ALL"
        else args.ebook_yn
    )

    outdir = Path(args.output_dir)
    raw_dir = outdir / "raw"
    processed_dir = outdir / "processed"
    reports_dir = outdir / "reports"
    metadata_dir = outdir / "metadata"
    parts_dir = raw_dir / "parts"

    for directory in (
        raw_dir,
        processed_dir,
        reports_dir,
        metadata_dir,
        parts_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    cache = CountCache(
        metadata_dir / "range_count_cache.json"
    )

    client = ApiClient(
        key=key,
        default_page_size=args.page_size,
        deposit_yn=deposit,
        ebook_yn=ebook,
        retries=args.retries,
        timeout=args.timeout,
    )

    placeholders = {
        x.lower() for x in DEFAULT_PLACEHOLDERS
    }

    print("[1/4] 전체 건수 확인")
    api_all_count = client.all_count()
    print(f"API 전체 건수: {api_all_count:,}")

    print("\n[2/4] 초기 안전 구간 계획")
    ranges = build_initial_safe_ranges(
        client=client,
        cache=cache,
        start=args.start,
        end=args.end,
        safe_limit=args.safe_limit,
        sleep_sec=args.sleep,
    )

    planned_count = sum(c for _, _, c in ranges)
    print(f"\n초기 안전 구간 수: {len(ranges):,}")
    print(f"날짜범위 내 총 건수: {planned_count:,}")
    print(
        f"날짜 조건 없는 전체와 차이: "
        f"{api_all_count - planned_count:+,}"
    )

    range_plan_path = metadata_dir / "range_plan.json"
    range_plan_path.write_text(
        json.dumps(
            [
                {
                    "start": fmt(start),
                    "end": fmt(end),
                    "count": int(count),
                }
                for start, end, count in ranges
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\n[3/4] 동적 수집")
    all_results = []
    unresolved = []

    for idx, (s, e, count) in enumerate(ranges, start=1):
        print(
            f"\n===== 초기 구간 {idx}/{len(ranges)} ====="
        )

        results = collect_adaptively(
            client=client,
            cache=cache,
            start=s,
            end=e,
            expected_count=count,
            parts_dir=parts_dir,
            sleep_sec=args.sleep,
            page_size=args.page_size,
            unresolved=unresolved,
        )

        all_results.extend(results)

    unresolved_path = metadata_dir / "unresolved_ranges.json"
    unresolved_path.write_text(
        json.dumps(
            unresolved,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\n[4/4] 병합 및 결측률 분석")

    merged_path = processed_dir / "books_all_years.jsonl"
    report_path = reports_dir / "missing_report_all_years.csv"
    summary_path = (
        reports_dir / "data_quality_summary_all_years.txt"
    )

    actual = merge_and_analyze(
        part_results=all_results,
        merged_path=merged_path,
        placeholders=placeholders,
        report_path=report_path,
        summary_path=summary_path,
        api_all_count=api_all_count,
        planned_date_count=planned_count,
        unresolved=unresolved,
    )

    print("\n완료")
    print(f"실제 병합 건수: {actual:,}")
    print(f"원본 데이터 : {merged_path.resolve()}")
    print(f"결측률 CSV  : {report_path.resolve()}")
    print(f"요약 TXT    : {summary_path.resolve()}")
    print(f"미해결 구간 : {unresolved_path.resolve()}")

    if unresolved:
        print(
            "\n주의: API 자체 오류로 끝까지 수집하지 못한 "
            f"날짜 구간이 {len(unresolved)}개 있습니다."
        )
    else:
        print(
            "\n날짜 범위 내 모든 구간을 정상 수집했습니다."
        )


if __name__ == "__main__":
    main()
