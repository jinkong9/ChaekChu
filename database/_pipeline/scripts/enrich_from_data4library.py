#!/usr/bin/env python3
"""정보나루 srchDtlList 로 도서 텍스트·메타데이터를 보강한다.

우선순위 큐(build_enrich_queue.py 산출) 순서대로 ISBN 당 1호출.
언제 중단되어도 그 시점까지가 가장 값어치 있도록 수요 상위부터 훑는다.

실측 파라미터 (2026-08-27, IP 등록 후)
  서버가 7.5건/초에서 포화한다. 워커를 24 -> 160 으로 늘려도
  스루풋은 5.0 -> 7.4 로만 오르고 지연이 4.9초 -> 19.7초로 늘 뿐이다.
  즉 더 세게 밀어도 얻는 것이 없다. 포화 무릎인 48워커를 쓴다.
  (앞선 '54건/초' 측정은 같은 ISBN 반복이라 서버 캐시를 탄 잘못된 값이었다)

일일 상한 — 실측 약 3만 호출 (2026-08-27 확정)
  공식 문서에는 '미등록 IP 1일 500건' 만 있고 등록 후 상한은 비공개다.
  실측 경과:  24,000 확보율 100.0%
              26,000 확보율  97.9%   <- 서버가 조용히 거절하기 시작
              31,756 연결 강제 종료 (WinError 10054)

  **상한에 걸리면 JSON 에러가 아니라 연결을 그냥 끊는다.** 그래서
  메시지 감지만으로는 부족하고 연속 실패 누적으로도 판정한다.
  차단으로 판정하면 전량 정지 -> KST 자정 대기 -> 자동 재개.
  진행은 파일에 남으므로 손실은 없다.

  3만/일 기준 954,776건 완주는 32일. 1단(노출 90%)만이면 10일.

수집 필드 (응답에 있는 것 중 쓸모 있는 것은 남긴다)
  description  주 목적. 임베딩 입력
  class_no/nm  KDC. 국중에 없는 정보나루 전용 33만 건의 분류를 메운다
  add_symbol   부가기호 (독자대상·발행형태 -> 아동/전자책 판별)
  bookImageURL 표지. 서비스 UI 에 필요
  서지 4종      제목·저자·출판사·발행연도. 국중 미수록 건의 유일한 서지
  age/gender   연령대·성별 대출 분포와 순위. 콜드스타트 개인화 신호

실행
    py scripts/enrich_from_data4library.py                # 이어서 수집
    py scripts/enrich_from_data4library.py --limit 5000   # 맛보기
    py scripts/enrich_from_data4library.py --workers 24   # 더 얌전하게
"""

from __future__ import annotations

import argparse
import html
import json
import os
import signal
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = Path(r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal")
ENV = BASE / ".env"
DATA = BASE / "data4library"
QUEUE = DATA / "enrich_queue.csv"
OUT = DATA / "d4l_enriched.jsonl"
LOCK = DATA / "d4l_enrich.lock"
API = "http://data4library.kr/api/srchDtlList"

WORKERS = 48          # 포화 무릎. 이 이상은 지연만 늘어난다
FLUSH_EVERY = 200
REPORT_EVERY = 2000
KST = timezone(timedelta(hours=9))

state = {"calls": 0, "hit": 0, "miss": 0, "error": 0, "streak": 0,
         "blocked": False, "stop": False, "block_msg": ""}
lock = threading.Lock()

# 상한에 걸리면 서버가 JSON 에러가 아니라 **연결을 그냥 끊는다**(WinError 10054).
# 실측: 하루 약 3만 호출 지점에서 먼저 확보율이 떨어지고, 곧이어 리셋이 쏟아진다.
# 그래서 메시지뿐 아니라 '연속 실패 누적' 으로도 상한을 판정한다.
FAIL_STREAK_BLOCK = 40


# ── 단일 프로세스 강제 ────────────────────────────────────────
# 전에 중복 기동으로 출력 파일을 깨먹은 적이 있다. 같은 실수를 막는다.
def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def acquire_lock() -> None:
    if LOCK.exists():
        try:
            pid = int(LOCK.read_text().strip())
        except (ValueError, OSError):
            pid = -1
        if pid > 0 and pid_alive(pid):
            raise SystemExit(f"이미 실행 중이다 (PID {pid}). 중복 기동 금지.\n"
                             f"정말 죽은 프로세스라면 {LOCK} 를 지워라.")
        print(f"[경고] 남은 락 (PID {pid}) — 죽은 프로세스로 보고 이어받는다")
    LOCK.write_text(str(os.getpid()))


def release_lock() -> None:
    try:
        if LOCK.exists() and LOCK.read_text().strip() == str(os.getpid()):
            LOCK.unlink()
    except OSError:
        pass


def load_key() -> str:
    raw = ENV.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949", "replace")
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("정보나루") and "=" in line:
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("`.env` 에 정보나루 키가 없다")


def load_done() -> set:
    """이미 처리한 ISBN. 깨진 줄은 건너뛴다(다음 회차에 다시 시도된다)."""
    if not OUT.exists():
        return set()
    done = set()
    with OUT.open(encoding="utf-8") as source:
        for line in source:
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["isbn13"])
            except (json.JSONDecodeError, KeyError):
                continue
    return done


