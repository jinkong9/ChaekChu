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

# 데이터 뿌리. 다른 머신(EC2 등)에서는 PIPELINE_DATA 로 덮어쓴다.
#   윈도우: 기본값 그대로
#   리눅스: PIPELINE_DATA=/home/ubuntu/pipeline_data python3 scripts/...
BASE = Path(os.environ.get("PIPELINE_DATA")
            or r"C:\Users\SSAFY\ygg\특화프로젝트\project_personal").expanduser()
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

    # **사용자 중단과 상한 정지를 구분해야 한다.** 둘 다 stop 을 세우는데,
    # 자정 대기 루프가 stop 으로 빠져나가면 상한 정지에서도 즉시 깨어나
    # 무한 루프가 된다 (실측 2026-09-02~03: 로그 175만 줄, 이틀 손실).
    "interrupted": False,

    # 카운터가 어느 날짜의 것인지. 날짜가 바뀌면 되살린다.
    "usage_date": None,
    "keys": [], "per_key": {}, "dead": set(), "rr": 0,

    # 연속 실패는 **키별로** 센다. 전역으로 세면 한 키가 쏟아낸 실패가
    # 다른 키를 죽인다 — IP 미등록 키의 실패가 40에 닿는 순간 사용 중이던
    # 정상 키가 소진 처리돼 1,080건에서 멈춘 적이 있다 (2026-08-31).
    "streak": {}, "miss_streak": {},

    # 서버 장애 추적. 키 쿼터와 무관하다
    "gw_streak": 0, "gw_total": 0, "paused": False, "pauses": 0,
    "last_diagnose": 0.0, "diagnoses": 0, "diag_skipped": 0,

    # 장애 시 **모든 워커**를 세우는 게이트.
    # 한 스레드만 재우면 나머지가 계속 두드려 예산이 순식간에 증발한다 —
    # 47개 워커가 계속 던져 2분 만에 87,000 을 태운 적이 있다.
    # **평상시 set(통과), 장애 때 clear(대기).**
    # 반대로 두면 안 된다. Event.wait() 는 set 이면 즉시 반환하므로
    # "정지" 를 set 으로 표현하면 게이트가 아무것도 막지 못한다.
    "go": threading.Event(),
    "pending_miss": [],               # 아직 확정 안 된 미수록 행
    "probed": set(),                  # 투입 전 검증을 마친 키
    "dropped_miss": 0,                # 은퇴와 함께 버린 미수록 수
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

# 키를 투입하기 전에 이 ISBN 으로 1회 찔러 본다.
# 조건: 확실히 존재하고, 우리가 이미 수집해 둔 책이어야 한다
# (검증 때문에 새 데이터를 얻거나 잃지 않도록).
PROBE_ISBN = "9788954699914"          # 하얼빈 · 김훈

# 한 번에 풀에 넣는 항목 수.
# ThreadPoolExecutor.map 은 넘긴 항목 **전부**의 Future 를 즉시 만든다.
# 100만 건을 통째로 넘기면 그것만으로 2GB 다 (실측 VmRSS 2,107,104 kB).
# 나눠 넣으면 대기열 비용이 이 크기에 비례해 묶인다.
SUBMIT_CHUNK = 20_000

# ── 서버 장애를 쿼터 소진과 구분한다 ──────────────────────────
# 실측 2026-08-31: API 가 504 Gateway Time-out 을 뱉는 동안 실패가 쌓여
# 5,980건밖에 안 쓴 키가 "소진" 처리됐다. 같은 시각 웹사이트는 HTTP 200 이었다.
# 게이트웨이 오류는 우리 쿼터와 무관하므로 키 카운터에 넣지 않는다.
GATEWAY_CODES = (502, 503, 504)
GATEWAY_STREAK_PAUSE = 30      # 연속 이만큼이면 전체 일시 정지
SERVER_WAIT = 300              # 정지 후 대기 (초)
SERVER_WAIT_MAX = 12           # 최대 반복 (= 1시간)
GATEWAY_TIMEOUT = 25           # 장애 중에는 짧게 끊는다

