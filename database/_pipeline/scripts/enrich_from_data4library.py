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

일일 상한 — 키당 3만 호출 (계정 단위. IP 단위가 아니다)
  실측 2026-08-31: 같은 IP 에서 미등록 키 둘이 각각 465·466건씩 따로 500 상한을
  받았다. IP 단위였다면 둘이 500 하나를 나눠 썼어야 한다.
  마이페이지에 **요청이 실제로 나가는 공인 IP** 를 등록해야 3만이 된다.

  상한 도달은 세 가지 얼굴로 온다 — 명시적 JSON 에러 / 연결 강제 종료 /
  **에러도 끊김도 없는 빈 응답**. 마지막 것이 가장 고약하다.
  그래서 증상 추론에 기대지 않고 **키별 사용량을 직접 센다**(KEY_BUDGET).
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
USAGE = DATA / "d4l_key_usage.json"   # 키별 오늘 사용량 (재시작해도 이어진다)
API = "http://data4library.kr/api/usageAnalysisList"

WORKERS = 48          # 포화 무릎. 이 이상은 지연만 늘어난다
FLUSH_EVERY = 200
REPORT_EVERY = 2000
KST = timezone(timedelta(hours=9))
NL = chr(10)

state = {
    "calls": 0, "hit": 0, "miss": 0, "error": 0,
    "blocked": False, "stop": False, "block_msg": "",
    "keys": [], "per_key": {}, "dead": set(), "rr": 0,

    # 연속 실패는 **키별로** 센다. 전역으로 세면 한 키가 쏟아낸 실패가
    # 다른 키를 죽인다 — IP 미등록 키의 실패가 40에 닿는 순간 사용 중이던
    # 정상 키가 소진 처리돼 1,080건에서 멈춘 적이 있다 (2026-08-31).
    "streak": {}, "miss_streak": {},

    # 서버 장애 추적. 키 쿼터와 무관하다
    "gw_streak": 0, "gw_total": 0, "paused": False, "pauses": 0,

    # 장애 시 **모든 워커**를 세우는 게이트.
    # 한 스레드만 재우면 나머지가 계속 두드려 예산이 순식간에 증발한다 —
    # 47개 워커가 계속 던져 2분 만에 87,000 을 태운 적이 있다.
    "hold": threading.Event(),
}
lock = threading.Lock()

# 상한에 걸리면 서버가 JSON 에러가 아니라 **연결을 그냥 끊는다**(WinError 10054).
# 실측: 하루 약 3만 호출 지점에서 먼저 확보율이 떨어지고, 곧이어 리셋이 쏟아진다.
# 그래서 메시지뿐 아니라 '연속 실패 누적' 으로도 상한을 판정한다.
FAIL_STREAK_BLOCK = 40

# 더 고약한 경우가 있다. **쿼터를 넘기면 에러도 연결 끊김도 없이 빈 응답이 온다.**
# 수집기는 그것을 "이 ISBN 은 정보나루에 없다" 로 기록하고, 재개 로직은
# 그것도 '처리 완료' 로 보므로 다시 시도되지 않는 영구 결측이 된다.
#   실측 2026-08-28: 29,000건 지점부터 확보율 100% -> 0%. 19,472건이 오염됐다.
# 진짜 미수록은 흩어져 나오고 쿼터 차단은 연속으로 나온다. 그래서 구분한다.
MISS_STREAK_BLOCK = 50

# ── 서버 장애를 쿼터 소진과 구분한다 ──────────────────────────
# 실측 2026-08-31: API 가 504 Gateway Time-out 을 뱉는 동안 실패가 쌓여
# 5,980건밖에 안 쓴 키가 "소진" 처리됐다. 같은 시각 웹사이트는 HTTP 200 이었다.
# 게이트웨이 오류는 우리 쿼터와 무관하므로 키 카운터에 넣지 않는다.
GATEWAY_CODES = (502, 503, 504)
GATEWAY_STREAK_PAUSE = 30      # 연속 이만큼이면 전체 일시 정지
SERVER_WAIT = 300              # 정지 후 대기 (초)
SERVER_WAIT_MAX = 12           # 최대 반복 (= 1시간)
GATEWAY_TIMEOUT = 25           # 장애 중에는 짧게 끊는다