def demographic(body: dict, block_name: str, item_key: str) -> list:
    for block in body.get("loanInfo") or []:
        rows = block.get(block_name)
        if isinstance(rows, list):
            return [[r[item_key].get("name"), r[item_key].get("loanCnt"),
                     r[item_key].get("ranking")]
                    for r in rows if isinstance(r.get(item_key), dict)]
    return []


def shape(isbn: str, body: dict) -> dict:
    detail = body.get("detail") or []
    book = (detail[0].get("book") or {}) if detail else {}
    if not book:
        with lock:
            state["miss"] += 1
        return {"isbn13": isbn, "ok": False}

    description = html.unescape((book.get("description") or "").strip())
    with lock:
        state["hit"] += 1
    record = {
        "bookname": (book.get("bookname") or "").strip(),
        "authors": (book.get("authors") or "").strip(),
        "publisher": (book.get("publisher") or "").strip(),
        "pub_year": (book.get("publication_year") or "").strip(),
        "vol": (book.get("vol") or "").strip(),
        "isbn10": (book.get("isbn") or "").strip(),
        "class_no": (book.get("class_no") or "").strip(),
        "class_nm": (book.get("class_nm") or "").strip(),
        "add_symbol": (book.get("addition_symbol") or "").strip(),
        "desc": description,
        "desc_len": len(description),
        "img": (book.get("bookImageURL") or "").strip(),
        "age": demographic(body, "ageResult", "age"),
        "gender": demographic(body, "genderResult", "gender"),
    }
    # 빈 값은 버려 파일 크기를 줄인다 (85만 행이면 차이가 크다)
    slim = {k: v for k, v in record.items() if v not in ("", [], None, 0)}
    return {"isbn13": isbn, "ok": True, **slim}


def note_failure(reason: str) -> None:
    """실패를 세고, 연속 실패가 쌓이면 일일 상한으로 판정한다."""
    with lock:
        state["error"] += 1
        state["streak"] += 1
        if state["streak"] >= FAIL_STREAK_BLOCK and not state["blocked"]:
            state["blocked"] = True
            state["block_msg"] = (f"연속 실패 {state['streak']}회 ({reason}) "
                                  f"— 일일 상한으로 판정")
            state["stop"] = True


def declare_block(message: str) -> None:
    with lock:
        if not state["blocked"]:
            state["blocked"] = True
            state["block_msg"] = message
        state["stop"] = True


def fetch(key: str, isbn: str) -> dict:
    """성공 시 레코드, 차단·영구실패 시 None."""
    params = {"isbn13": isbn, "loaninfoYN": "Y", "authKey": key, "format": "json"}
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "b102-enrich/1.0"})

    for attempt in range(3):
        if state["stop"]:
            return None
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            note_failure(f"HTTP {error.code}")
            return None
        # OSError 를 반드시 포함해야 한다. ConnectionResetError 는 OSError 이지
        # URLError 가 아니라서, 상한에 걸린 순간 이 예외가 pool.map 밖으로
        # 튀어나가 실행 전체를 죽인 적이 있다 (2026-08-27, 28,124건 지점).
        except (URLError, TimeoutError, OSError, json.JSONDecodeError):
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            note_failure("연결 끊김")
            return None

        body = payload.get("response") or {}
        message = body.get("error") or ""
        if message and ("500건" in message or "IP" in message or "초과" in message):
            declare_block(message)
            return None

        with lock:
            state["calls"] += 1
            state["streak"] = 0
        return shape(isbn, body)
    return None


def seconds_to_kst_midnight() -> float:
    now = datetime.now(KST)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=5,
                                                 second=0, microsecond=0)
    return (tomorrow - now).total_seconds()


