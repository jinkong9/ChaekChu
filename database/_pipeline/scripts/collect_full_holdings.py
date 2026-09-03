#!/usr/bin/env python3
"""정보나루 관별 장서/대출 원장을 **원본 그대로** 내려받는다.

왜 다시 만드는가
  예전 수집기는 저장소에 커밋된 적이 없어 소실됐고, 파생물인 `shards/*.csv` 는
  13컬럼 중 `ISBN, 도서권수, 대출건수` 셋만 남긴 축약본이었다.
  **도서명·저자·출판사·발행년도·주제분류번호(KDC)가 통째로 버려졌다.**
  KDC 는 279만 종을 쿼터 없이 덮을 수 있는 소스인데 그것을 잃은 셈이다.

원본 13컬럼
  번호, 도서명, 저자, 출판사, 발행년도, ISBN, 세트 ISBN,
  부가기호, 권, 주제분류번호, 도서권수, 대출건수, 등록일자

내려받는 방법 (2026-09-03 실측)
  1) GET  /openDataL              세션 쿠키(JSESSIONID)와 `_csrf` 를 받는다
  2) POST /openDataV              libcode=<lib_id> -> 월별 파일 목록
  3) GET  /comn/fileDownload?cn=  해당 월 CSV (로그인 불필요, API 쿼터와 무관)

  **월별 파일은 증분이 아니라 전량 스냅샷이다.** 실측으로 확인했다 —
  2.28도서관 8월/7월 파일을 대조하니 대출 감소가 0건, 776종이 증가,
  고유 ISBN 54,693 vs 54,692 였다. 즉 대출건수는 **누적값**이고
  **최신 파일 하나만 받으면 전 기간이 들어온다.**

월별 자동화
  `manifest.json` 에 관별로 (cn, 제공일, 행수, 바이트, 받은 시각) 을 남긴다.
  다시 돌리면 사이트의 최신 cn 과 대조해 **바뀐 관만** 내려받는다.
  매달 이 스크립트를 그대로 실행하면 된다.

    py scripts/collect_full_holdings.py                # 새/갱신된 것만
    py scripts/collect_full_holdings.py --force        # 전량 다시
    py scripts/collect_full_holdings.py --limit 20     # 맛보기
    py scripts/collect_full_holdings.py --workers 4    # 더 얌전하게

서버 예절
  이 서버는 무거운 API 에서 하루 몇 번씩 504 를 낸다. 같은 서버를 두들기므로
  동시 6 이하로 돌리고, 실패는 지수 백오프로 재시도한다.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
DATA = BASE / "data4library"
RAW = DATA / "holdings_raw"
MANIFEST = DATA / "holdings_manifest.json"
LIBS = DATA / "libraries.parquet"

SITE = "https://www.data4library.kr"
LIST_URL = SITE + "/openDataL"
DETAIL_URL = SITE + "/openDataV"
FILE_URL = SITE + "/comn/fileDownload?cn="

KST = timezone(timedelta(hours=9))
WORKERS = 6                 # 서버가 약하다. 더 올리지 말 것
TIMEOUT = 180               # 관당 10MB 를 받는다
RETRY = 3
NL = chr(10)

state = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0, "stop": False}
lock = threading.Lock()


def make_session() -> tuple:
    """세션 쿠키와 CSRF 토큰을 받는다. (opener, csrf)"""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0 (b102-holdings/1.0)"),
                         ("Referer", LIST_URL)]
    html = opener.open(LIST_URL, timeout=60).read().decode("utf-8", "replace")
    m = re.search(r'name="_csrf"\s+value="([^"]+)"', html)
    if not m:
        raise SystemExit("CSRF 토큰을 찾지 못했다 — 사이트 구조가 바뀌었을 수 있다")
    return opener, m.group(1)


def load_libraries(limit: int = 0) -> list:
    """수집 대상 관 목록. libraries.parquet 이 있으면 그것을 쓴다."""
    if LIBS.exists():
        import duckdb
        con = duckdb.connect()
        rows = con.execute(
            f"SELECT lib_id, lib_name FROM read_parquet('{LIBS.as_posix()}') "
            "ORDER BY lib_id").fetchall()
        con.close()
    else:
        raise SystemExit(f"{LIBS} 가 없다. 관 목록을 먼저 만들어야 한다")
    return rows[:limit] if limit else rows


def latest_file(opener, csrf: str, lib_id) -> tuple:
    """그 관의 **최신** 파일 (cn, 제공일). 없으면 (None, None).

    월별 파일은 전량 스냅샷이라 최신 하나면 충분하다.
    """
    body = urllib.parse.urlencode({
        "_csrf": csrf, "region": "A", "dtl_region": "A", "libType": "",
        "srchLib": "", "srchText": "", "pageNo": "", "pageSize": "",
        "libcode": str(lib_id), "ppn": "1"}).encode()
    page = opener.open(urllib.request.Request(DETAIL_URL, data=body),
                       timeout=90).read().decode("utf-8", "replace")
    cns = re.findall(r"/comn/fileDownload\?cn=(\d+)", page)
    if not cns:
        return None, None
    # **페이지 첫 날짜를 잡으면 안 된다.** 그것은 그 관의 데이터 개시일이라
    # 1,660관이 전부 2017-06-01 로 기록되는 사고가 있었다 (2026-09-03).
    # 최신 다운로드 링크 앞쪽에서 가장 가까운 제공일을 집는다.
    head = page[:page.index("/comn/fileDownload?cn=" + cns[0])]
    near = re.findall(r"데이터 제공일[^0-9]{0,40}(20\d\d-\d\d-\d\d)", head)
    return cns[0], (near[-1] if near else "")


def fetch_csv(opener, cn: str) -> bytes:
    for attempt in range(RETRY):
        try:
            with opener.open(FILE_URL + cn, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError,
                TimeoutError, OSError) as error:
            if attempt == RETRY - 1:
                raise
            # 서버가 약하다. 지수 백오프로 물러선다
            time.sleep(3 * (attempt + 1) ** 2)
    return b""


def decode_csv(raw: bytes) -> str:
    """인코딩을 **한글이 가장 많이 나오는 쪽**으로 고른다.

    대부분 UTF-8 이지만 EUC-KR 로 올라온 관이 섞여 있고, 그중에는
    **어느 인코딩으로도 깨끗하게 안 풀리는** 파일이 있다 (잘못된 바이트 혼입).
    예전 구현은 utf-8 로 먼저 풀어 U+FFFD 를 만든 뒤 euc-kr 을 시도했는데,
    그것마저 예외가 나면 **손상된 쪽을 그대로 돌려줬다.**
    실측 2026-09-03: 1,660관 중 4관(20126·20262·8206·8418)이 이렇게 깨졌다.

    그래서 후보를 전부 관대하게 풀어 보고 한글이 많고 깨진 글자가 적은 쪽을
    택한다. 완벽히 복원되지 않아도 최선을 남긴다.
    """
    # **BOM 은 디코드 전에 뗀다.** 원본에 BOM 은 UTF-8 인데 내용은 CP949 인
    # 기형 파일이 있다. 그대로 CP949 로 풀면 앞 3바이트가 "癤예廢" 가 되어
    # 헤더 첫 칸이 깨진다 (실측 2026-09-03: 4관).
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    probe = raw[:200_000]
    best_enc, best_score = "utf-8", -1e9
    for enc in ("utf-8", "cp949", "euc-kr"):
        try:
            sample = probe.decode(enc, "replace")
        except LookupError:
            continue
        hangul = sum(1 for ch in sample if "\uac00" <= ch <= "\ud7a3")
        broken = sample.count("\ufffd")
        score = (hangul - broken * 3) / max(1, len(sample))
        if score > best_score:
            best_enc, best_score = enc, score
    return raw.decode(best_enc, "replace")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=WORKERS)
    parser.add_argument("--limit", type=int, default=0, help="앞에서 N개 관만")
    parser.add_argument("--force", action="store_true",
                        help="manifest 를 무시하고 전량 다시 받는다")
    args = parser.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    manifest = {}
    if MANIFEST.exists() and not args.force:
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    libs = load_libraries(args.limit)
    print(f"관 {len(libs):,}개 · 워커 {args.workers} · 출력 {RAW}")
    print(f"manifest {len(manifest):,}건 기록됨"
          + (" (--force 로 무시)" if args.force else ""))
    print("월별 파일은 전량 스냅샷이라 관당 최신 1개만 받는다\n", flush=True)

    opener, csrf = make_session()
    started = time.time()

    def one(item) -> None:
        lib_id, lib_name = item
        if state["stop"]:
            return
        key = str(lib_id)
        try:
            cn, served = latest_file(opener, csrf, lib_id)
            if not cn:
                with lock:
                    state["skip"] += 1
                return
            prev = manifest.get(key)
            out = RAW / f"{lib_id}.csv"
            if (prev and prev.get("cn") == cn and out.exists()
                    and not args.force):
                # 파일은 그대로 두되 **메타데이터는 갱신한다.**
                # 조회는 이미 했으므로 공짜다. 제공일 추출 버그로 1,660관이
                # 전부 2017-06-01 로 기록된 적이 있어 이 경로가 필요하다.
                with lock:
                    prev["served"] = served or prev.get("served", "")
                    state["skip"] += 1
                return
            raw = fetch_csv(opener, cn)
            text = decode_csv(raw)
            rows = text.count(NL)
            tmp = out.with_suffix(".part")
            tmp.write_text(text, encoding="utf-8", newline="")
            tmp.replace(out)              # 원자적 교체 — 중간에 죽어도 반쪽 파일이 안 남는다
            with lock:
                manifest[key] = {"lib_id": lib_id, "lib_name": lib_name,
                                 "cn": cn, "served": served, "rows": rows,
                                 "bytes": len(raw),
                                 "at": datetime.now(KST).isoformat(timespec="seconds")}
                state["ok"] += 1
                state["bytes"] += len(raw)
                done = state["ok"] + state["skip"] + state["fail"]
                if state["ok"] % 25 == 0:
                    rate = state["bytes"] / 1048576 / max(1, time.time() - started)
                    left = (len(libs) - done) * (time.time() - started) / max(1, done)
                    print(f"  {done:>5,}/{len(libs):,}  받음 {state['ok']:,} · "
                          f"건너뜀 {state['skip']:,} · 실패 {state['fail']:,}  "
                          f"{state['bytes']/1073741824:.2f}GB · {rate:.1f}MB/s · "
                          f"남은 {left/60:.0f}분", flush=True)
                    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False,
                                                   indent=1), encoding="utf-8")
        except Exception as error:                       # noqa: BLE001
            with lock:
                state["fail"] += 1
                if state["fail"] <= 10:
                    print(f"  [실패] {lib_name}({lib_id}) "
                          f"{type(error).__name__}: {str(error)[:60]}", flush=True)

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(one, libs))
    except KeyboardInterrupt:
        state["stop"] = True
        print("\n중단 — 여기까지 저장한다", flush=True)

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    took = time.time() - started
    print(f"\n=== 결과 ===")
    print(f"  받음      {state['ok']:>6,}관")
    print(f"  건너뜀    {state['skip']:>6,}관  (최신본을 이미 갖고 있다)")
    print(f"  실패      {state['fail']:>6,}관")
    print(f"  용량      {state['bytes']/1073741824:>6.2f} GB")
    print(f"  걸린 시간 {took/60:>6.1f} 분")
    print(f"  manifest  {MANIFEST}")
    if state["fail"]:
        print(f"\n  실패분은 그대로 다시 실행하면 이어받는다 "
              f"(manifest 에 없는 관만 받는다)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