# ── 키는 순차로 예산만큼 쓴다 (라운드로빈이 아니다) ────────────
# 라운드로빈을 먼저 시도했다가 접었다. 실패 원인이 (a) 그 키의 쿼터 소진인지
# (b) 서버 장애인지 증상만으로 구분이 안 되는데, 오판하면 멀쩡한 키가 죽는다.
# 실측 2026-08-31 에 두 번 당했다 — 5,418 / 5,417건에서 두 키가 연달아 죽었다.
# 우리가 직접 세면 추론할 필요가 없다.
KEY_BUDGET = 29_000            # 3만에서 안전 여유를 뺀 값


# ── 단일 프로세스 강제 ────────────────────────────────────────
# 전에 중복 기동으로 출력 파일을 깨먹은 적이 있다. 같은 실수를 막는다.
def pid_alive(pid: int) -> bool:
    """PID 가 살아 있는지 확인한다.

    **`os.kill(pid, 0)` 을 쓰면 안 된다.** POSIX 에서는 신호를 보내지 않고
    존재만 확인하지만, 윈도우에서는 그런 개념이 없어 파이썬이
    `TerminateProcess` 를 호출한다 — 즉 **확인하려다 죽인다.**
    실측 2026-08-31: 락 확인 한 번에 돌고 있던 수집기가 종료됐다.

    윈도우에서는 tasklist 로 조회한다 (Git Bash 의 tasklist 는 신뢰할 수 없지만
    파이썬에서 직접 부르는 것은 정상 동작한다).
    """
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    import subprocess
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return False                       # 확인 불가 -> 죽은 것으로 본다
    return f'"{pid}"' in (out.stdout or "")


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


def load_keys() -> list:
    """`.env` 의 정보나루* 키를 전부 읽는다 (정보나루, 정보나루2, 정보나루3 …).

    쿼터가 **키 단위인지 IP 단위인지 확인되지 않았다.**
    공지의 "마이페이지 내 서버IP 기재 시 1일 30,000건" 은 계정에게 하는 안내라
    카운터의 집계 단위를 못 박지 않는다.

    그래서 로테이션을 낙관적으로 돌린다 — 한 키가 막히면 다음 키로 넘어가고,
    **모든 키가 막혀야 종료**한다. IP 단위였다면 두 번째 키가 즉시 막히므로
    그 자체가 답이 된다. 키별 호출 수를 남겨 나중에 확인할 수 있게 한다.
    """
    raw = ENV.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949", "replace")
    found = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("정보나루") and "=" in line:
            name, value = line.split("=", 1)
            value = value.strip().strip("\"'")
            if value:
                found.append((name.strip(), value))
    if not found:
        raise SystemExit("`.env` 에 정보나루 키가 없다")
    return found


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


def shape(isbn: str, body: dict, key_idx: int = -1) -> dict:
    book = body.get("book") or {}
    if not book:
        with lock:
            state["miss"] += 1
            n = state["miss_streak"].get(key_idx, 0) + 1
            state["miss_streak"][key_idx] = n
        if n >= MISS_STREAK_BLOCK:
            return {"isbn13": isbn, "ok": False, "__misstreak__": n}
        return {"isbn13": isbn, "ok": False}

    description = html.unescape((book.get("description") or "").strip())
    with lock:
        state["hit"] += 1
        state["miss_streak"][key_idx] = 0

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


def load_usage() -> dict:
    """키별 오늘 사용량. 날짜가 바뀌면 0 부터 시작한다.

    이게 없으면 재시작할 때마다 예산이 초기화돼 실제 상한을 넘긴다.
    """
    today = datetime.now(KST).strftime("%Y-%m-%d")
    if USAGE.exists():
        try:
            saved = json.loads(USAGE.read_text(encoding="utf-8"))
            if saved.get("date") == today:
                return {k: int(v) for k, v in saved.items() if k != "date"}
        except (json.JSONDecodeError, ValueError, OSError):
            pass
    return {}