def drain(key: str, pending: list, workers: int) -> int:
    """차단이나 중단이 올 때까지 처리하고, 기록한 건수를 돌려준다.

    쓰기는 단일 지점에서 락을 잡고 한다. 여러 지점에서 append 하면
    행이 찢어진다 (회수 작업에서 실제로 겪었다).
    """
    sink = OUT.open("a", encoding="utf-8")
    write_lock = threading.Lock()
    counter = {"n": 0}
    started = time.time()
    total = len(pending)

    def run_one(isbn: str):
        if state["stop"]:
            return None
        return fetch(key, isbn)

    def worker(isbn: str) -> None:
        # 워커에서 예외가 새어 나가면 pool.map 이 그 자리에서 다시 던져
        # 실행 전체가 죽는다. 어떤 예외도 여기서 끝낸다.
        try:
            record = run_one(isbn)
        except Exception as error:                       # noqa: BLE001
            note_failure(type(error).__name__)
            return
        if record is None:
            return
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with write_lock:
            sink.write(line + "\n")
            counter["n"] += 1
            n = counter["n"]
            if n % FLUSH_EVERY == 0:
                sink.flush()
                os.fsync(sink.fileno())
            if n % REPORT_EVERY == 0:
                elapsed = time.time() - started
                rate = n / elapsed if elapsed else 0
                left = (total - n) / rate if rate else 0
                print(f"  {n:>7,} / {total:,}  {rate:>4.1f}건/초  "
                      f"확보 {100*state['hit']/max(state['calls'],1):>4.1f}%  "
                      f"남은시간 {left/3600:>5.1f}h  "
                      f"({datetime.now(KST):%m-%d %H:%M})", flush=True)

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(worker, pending))
    finally:
        sink.flush()
        os.fsync(sink.fileno())
        sink.close()
    return counter["n"]


def summary() -> None:
    print("\n=== 이번 실행 결과 ===")
    print(f"  호출        {state['calls']:>9,}")
    print(f"  서지 확보   {state['hit']:>9,}")
    print(f"  미수록      {state['miss']:>9,}")
    print(f"  오류        {state['error']:>9,}")
    if OUT.exists():
        print(f"  누적 파일   {OUT.stat().st_size/1024/1024:>8.1f} MB")


def run(args) -> int:
    key = load_key()
    lines = QUEUE.read_text(encoding="utf-8").splitlines()[1:]
    targets = [line.split(",")[0] for line in lines]
    done = load_done()
    pending = [i for i in targets if i not in done]
    if args.limit:
        pending = pending[:args.limit]

    print(f"큐 {len(targets):,}건 · 완료 {len(done):,}건 · 이번 대상 {len(pending):,}건")
    print(f"워커 {args.workers} (서버 포화 7.5건/초 — 더 늘려도 지연만 는다)")
    print(f"출력 {OUT}\n", flush=True)
    if not pending:
        print("남은 대상이 없다.")
        return 0

    def graceful(signum, frame):
        print("\n중단 신호 — 진행분을 저장하고 종료한다", flush=True)
        state["stop"] = True

    signal.signal(signal.SIGINT, graceful)
    signal.signal(signal.SIGTERM, graceful)

    while pending:
        written = drain(key, pending, args.workers)
        pending = [i for i in pending[written:]] if written else pending
        if state["blocked"]:
            wait = seconds_to_kst_midnight()
            print(f"\n*** 일일 상한 도달: \"{state['block_msg']}\"")
            print(f"    이번 실행 누적 {state['calls']:,}호출 / 남은 대상 {len(pending):,}건")
            if args.no_wait:
                print("    --no-wait — 종료한다. 그대로 다시 실행하면 이어진다")
                break
            print(f"    KST 자정까지 {wait/3600:.1f}시간 대기 후 자동 재개", flush=True)
            slept = 0.0
            while slept < wait and not state["stop"]:
                time.sleep(min(60, wait - slept))
                slept += 60
            if state["stop"] and not state["blocked"]:
                break
            state["blocked"] = False
            state["stop"] = False
            print(f"\n=== 재개 {datetime.now(KST):%Y-%m-%d %H:%M} KST ===", flush=True)
            continue
        if state["stop"]:
            break                       # 사용자 중단
        if not written:
            break                       # 더 못 나아간다
    summary()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=WORKERS)
    parser.add_argument("--limit", type=int, default=0,
                        help="이번 실행에서 처리할 최대 건수")
    parser.add_argument("--no-wait", action="store_true",
                        help="차단되면 자정까지 기다리지 않고 즉시 종료")
    args = parser.parse_args()

    acquire_lock()
    try:
        return run(args)
    finally:
        release_lock()


if __name__ == "__main__":
    raise SystemExit(main())
