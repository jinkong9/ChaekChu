#!/usr/bin/env python3
"""카카오 도서 API 로 텍스트·서지를 보강한다.

정보나루 보강기(enrich_from_data4library.py)와 **같은 우선순위 큐**를 쓴다.
같은 순서로 훑으므로 앞부분은 정보나루 수집분과 그대로 겹치고,
그 겹치는 구간이 두 소스를 나란히 비교하는 실험 표본이 된다.

두 소스의 관계 (실측 375쌍, 2026-08-27)
  길이        정보나루 중앙 145자 / 카카오 중앙 251자
  절단        정보나루 0.5% / 카카오 84.5% — 카카오는 250자 하드캡
  내용 겹침   6-gram 포함률 중앙 0.06. **65.9% 가 거의 다른 문장**
  성격        카카오는 줄거리 중심, 정보나루는 작품 위치·의의 중심

  즉 카카오는 커버리지로는 +2.7%p 뿐이지만 내용으로는 새 정보를 더한다.

수집 필드
  contents   250자 스니펫. 줄거리 중심이라 임베딩 입력으로 값어치가 있다
  서지        제목·저자·번역자·출판사·발행일
  status     판매 상태 (절판/품절 판별)
  price      정가·판매가
  thumbnail  표지

실행
    py scripts/enrich_from_kakao.py                 # 이어서 수집 (하루 몫 소진하면 종료)
    py scripts/enrich_from_kakao.py --limit 5000    # 맛보기
    py scripts/enrich_from_kakao.py --wait          # 자정까지 기다렸다 재개
"""

from __future__ import annotations

import argparse
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
OUT = BASE / "kakao_enriched.jsonl"
LOCK = BASE / "kakao_enrich.lock"
API = "https://dapi.kakao.com/v3/search/book"

WORKERS = 16
FLUSH_EVERY = 200
REPORT_EVERY = 2000
KST = timezone(timedelta(hours=9))
FAIL_STREAK_BLOCK = 40      # 정보나루가 그랬듯 상한이 조용히 올 수 있다

state = {"calls": 0, "hit": 0, "miss": 0, "error": 0, "streak": 0,
         "blocked": False, "stop": False, "block_msg": ""}
lock = threading.Lock()


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
            raise SystemExit(f"이미 실행 중이다 (PID {pid}). 중복 기동 금지.")
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
        if line.startswith("카카오") and "=" in line:
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("`.env` 에 카카오 키가 없다")


def load_done() -> set:
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


def note_failure(reason: str) -> None:
    with lock:
        state["error"] += 1
        state["streak"] += 1
        if state["streak"] >= FAIL_STREAK_BLOCK and not state["blocked"]:
            state["blocked"] = True
            state["block_msg"] = f"연속 실패 {state['streak']}회 ({reason}) — 상한으로 판정"
            state["stop"] = True


def declare_block(message: str) -> None:
    with lock:
        if not state["blocked"]:
            state["blocked"] = True
            state["block_msg"] = message
        state["stop"] = True


def shape(isbn: str, doc: dict) -> dict:
    if not doc:
        with lock:
            state["miss"] += 1
        return {"isbn13": isbn, "ok": False}
    contents = (doc.get("contents") or "").strip()
    with lock:
        state["hit"] += 1
    record = {
        "title": (doc.get("title") or "").strip(),
        "authors": [a for a in (doc.get("authors") or []) if a],
        "translators": [t for t in (doc.get("translators") or []) if t],
        "publisher": (doc.get("publisher") or "").strip(),
        "datetime": (doc.get("datetime") or "")[:10],
        "status": (doc.get("status") or "").strip(),
        "price": doc.get("price") or 0,
        "sale_price": doc.get("sale_price") or 0,
        "thumbnail": (doc.get("thumbnail") or "").strip(),
        "contents": contents,
        "contents_len": len(contents),
    }
    slim = {k: v for k, v in record.items() if v not in ("", [], None, 0)}
    return {"isbn13": isbn, "ok": True, **slim}


def fetch(key: str, isbn: str) -> dict:
    url = API + "?" + urllib.parse.urlencode({"query": isbn, "target": "isbn"})
    request = urllib.request.Request(url, headers={
        "Authorization": f"KakaoAK {key}", "User-Agent": "b102-kakao/1.0"})

    for attempt in range(3):
        if state["stop"]:
            return None
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except HTTPError as error:
            # 카카오는 쿼터 소진을 429 가 아니라 **400** 으로 준다 (실측 2026-08-28).
            #   {"errorType":"BadRequest","message":"API limit has been exceeded.", ...}
            # 400 을 일반 오류로 처리하면 연속 실패만 1,400회 쌓이고 원인을 못 짚는다.
            if error.code in (400, 429):
                try:
                    detail = error.read().decode("utf-8", "replace")[:200]
                except Exception:                        # noqa: BLE001
                    detail = ""
                if error.code == 429 or "limit has been exceeded" in detail:
                    declare_block(f"HTTP {error.code} — 일일 쿼터 소진 ({detail[:80]})")
                    return None
                note_failure(f"HTTP 400 {detail[:40]}")
                return None
            if error.code in (500, 502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            note_failure(f"HTTP {error.code}")
            return None
        except (URLError, TimeoutError, OSError, json.JSONDecodeError):
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            note_failure("연결 끊김")
            return None

        docs = payload.get("documents") or []
        with lock:
            state["calls"] += 1
            state["streak"] = 0
        return shape(isbn, docs[0] if docs else {})
    return None


def seconds_to_kst_midnight() -> float:
    now = datetime.now(KST)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=5,
                                                 second=0, microsecond=0)
    return (tomorrow - now).total_seconds()


def drain(key: str, pending: list, workers: int) -> int:
    sink = OUT.open("a", encoding="utf-8")
    write_lock = threading.Lock()
    counter = {"n": 0}
    started = time.time()
    total = len(pending)

    def worker(isbn: str) -> None:
        try:
            record = None if state["stop"] else fetch(key, isbn)
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
                print(f"  {n:>7,} / {total:,}  {rate:>5.1f}건/초  "
                      f"매칭 {100*state['hit']/max(state['calls'],1):>4.1f}%  "
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
    print(f"  매칭        {state['hit']:>9,}")
    print(f"  미매칭      {state['miss']:>9,}")
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
    print(f"워커 {args.workers} · 출력 {OUT}\n", flush=True)
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
        pending = pending[written:] if written else pending
        if state["blocked"]:
            wait = seconds_to_kst_midnight()
            print(f"\n*** 상한 도달: \"{state['block_msg']}\"")
            print(f"    이번 실행 누적 {state['calls']:,}호출 / 남은 {len(pending):,}건")
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
        if state["stop"] or not written:
            break
    summary()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=WORKERS)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--wait", action="store_true",
                        help="상한에 걸리면 KST 자정까지 대기 후 자동 재개 "
                             "(기본은 즉시 종료)")
    args = parser.parse_args()

    acquire_lock()
    try:
        return run(args)
    finally:
        release_lock()


if __name__ == "__main__":
    raise SystemExit(main())