def save_usage() -> None:
    try:
        with lock:
            data = {"date": datetime.now(KST).strftime("%Y-%m-%d"),
                    **{k: int(v) for k, v in state["per_key"].items()}}
        USAGE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def note_gateway() -> bool:
    """서버 장애를 센다. 연속으로 쌓이면 전체를 재우라고 알린다. 키는 안 죽인다."""
    with lock:
        state["gw_streak"] += 1
        state["gw_total"] += 1
        return state["gw_streak"] >= GATEWAY_STREAK_PAUSE and not state["paused"]


def server_alive() -> bool:
    """가볍게 찔러 본다. 쿼터 에러가 와도 서버 자체는 살아 있는 것이다."""
    _, key, _ = pick_key()
    if not key:
        return False
    url = API + "?" + urllib.parse.urlencode(
        {"isbn13": "9788936434120", "authKey": key, "format": "json"})
    try:
        with urllib.request.urlopen(urllib.request.Request(
                url, headers={"User-Agent": "b102-probe"}), timeout=40) as r:
            r.read(200)
        return True
    except HTTPError as error:
        return error.code not in GATEWAY_CODES
    except Exception:                                   # noqa: BLE001
        return False


def wait_for_server() -> bool:
    """서버가 살아날 때까지 대기. 살아나면 True, 끝내 안 되면 False."""
    with lock:
        if state["paused"]:
            return True
        state["paused"] = True
        state["pauses"] += 1
    state["hold"].set()          # 모든 워커 정지
    print(NL + f"  *** 서버 장애 — 게이트웨이 오류 누적 {state['gw_total']:,}",
          flush=True)
    try:
        for i in range(SERVER_WAIT_MAX):
            if state["stop"]:
                return False
            print(f"      {SERVER_WAIT // 60}분 대기 후 재확인 "
                  f"({i + 1}/{SERVER_WAIT_MAX}) — {datetime.now(KST):%H:%M}",
                  flush=True)
            slept = 0
            while slept < SERVER_WAIT and not state["stop"]:
                time.sleep(min(10, SERVER_WAIT - slept))
                slept += 10
            if state["stop"]:
                return False
            if server_alive():
                print(f"      서버 복구 — 재개 ({datetime.now(KST):%H:%M})",
                      flush=True)
                with lock:
                    state["gw_streak"] = 0
                return True
        print("      끝내 안 살아난다 — 종료", flush=True)
        with lock:
            state["blocked"] = True
            state["block_msg"] = "서버 장애 지속"
            state["stop"] = True
        return False
    finally:
        state["hold"].clear()    # 모든 워커 재개
        with lock:
            state["paused"] = False


def diagnose(key: str) -> str:
    """키를 죽이기 전에 원인을 가린다.

    연속 실패의 원인은 둘인데 증상이 같다.
      (a) 이 키의 쿼터가 끝났다   -> 키를 뺀다
      (b) 서버가 아파서 끊는다     -> 기다렸다 재개한다

    실측 2026-08-31: 서버가 흔들리는 동안 타임아웃이 쌓여 5,418건밖에 안 쓴
    키 두 개가 연달아 "소진" 처리됐다. 그래서 응답 내용으로 판별한다.
    """
    url = API + "?" + urllib.parse.urlencode(
        {"isbn13": "9788936434120", "authKey": key, "format": "json"})
    for _ in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    url, headers={"User-Agent": "b102-diag"}), timeout=50) as r:
                body = json.loads(r.read().decode("utf-8", "replace")).get("response", {})
        except HTTPError as error:
            if error.code in GATEWAY_CODES:
                return "outage"
            time.sleep(2)
            continue
        except Exception:                               # noqa: BLE001
            time.sleep(2)
            continue
        return "quota" if body.get("error") else "ok"
    return "outage"


def retire_key(idx: int, message: str) -> None:
    """지정한 키를 소진 처리한다. 남은 키가 없으면 전량 정지."""
    with lock:
        if idx < 0 or idx in state["dead"]:
            return
        state["dead"].add(idx)
        name = state["keys"][idx][0]
        used = state["per_key"].get(name, 0)
        left = [state["keys"][i][0] for i in range(len(state["keys"]))
                if i not in state["dead"]]
        print(f"\n  [{name}] 소진 — {used:,}호출  ({message[:44]})", flush=True)
        if not left:
            state["blocked"] = True
            state["block_msg"] = f"키 {len(state['keys'])}개 전부 소진 — {message}"
            state["stop"] = True
            print("  남은 키 없음 — 종료", flush=True)
            return
        state["streak"] = 0
        state["miss_streak"] = 0
        print(f"  남은 키: {', '.join(left)}", flush=True)