# 진단(diagnose) 호출 사이 최소 간격.
# 진단도 실제 API 호출이라 쿼터에서 빠진다. 이미 아픈 서버를 반복해서
# 찌를 이유가 없다. 실측: 장애 두 번에 94회가 불렸다.
DIAGNOSE_MIN_GAP = 120

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


state["go"].set()                     # 평상시는 통과


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


def order_keys(found: list, spec: str) -> list:
    """`--key-order 1,3,4,5,2` 를 실제 키 순서로 옮긴다.

    숫자는 `.env` 의 접미사다 (`정보나루`=1, `정보나루2`=2 ...).
    지정하지 않은 키는 뒤에 파일 순서대로 붙는다. 없는 번호는 무시한다.
    """
    if not spec:
        return found
    by_num = {}
    for name, value in found:
        tail = name[len("정보나루"):].strip()
        by_num[tail if tail else "1"] = (name, value)
    out, used = [], set()
    for token in spec.split(","):
        token = token.strip()
        if token in by_num and token not in used:
            out.append(by_num[token])
            used.add(token)
    for key, pair in by_num.items():
        if key not in used:
            out.append(pair)
    return out


def load_done() -> set:
    """이미 처리한 ISBN. 깨진 줄은 건너뛴다(다음 회차에 다시 시도된다)."""
    if not OUT.exists():
        return set()
    # **레코드 전체를 파싱하면 안 된다.** 한 줄에 소개문·키워드 50개·
    # 함께대출·월별 이력이 들어 있어 평균 3.4KB 다. isbn13 하나 꺼내자고
    # json.loads 를 66만 번 돌리면 임시 객체로 CPU 와 메모리를 다 쓴다.
    # isbn13 은 항상 맨 앞 필드라 문자열로 바로 집는다.
    done = set()
    head = '{"isbn13":"'

    with OUT.open(encoding="utf-8") as source:
        for line in source:
            if line.startswith(head):
                end = line.find('"', len(head))
                if end > 0:
                    done.add(line[len(head):end])
                    continue
            line = line.strip()
            if not line:
                continue
            try:                                  # 형식이 다르면 정공법
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
    state["usage_date"] = today
    if USAGE.exists():
        try:
            saved = json.loads(USAGE.read_text(encoding="utf-8"))
            if saved.get("date") == today:
                return {k: int(v) for k, v in saved.items() if k != "date"}
        except (json.JSONDecodeError, ValueError, OSError):
            pass
    return {}


def save_usage() -> None:
    # 200건마다 불린다. 자정을 넘겨 계속 도는 경우가 여기서 잡힌다.
    roll_day_if_needed()
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
    state["go"].clear()          # 모든 워커 정지 (통과 신호를 내린다)
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
        state["go"].set()        # 모든 워커 재개
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
        # 이 키로 받은 미확정 미수록은 "책 없음" 이 아니라 키 문제다.
        # 버려야 큐에 남아 다음 실행에서 다시 시도된다.
        state["dropped_miss"] += len(state["pending_miss"])
        state["pending_miss"] = []
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
        # **dict 를 통째로 덮으면 안 된다.** 예전에 전역 카운터였던 흔적이라
        # `state["streak"] = 0` 으로 남아 있었는데, 키별 dict 로 바꾼 뒤에도
        # 이 두 줄이 그대로여서 첫 은퇴 순간 두 추적기가 정수가 됐다.
        # 그 뒤 모든 shape() 가 `0.get(...)` -> AttributeError 로 죽고,
        # 워커의 포괄 예외 처리에 먹혀 **조용히** 레코드가 버려졌다.
        # 실측: 다음 키가 1,947회 호출에 0건 기록, 은퇴도 안 됨.
        state["streak"].pop(idx, None)
        state["miss_streak"].pop(idx, None)
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

    # **진단도 실제 API 호출이다.** 이미 아픈 서버를 반복해서 찌르면
    # 얻는 것 없이 쿼터만 빠진다. `paused` 검사만으로는 부족했다 —
    # 정지 전 구간과 정지 해제 직후에 워커들이 다시 40회를 쌓아 매번 불렀다.
    # 그래서 최소 간격을 둔다. 건너뛸 때도 게이트웨이 카운터는 먹여서
    # **추가 호출 없이** 정지가 걸리도록 한다.
    now = time.time()
    with lock:
        too_soon = (now - state["last_diagnose"]) < DIAGNOSE_MIN_GAP
        if not too_soon:
            state["last_diagnose"] = now
            state["diagnoses"] += 1
        else:
            state["diag_skipped"] += 1
    if state["paused"] or too_soon:
        if note_gateway():
            wait_for_server()
        with lock:
            state["streak"][key_idx] = 0
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


