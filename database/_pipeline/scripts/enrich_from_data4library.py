#!/usr/bin/env python3
"""정보나루 usageAnalysisList 로 도서 텍스트·메타데이터·이용분석을 보강한다.

우선순위 큐(build_enrich_queue.py 산출) 순서대로 ISBN 당 1호출.
언제 중단되어도 그 시점까지가 가장 값어치 있도록 수요 상위부터 훑는다.

왜 srchDtlList 가 아니라 usageAnalysisList 인가 (2026-08-28 전수 확인)
  정보나루 공식 API 12개를 매뉴얼과 실호출로 전부 대조했다.
  두 엔드포인트는 **서지와 책소개를 채움율까지 똑같이** 준다.
  차이는 부가 블록뿐이고, 지연도 둘 다 중앙 14.8초로 같다.

    srchDtlList 에만    isbn(ISBN10) · publication_date · 지역/연령/성별 대출
    usageAnalysis 에만  keywords · coLoanBooks · maniaRec · readerRec
                        loanHistory(월별 12개월+전국순위) · loanGrps(연령x성별 교차)

  잃는 것은 실질이 없다 — ISBN10 은 ISBN13 에서 유도되고, 발행일은 연도로 충분하며,
  지역별 대출은 근처 도서관 기능을 배제해 쓸 데가 없다. 연령/성별은 loanGrps 의
  교차 분포가 오히려 정보량이 많고 채움율도 높다 (63~64% -> 74%).

  얻는 것은 크다. **coLoanBooks 는 이미 계산된 item-item 협업필터링 결과다.**
  보유 원장에는 개인 식별자가 없어 우리가 직접 만들 수 없는 신호인데,
  정보나루가 계산해서 준다. loanHistory 는 별도 스냅샷 수집 없이 랭킹 신호를 준다.

주의 — 이 API 로도 못 채우는 것
  **목차와 긴 요약은 정보나루 12개 API 어디에도 없다.** 매뉴얼 전문(41,016자)에
  '목차' 0회, '요약' 0회다. 그것은 국중 URL 회수분에서만 나온다
  (recover_nl_url_text.py -> 목차 79,720건, 요약 19,974건).

실측 파라미터 (2026-08-27~28)
  서버가 7.5건/초에서 포화한다. 워커를 24 -> 160 으로 늘려도 지연만 는다.
  포화 무릎인 48워커를 쓴다.

일일 상한 — 실측 약 3만 호출
  상한에 걸리면 JSON 에러가 아니라 **연결을 그냥 끊는다**(WinError 10054).
  그래서 메시지뿐 아니라 연속 실패 누적으로도 판정한다.
  상한으로 판정하면 전량 정지하고 그 자리에서 종료한다. 진행은 파일에 남는다.
  (`--wait` 를 주면 자정까지 대기했다가 재개하지만, 노트북이 상시 켜져 있지 않다.)

  3만/일 기준 954,776건 완주는 32일. 1단(노출 90%, 301,154건)만이면 10일.

출력
  d4l_usage.jsonl — 이 스크립트의 산출물
  d4l_enriched.jsonl 는 srchDtlList 시절 수집분(28,124건)이다. 대체되지만
  재수집이 검증될 때까지 지우지 않는다.

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
OUT = DATA / "d4l_usage.jsonl"
LOCK = DATA / "d4l_enrich.lock"
API = "http://data4library.kr/api/usageAnalysisList"

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


def books_of(body: dict, key: str, cap: int = 10) -> list:
    """coLoanBooks / maniaRecBooks / readerRecBooks 를 [ISBN, 제목] 로 접는다.

    추천 대상은 ISBN 만 있으면 우리 카탈로그로 되짚을 수 있다. 제목은
    조인이 깨졌을 때 눈으로 확인하려고 남긴다. 서지 전체를 넣으면
    95만 행에서 파일이 몇 배로 불어난다.
    """
    out = []
    for item in (body.get(key) or [])[:cap]:
        book = item.get("book") or {}
        isbn = (book.get("isbn13") or "").strip()
        if isbn:
            out.append([isbn, (book.get("bookname") or "").strip()[:60]])
    return out


def shape(isbn: str, body: dict) -> dict:
    book = body.get("book") or {}
    if not book:
        with lock:
            state["miss"] += 1
        return {"isbn13": isbn, "ok": False}

    description = html.unescape((book.get("description") or "").strip())
    with lock:
        state["hit"] += 1

    record = {
        # ── 서지 (srchDtlList 와 채움율까지 동일) ──
        "bookname": (book.get("bookname") or "").strip(),
        "authors": (book.get("authors") or "").strip(),
        "publisher": (book.get("publisher") or "").strip(),
        "pub_year": (book.get("publication_year") or "").strip(),
        "vol": (book.get("vol") or "").strip(),
        "class_no": (book.get("class_no") or "").strip(),
        "class_nm": (book.get("class_nm") or "").strip(),
        "add_symbol": (book.get("addition_symbol") or "").strip(),
        "img": (book.get("bookImageURL") or "").strip(),
        "desc": description,
        "desc_len": len(description),
        "loan_total": book.get("loanCnt") or 0,

        # ── 키워드: [단어, 가중치] ──
        "keywords": [[k.get("keyword", {}).get("word", ""),
                      k.get("keyword", {}).get("weight", "")]
                     for k in (body.get("keywords") or [])[:50]
                     if (k.get("keyword") or {}).get("word")],

        # ── 협업필터링 신호 ──
        # 보유 원장에는 개인 식별자가 없어 우리가 못 만드는 신호다.
        "co_loan": books_of(body, "coLoanBooks"),
        "mania_rec": books_of(body, "maniaRecBooks"),
        "reader_rec": books_of(body, "readerRecBooks"),

        # ── 랭킹 신호: [연월, 대출수, 전국순위] 12개월 ──
        "loan_history": [[h.get("loan", {}).get("month", ""),
                          h.get("loan", {}).get("loanCnt", 0),
                          h.get("loan", {}).get("ranking", 0)]
                         for h in (body.get("loanHistory") or [])],

        # ── 인구통계: [연령, 성별, 대출수, 순위] 교차 분포 ──
        "loan_grps": [[g.get("loanGrp", {}).get("age", ""),
                       g.get("loanGrp", {}).get("gender", ""),
                       g.get("loanGrp", {}).get("loanCnt", 0),
                       g.get("loanGrp", {}).get("ranking", 0)]
                      for g in (body.get("loanGrps") or [])],
    }
    # 빈 값은 버려 파일 크기를 줄인다 (95만 행이면 차이가 크다)
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
    params = {"isbn13": isbn, "authKey": key, "format": "json"}
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
            if not args.wait:
                print("    오늘 몫 소진 — 종료한다. 내일 그대로 다시 실행하면 이어진다.")
                print("       py scripts/" + Path(__file__).name)
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
    parser.add_argument("--wait", action="store_true",
                        help="상한에 걸리면 KST 자정까지 대기 후 자동 재개 "
                             "(기본은 즉시 종료 — 노트북이 상시 켜져 있지 않다)")
    args = parser.parse_args()

    acquire_lock()
    try:
        return run(args)
    finally:
        release_lock()


if __name__ == "__main__":
    raise SystemExit(main())