def note_failure(reason: str, key_idx: int = -1) -> None:
    """실패를 센다. 연속으로 쌓이면 **원인을 확인한 뒤** 처리한다."""
    with lock:
        state["error"] += 1
        if key_idx < 0:
            return
        n = state["streak"].get(key_idx, 0) + 1
        state["streak"][key_idx] = n
        hit = n >= FAIL_STREAK_BLOCK
        key_name, key = state["keys"][key_idx]
    if not hit:
        return

    verdict = diagnose(key)
    if verdict == "quota":
        retire_key(key_idx, f"연속 실패 {n}회 — 쿼터 확인됨")
    elif verdict == "outage":
        print(NL + f"  [{key_name}] 연속 실패 {n}회 — 서버 장애로 판정 "
              f"(키는 살려 둔다)", flush=True)
        if note_gateway():
            wait_for_server()
        with lock:
            state["streak"][key_idx] = 0
    else:
        print(NL + f"  [{key_name}] 연속 실패 {n}회였으나 확인 결과 정상 — 계속",
              flush=True)
        with lock:
            state["streak"][key_idx] = 0


def pick_key() -> tuple:
    """예산이 남은 키를 앞에서부터 하나 고른다 (순차 소진).

    한 키를 KEY_BUDGET 만큼 쓰고 다음으로 넘긴다.
    **우리가 직접 세므로 실패 원인을 추론할 필요가 없다.**

    정합성은 키가 아니라 프로세스 수에 달렸다. 단일 프로세스 안에서 도는 한
    쓰기 락도 완료 ISBN 집합도 하나뿐이라 안전하다.
    """
    with lock:
        for idx, (name, value) in enumerate(state["keys"]):
            if idx in state["dead"]:
                continue
            if state["per_key"].get(name, 0) >= KEY_BUDGET:
                continue
            return name, value, idx
    return None, None, -1


def fetch(_unused: str, isbn: str) -> dict:
    """성공 시 레코드, 차단·영구실패 시 None. 키는 호출마다 번갈아 쓴다."""
    key_name, key, key_idx = pick_key()
    if key is None:
        return None
    params = {"isbn13": isbn, "authKey": key, "format": "json"}
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "b102-enrich/1.0"})

    for attempt in range(3):
        if state["stop"]:
            return None
        # 장애 중이면 여기서 모두 멈춘다 (게이트가 열릴 때까지)
        if state["hold"].is_set():
            state["hold"].wait(timeout=SERVER_WAIT + 60)
            if state["stop"]:
                return None
        timeout = GATEWAY_TIMEOUT if state["gw_streak"] else 60
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except HTTPError as error:
            # 게이트웨이 오류는 **서버 문제**다. 키를 죽이면 안 된다.
            if error.code in GATEWAY_CODES:
                if note_gateway():
                    if not wait_for_server():
                        return None
                elif attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                return None
            if error.code in (429, 500) and attempt < 2:
                time.sleep(3 * (attempt + 1) ** 2)
                continue
            note_failure(f"HTTP {error.code}", key_idx)
            return None
        # OSError 를 반드시 포함해야 한다. ConnectionResetError 는 OSError 이지
        # URLError 가 아니라서, 상한에 걸린 순간 이 예외가 pool.map 밖으로
        # 튀어나가 실행 전체를 죽인 적이 있다 (2026-08-27, 28,124건 지점).
        except (URLError, TimeoutError, OSError, json.JSONDecodeError):
            if attempt < 2:
                time.sleep(3 * (attempt + 1) ** 2)   # 3s -> 12s. 폭주를 막는다
                continue
            note_failure("연결 끊김", key_idx)
            return None

        # **서버가 응답을 준 호출만** 예산으로 센다.
        # 연결 단계에서 실패한 요청은 서버에 닿지도 않아 쿼터를 안 쓴다.
        # 그것까지 세면 장애 때 쓰지도 않은 예산이 증발한다.
        with lock:
            state["per_key"][key_name] = state["per_key"].get(key_name, 0) + 1

        body = payload.get("response") or {}
        message = body.get("error") or ""
        if message and ("500건" in message or "IP" in message or "초과" in message):
            retire_key(key_idx, message)
            return None

        with lock:
            state["calls"] += 1
            state["streak"][key_idx] = 0
            state["gw_streak"] = 0          # 서버가 살아 있다는 증거
        record = shape(isbn, body, key_idx)
        if record and record.pop("__misstreak__", 0):
            retire_key(key_idx, "연속 미수록 — 쿼터 소진 (빈 응답 위장)")
            return None
        return record
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
            if n % FLUSH_EVERY == 0:
                save_usage()
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
        save_usage()
    return counter["n"]