def probe_key(key: str) -> str:
    """키 하나를 찔러 본다. 반환: "ok" | "empty" | "quota" | "outage"

    **`diagnose()` 로는 부족하다.** 그쪽은 응답에 `error` 가 없으면 "ok" 라고
    답하는데, IP 미등록 키는 *error 없는 빈 응답*을 준다 (실측 98바이트).
    그래서 죽은 키가 "사용 가능" 으로 통과한다.

    여기서는 **확실히 존재하는 책을 실제로 가져오는지**로 판정한다.
    못 가져오면 그 키로는 수집이 안 된다 — 원인이 IP든 쿼터든 결과는 같다.
    """
    url = API + "?" + urllib.parse.urlencode(
        {"isbn13": PROBE_ISBN, "authKey": key, "format": "json"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    url, headers={"User-Agent": "b102-probe"}), timeout=70) as r:
                payload = json.loads(r.read().decode("utf-8", "replace"))
        except HTTPError as error:
            if error.code in GATEWAY_CODES:
                return "outage"
            time.sleep(2)
            continue
        except Exception:                               # noqa: BLE001
            time.sleep(2)
            continue
        body = payload.get("response") or {}
        if body.get("error"):
            return "quota"
        return "ok" if (body.get("book") or {}).get("isbn13") else "empty"
    return "outage"


def verify_keys() -> None:
    """쓰기 시작하기 전에 키를 하나씩 1회 찔러 본다.

    IP 미등록 키는 **정상 형식의 빈 응답**을 준다. 그것을 실제 수집으로
    알아내려면 MISS_STREAK_BLOCK(50) 건을 헛돌아야 하고, 그 사이 49건이
    `ok:false` 로 파일에 들어간다. 뒤에 성공이 이어지면 그 49건은
    **다시 시도되지 않는 영구 결측**이 된다.

    그래서 키당 1회로 미리 판정한다. 못 쓰는 키는 아예 투입하지 않는다.
    검증에 쓰는 ISBN 은 이미 수집해 둔 책이라 결과가 데이터에 안 남는다.
    """
    print("키 투입 전 확인 (키당 1회 호출)", flush=True)
    verdicts = []
    for idx, (name, value) in enumerate(state["keys"]):
        verdict = probe_key(value)
        verdicts.append(verdict)
        state["probed"].add(idx)
        label = {"ok": "사용 가능",
                 "empty": "빈 응답 — IP 미등록이거나 쿼터 소진",
                 "quota": "쿼터 소진",
                 "outage": "서버 장애 (판정 보류)"}[verdict]
        print(f"  {name:<10} {label}", flush=True)

    # 전부 장애면 서버 문제다. 키를 죽이지 않는다 — 기다렸다 다시 본다.
    if all(v == "outage" for v in verdicts):
        print("  -> 전 키가 장애 응답. 서버 문제로 보고 키를 살려 둔다.",
              flush=True)
        return

    for idx, verdict in enumerate(verdicts):
        if verdict in ("empty", "quota"):
            retire_key(idx, f"투입 전 확인 — {verdict}")

    live = [n for i, (n, _) in enumerate(state["keys"]) if i not in state["dead"]]
    if not live:
        state["blocked"] = True
        state["stop"] = True
        state["block_msg"] = "투입 전 확인에서 쓸 수 있는 키가 없었다"
    print(f"  -> 투입 {len(live)}개: {', '.join(live) or '없음'}", flush=True)