def trim_trailing_misses() -> int:
    """쿼터 차단으로 끝났을 때, 파일 끝의 연속 미수록을 잘라낸다.

    차단은 연속 미수록 MISS_STREAK_BLOCK 건째에 판정되므로 그 직전까지의
    미수록은 이미 파일에 들어가 있다. 그것들은 진짜 미수록이 아니라
    쿼터 소진의 산물이므로 남겨 두면 **다시 시도되지 않는 영구 결측**이 된다.
    """
    if not OUT.exists():
        return 0
    lines = OUT.read_text(encoding="utf-8", errors="replace").splitlines()
    cut = len(lines)
    while cut > 0:
        line = lines[cut - 1].strip()
        if not line:
            cut -= 1
            continue
        try:
            if json.loads(line).get("ok"):
                break
        except json.JSONDecodeError:
            cut -= 1
            continue
        cut -= 1
    removed = len(lines) - cut
    if removed:
        with OUT.open("w", encoding="utf-8") as sink:
            for line in lines[:cut]:
                if line.strip():
                    sink.write(line + "\n")
    return removed


def summary() -> None:
    print("\n=== 이번 실행 결과 ===")
    print(f"  호출        {state['calls']:>9,}")
    print(f"  서지 확보   {state['hit']:>9,}")
    print(f"  미수록      {state['miss']:>9,}")
    print(f"  오류        {state['error']:>9,}")
    if state.get("gw_total"):
        print(f"  서버 장애   {state['gw_total']:>9,}  (일시 정지 {state['pauses']}회)")
    if state.get("keys"):
        print("  키별 호출:")
        for i, (name, _) in enumerate(state["keys"]):
            n = state["per_key"].get(name, 0)
            mark = " (소진)" if i in state["dead"] else ""
            print(f"    {name:<12}{n:>9,}{mark}")
    if OUT.exists():
        print(f"  누적 파일   {OUT.stat().st_size/1024/1024:>8.1f} MB")


def run(args) -> int:
    keys = load_keys()
    state["keys"] = keys
    state["per_key"] = load_usage()
    if state["per_key"]:
        print("오늘 이미 쓴 양 (이어서 셈): "
              + " · ".join(f"{k} {v:,}" for k, v in state["per_key"].items()))
    key = ""          # 실제 키는 pick_key() 가 호출마다 고른다
    lines = QUEUE.read_text(encoding="utf-8").splitlines()[1:]
    targets = [line.split(",")[0] for line in lines]
    done = load_done()
    pending = [i for i in targets if i not in done]
    if args.limit:
        pending = pending[:args.limit]

    print(f"큐 {len(targets):,}건 · 완료 {len(done):,}건 · 이번 대상 {len(pending):,}건")
    print(f"키 {len(keys)}개 순차 소진: {', '.join(n for n, _ in keys)}  "
          f"(키당 예산 {KEY_BUDGET:,})")
    print("  한 키를 예산만큼 쓰고 다음으로 넘긴다. 우리가 직접 세므로")
    print("  실패 원인을 추론할 필요가 없다. 사용량은 재시작해도 이어진다.")
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
        if state["blocked"]:
            trimmed = trim_trailing_misses()
            if trimmed:
                print(f"\n    끝부분 미수록 {trimmed:,}건 제거 — "
                      f"쿼터 소진의 산물이라 다음 실행에서 다시 시도된다")
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