def roll_day_if_needed() -> bool:
    """KST 날짜가 바뀌었으면 카운터를 되살린다.

    **날짜가 주 기준이고 호출 수는 보조 안전장치다.**
    쿼터는 KST 자정에 서버에서 리셋된다. 우리 카운터는 그것을 흉내내는
    보조 수단일 뿐이다. 그런데 날짜 확인이 기동 시점에만 있으면,
    프로세스가 자정을 넘겨 계속 도는 동안 per_key 가 어제 값 위에 쌓여
    **서버는 리셋됐는데 우리만 상한이라고 판단해 멈춘다.**

    실측 2026-09-02~03: 09-01 에 5개 키를 다 쓴 뒤 이틀을 통째로 날렸다.

    어제 은퇴한 키도 오늘은 살아나므로 dead 와 스트릭도 함께 비운다.
    """
    today = datetime.now(KST).strftime("%Y-%m-%d")
    with lock:
        prev = state.get("usage_date")
        if prev == today:
            return False
        state["usage_date"] = today
        if prev is None:                 # 기동 직후 — 되살릴 것이 없다
            return False
        state["per_key"] = {}
        state["dead"] = set()
        state["streak"] = {}
        state["miss_streak"] = {}
        state["gw_streak"] = 0
        state["blocked"] = False
        state["block_msg"] = ""
        state["stop"] = False
    state["go"].set()
    print(NL + f"=== 날짜 변경 {prev} -> {today} · 카운터 초기화 ===", flush=True)
    return True


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

        # **상한을 선언하기 전에 날짜부터 본다.** 자정을 넘겼으면 서버 쿼터가
        # 이미 리셋됐으므로 우리 카운터만 붙들고 멈출 이유가 없다.
        # (lock 을 잡은 채라 여기서 직접 부르지 않고 아래에서 처리한다)
        stale = state.get("usage_date") != datetime.now(KST).strftime("%Y-%m-%d")

        # 쓸 수 있는 키가 하나도 없다. **여기서 상한 도달을 선언해야 한다.**
        #
        # 키는 두 가지 경로로 빠진다 — 은퇴(빈 응답으로 판정, dead 에 들어감)와
        # 예산 소진(우리 카운터가 KEY_BUDGET 도달, dead 에 안 들어감).
        # retire_key 는 **전부 dead 일 때만** blocked 를 세우므로, 섞여 있으면
        # (예: 3개는 은퇴, 2개는 예산 소진) 아무도 blocked 를 세우지 않는다.
        #
        # 그러면 fetch 가 계속 None 을 돌려주고 drain 이 0건으로 끝나
        # run 루프가 `if not written: break` 로 그냥 종료한다.
        # **--wait 의 자정 재개가 작동하지 않는다.** systemd 가 재시작하면
        # 투입 전 키 확인 5호출만 태우고 또 즉시 종료하기를 반복한다.
        if not stale and not state["blocked"]:
            live = [state["keys"][i][0] for i in range(len(state["keys"]))
                    if i not in state["dead"]]
            state["blocked"] = True
            state["stop"] = True
            state["block_msg"] = (
                f"쓸 수 있는 키 없음 — 은퇴 {len(state['dead'])}개"
                + (f" · 예산 소진 {len(live)}개" if live else ""))

    if stale:                            # 날짜가 바뀌었다 — 되살리고 다시 고른다
        roll_day_if_needed()
        return pick_key()
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
        if not state["go"].is_set():
            # 통과 신호가 올 때까지 **실제로 막는다.**
            # 타임아웃은 교착 방지용 상한일 뿐이라 루프로 다시 기다린다.
            waited = 0
            limit = SERVER_WAIT * SERVER_WAIT_MAX + 120
            while not state["go"].wait(timeout=30):
                waited += 30
                if state["stop"] or waited >= limit:
                    return None
        if state["stop"]:
            return None
        # 서버가 63초에 504 를 준다. 60초로 끊으면 응답을 못 보고
        # 타임아웃으로 처리돼 원인 판별이 흐려진다. 넉넉히 둔다.
        timeout = GATEWAY_TIMEOUT if state["gw_streak"] else 75
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
            # **타임아웃도 게이트웨이 장애 신호로 센다.**
            # 실측 2026-09-01: 서버가 63초에 504 를 주는데 우리 타임아웃이
            # 60초라 대부분 504 를 받기 전에 TimeoutError 로 끝난다. 그러면
            # 게이트웨이 카운터가 안 올라 전역 정지가 걸리지 않고, 워커 24개가
            # 죽은 서버에 연결을 계속 유지한다 (실측 동시 연결 19~23개).
            # 504 로 끝난 호출도 정보나루 쪽 쿼터에서는 빠져나가므로
            # 그대로 두면 얻는 것 없이 하루치가 샌다.
            if note_gateway():
                if not wait_for_server():
                    return None
            elif attempt < 2:
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
        with write_lock:
            if not record.get("ok"):
                # **미수록을 바로 쓰지 않는다.**
                # 빈 응답은 "책 없음" 과 "키가 죽었음" 이 구분되지 않는다.
                # 바로 쓰면 재개 로직이 완료로 보아 다시 시도하지 않고,
                # 키 문제였을 경우 그대로 영구 결측이 된다.
                # 같은 키에서 성공이 나오면(=키가 멀쩡하다는 증거) 그때
                # 확정하고, 키가 은퇴하면 retire_key 가 통째로 버린다.
                state["pending_miss"].append(record)
                return
            rows = state["pending_miss"] + [record]
            state["pending_miss"] = []
            for row in rows:
                sink.write(json.dumps(row, ensure_ascii=False,
                                      separators=(",", ":")) + "\n")
            counter["n"] += len(rows)
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
            # **한꺼번에 넘기지 않는다.** 아래를 보라 (SUBMIT_CHUNK).
            for start in range(0, total, SUBMIT_CHUNK):
                if state["stop"]:
                    break
                list(pool.map(worker, pending[start:start + SUBMIT_CHUNK]))
    finally:
        # 남은 버퍼: 정상 종료면 진짜 미수록이므로 확정한다.
        # 차단·중단으로 끝났으면 키 문제일 수 있어 버린다 (큐에 남는다).
        with write_lock:
            rows = state["pending_miss"]
            state["pending_miss"] = []
        if rows and not state["stop"] and not state["blocked"]:
            for row in rows:
                sink.write(json.dumps(row, ensure_ascii=False,
                                      separators=(",", ":")) + "\n")
            counter["n"] += len(rows)
        elif rows:
            state["dropped_miss"] += len(rows)
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

    **파일을 통째로 읽으면 안 된다.** 예전 구현은
    `OUT.read_text().splitlines()` 였는데, L1 전량이면 출력이 3.7GB 라
    디코딩된 문자열과 줄 리스트로 **피크 5GB** 를 먹는다. 메모리 16GB 인
    서버에서 PostgreSQL·Qdrant 와 같이 뜨면 그대로 OOM 이다.

    잘라낼 구간은 항상 파일 **끝의 수십 줄**이다. 그래서 뒤에서 1MB 만
    읽어 자를 바이트 위치를 구하고 `truncate()` 한다. 창 안이 전부
    미수록이면 창을 4배씩 넓힌다. 전체를 다시 쓰지 않으므로 파일이
    아무리 커도 순식간에 끝난다.
    """
    if not OUT.exists():
        return 0
    size = OUT.stat().st_size
    if not size:
        return 0

    window = 1 << 20                       # 1MB. 레코드가 3.4KB 이니 약 300줄
    while True:
        start = max(0, size - window)
        with OUT.open("rb") as fh:
            fh.seek(start)
            blob = fh.read()

        if start > 0:                      # 앞이 잘렸으면 첫 줄은 버린다
            nl = blob.find(b"\n")
            if nl < 0:                     # 창 안에 개행이 없다 -> 넓힌다
                if window >= size:
                    return 0
                window = min(window * 4, size)
                continue
            start += nl + 1
            blob = blob[nl + 1:]

        lines = blob.split(b"\n")
        offsets, pos = [], start
        for line in lines:
            offsets.append(pos)
            pos += len(line) + 1

        cut, removed, found_ok = size, 0, False
        for i in range(len(lines) - 1, -1, -1):
            line = lines[i].strip()
            if not line:
                cut = offsets[i]
                continue
            try:
                if json.loads(line.decode("utf-8", "replace")).get("ok"):
                    found_ok = True
                    break
            except (json.JSONDecodeError, ValueError):
                pass                       # 깨진 줄도 잘라낸다
            cut = offsets[i]
            removed += 1

        if found_ok or start == 0:         # 판정 끝 (또는 파일 전체를 봤다)
            if removed and cut < size:
                with OUT.open("rb+") as fh:
                    fh.truncate(cut)
            return removed

        window = min(window * 4, size)     # 창이 전부 미수록 -> 더 넓게


def summary() -> None:
    print("\n=== 이번 실행 결과 ===")
    print(f"  호출        {state['calls']:>9,}")
    print(f"  서지 확보   {state['hit']:>9,}")
    print(f"  미수록      {state['miss']:>9,}")
    print(f"  오류        {state['error']:>9,}")
    if state.get("dropped_miss"):
        print(f"  버린 미수록 {state['dropped_miss']:>9,}  "
              f"(키 문제로 판단 — 큐에 남아 다음에 다시 시도한다)")
    if state.get("diagnoses") or state.get("diag_skipped"):
        print(f"  진단 호출   {state['diagnoses']:>9,}  "
              f"(간격 제한으로 생략 {state['diag_skipped']:,}회)")
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
    keys = order_keys(load_keys(), getattr(args, "key_order", ""))
    state["keys"] = keys
    state["per_key"] = load_usage()
    if state["per_key"]:
        print("오늘 이미 쓴 양 (이어서 셈): "
              + " · ".join(f"{k} {v:,}" for k, v in state["per_key"].items()))
    key = ""          # 실제 키는 pick_key() 가 호출마다 고른다
    # 큐는 108만 행이다. 중간 리스트를 남겨 두면 그것만으로 수백 MB 다.
    lines = QUEUE.read_text(encoding="utf-8").splitlines()
    targets = [line.split(",", 1)[0] for line in lines[1:]]
    del lines
    done = load_done()
    pending = [i for i in targets if i not in done]
    queue_total = len(targets)       # 리스트를 놓기 전에 숫자만 챙긴다
    del targets
    if args.limit:
        pending = pending[:args.limit]

    print(f"큐 {queue_total:,}건 · 완료 {len(done):,}건 · 이번 대상 {len(pending):,}건")
    if not getattr(args, "no_verify", False):
        verify_keys()
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
        state["interrupted"] = True
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
            # **stop 이 아니라 interrupted 를 본다.** 상한 정지도 stop 을
            # 세우므로 stop 으로 빠져나가면 한 번도 자지 않는다.
            while slept < wait and not state["interrupted"]:
                time.sleep(min(60, wait - slept))
                slept += 60
            if state["interrupted"]:
                break

            # **날짜가 바뀌었으니 카운터를 되살려야 한다.**
            # load_usage() 는 기동 시 한 번만 부른다. 여기서 다시 읽지 않으면
            # per_key 와 dead 가 어제 값 그대로라 pick_key 가 곧바로 None 을
            # 돌려주고 다시 상한 -> 다시 대기로 무한 루프가 된다.
            with lock:
                state["blocked"] = False
                state["stop"] = False
                state["block_msg"] = ""
                state["dead"] = set()        # 어제 은퇴한 키도 오늘은 살아난다
                state["streak"] = {}
                state["miss_streak"] = {}
                state["gw_streak"] = 0
                state["paused"] = False
                state["pending_miss"] = []
            state["go"].set()
            state["per_key"] = load_usage()  # 날짜가 다르면 {} 를 돌려준다
            print(f"\n=== 재개 {datetime.now(KST):%Y-%m-%d %H:%M} KST ===", flush=True)
            if state["per_key"]:
                print("    오늘 이미 쓴 양: "
                      + " · ".join(f"{k} {v:,}"
                                   for k, v in state["per_key"].items()),
                      flush=True)
            if not getattr(args, "no_verify", False):
                verify_keys()            # 오늘 쓸 수 있는 키를 다시 확인
            if state["blocked"]:         # 확인에서 전부 막히면 더 못 간다
                print("    재개했으나 쓸 수 있는 키가 없다 — 종료", flush=True)
                break
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
    parser.add_argument("--key-order", default="",
                        help="키 사용 순서. 예: 1,3,4,5,2 "
                             "(.env 접미사 기준, 정보나루=1). 지정 안 하면 파일 순서)")
    parser.add_argument("--no-verify", action="store_true",
                        help="투입 전 키 확인을 건너뛴다 (권장하지 않음)")
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
