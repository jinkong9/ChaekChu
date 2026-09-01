# EC2 수집기 배포

정보나루 수집기를 EC2 에서 무인으로 돌리는 데 쓰는 파일들이다.
**EC2 안에만 두면 인스턴스가 사라질 때 같이 없어지므로** 여기에 원본을 둔다.

| 파일 | EC2 위치 | 역할 |
| --- | --- | --- |
| `d4l-collector.service` | `/etc/systemd/system/` | 수집기 서비스. 크래시·재부팅 자동 복구 |
| `backup.sh` | `~/backup.sh` | 수집 결과 스냅샷 (하루 2회, 5세대) |
| `status.sh` | `~/status.sh` | 감시용 한 줄 상태 |
| `logrotate-d4l-collector` | `/etc/logrotate.d/d4l-collector` | 로그 회전 |
| `heartbeat.sh` | `~/heartbeat.sh` | 30분마다 상태 한 줄 (무인 구간 추적용) |
| `crontab.txt` | `crontab -l` | 백업·하트비트 스케줄 |

<br/>

## 서버

```
호스트   j15b102.p.ssafy.io   (공인 3.35.173.198 · ap-northeast-2)
OS       Ubuntu 24.04 LTS · Python 3.12.3 (표준 라이브러리만 쓰므로 pip 불필요)
자원     4 vCPU · 16 GiB · 309 GB
```

<br/>

## 디렉터리

```
~/pipeline/scripts/enrich_from_data4library.py    코드
~/pipeline_data/.env                              정보나루 키 5개만 (chmod 600)
~/pipeline_data/data4library/
    enrich_queue.csv       우선순위 큐 (입력)
    d4l_usage.jsonl        수집 결과 (출력 겸 재개 지점)
    d4l_key_usage.json     키별 오늘 사용량
~/backups/                                        스냅샷 5세대
~/collect.log                                     수집 로그
```

`.env` 는 **정보나루 키만** 담는다. 팀 공용 서버라 카카오·구글북스·국중도 키까지
올릴 이유가 없다. 수집기는 `정보나루` 로 시작하는 줄만 읽는다.

<br/>

## 설치

```bash
mkdir -p ~/pipeline_data/data4library ~/pipeline/scripts ~/backups
chmod 700 ~/pipeline_data
# 코드·데이터·.env 를 scp 로 올린 뒤
chmod 600 ~/pipeline_data/.env
sudo cp d4l-collector.service /etc/systemd/system/
sudo cp logrotate-d4l-collector /etc/logrotate.d/d4l-collector
cp backup.sh status.sh ~/ && chmod +x ~/backup.sh ~/status.sh
crontab crontab.txt
sudo systemctl daemon-reload && sudo systemctl enable --now d4l-collector
```

<br/>

## 운영

```bash
systemctl status d4l-collector     # 상태·PID·메모리·재시작 횟수
~/status.sh                        # 수집 줄수·키 사용량 요약
tail -f ~/collect.log              # 실시간 로그
sudo systemctl stop d4l-collector  # 정지
```

`kill` 로 죽이지 말 것. `Restart=always` 라 60초 뒤 되살아난다.
`stop` 은 `SIGINT` 를 보내 진행분을 `fsync` 할 시간(최대 120초)을 준다.

<br/>

## 유닛에 박아 둔 이유

| 설정 | 왜 |
| --- | --- |
| `--wait` | 일일 상한에 걸리면 KST 자정까지 기다렸다 스스로 재개한다. 없으면 하루를 논다 |
| `--key-order 1,2,3,4,5` | 키 소진 순서. 처음엔 등록 시점이 달라 1,3,4,5,2 를 썼으나 5개 전부 등록된 뒤 자연 순서로 되돌렸다 |
| `--workers 24` | 서버가 7.5건/초에서 포화한다. 더 늘리면 지연만 는다 |
| `Restart=always` / `RestartSec=60` | 크래시 복구. 60초는 장애 중 재기동 폭주를 막는 간격 |
| `MemoryMax=3G` | **팀 공용 서버다.** PostgreSQL·Qdrant 가 올라와도 독점 못 하게 |
| `Nice=10` · `IOSchedulingClass=idle` | 같은 이유. 다른 서비스에 양보한다 |
| `KillSignal=SIGINT` · `TimeoutStopSec=120` | 종료 신호를 받고 진행분을 저장할 시간 |
| `copytruncate` (logrotate) | 수집기가 로그 핸들을 계속 잡고 있어 재시작 없이 회전하려면 필요 |

<br/>

## 백업이 막는 것과 못 막는 것

**막는다** — 코드가 잘못 자르는 것(`trim_trailing_misses` 가 `truncate()` 를 쓴다),
사람이 지우는 것, 배포 사고.
`backup.sh` 는 **줄 수가 줄면 백업하지 않는다.** 훼손된 파일로 멀쩡한 백업을
밀어내면 백업이 있으나 마나다.

**못 막는다** — 인스턴스 자체가 사라지는 경우. 같은 디스크에 있기 때문이다.
오프사이트가 필요하면 S3 를 붙여야 하고, 그 전까지는 PC 가 켜져 있을 때
수동으로 한 벌 받아 두는 것이 유일한 대비다.

```bash
scp -i J15B102T.pem ubuntu@j15b102.p.ssafy.io:~/pipeline_data/data4library/d4l_usage.jsonl <로컬경로>
```

PC 로 **자동** 회수는 못 한다. 야간에 PC 가 꺼져 있으면 끌어올 수도 받을 수도 없다.

<br/>

## 키 IP 등록

정보나루 키는 **등록된 공인 IP 에서만** 동작한다. 미등록 IP 는 에러가 아니라
**정상 형식의 빈 응답**을 준다 — "책 없음" 과 구분되지 않는다.

현재 등록: `14.50.47.78`(개발 PC) · `3.35.173.198`(EC2)

옮기거나 IP 가 바뀌면 마이페이지에서 다시 등록해야 한다. 수집기는 기동 시
키마다 1회 확인(`probe_key`)해서 못 쓰는 키를 미리 걸러낸다.

<br/>

## 자리를 비울 때 — 대신 볼 사람을 위한 안내

수집기는 systemd 로 돌고 사람이 없어도 스스로 복구한다. 아래만 알면 된다.

### 한 번에 보기

```bash
~/status.sh                    # 지금 상태
tail -40 ~/heartbeat.log       # 30분 단위 기록 — 자리를 비운 동안 무슨 일이 있었나
```

`heartbeat.log` 한 줄이 이렇게 생겼다.

```
09-01 12:51 lines=79865 active=active rss=146 retired=0 restarts=0 usage={...} disk=1
```

| 항목 | 정상 | 이상하면 |
| --- | --- | --- |
| `lines` | 계속 증가 | 30분 넘게 그대로면 서버 장애 (대개 저절로 복구된다) |
| `active` | `active` | `failed`/`inactive` 면 서비스가 죽었다 |
| `rss` | 100~200 | 800 이상이면 메모리 이상 |
| `retired` | 키가 소진될 때마다 +1 | 하루에 5 면 전 키 소진 — 정상 |
| `restarts` | 0 | 계속 늘면 크래시 루프 |
| `disk` | 1~5 | 80 이상이면 조치 필요 |

### 멈춰 보여도 대개 정상이다

정보나루 API 는 하루에 몇 번씩 **504 Gateway Time-out** 을 낸다 (실측 08-31~09-01).
그때 수집기는 **일부러 멈춘다** — 전 워커를 세우고 5분마다 서버만 확인하다
복구되면 스스로 재개한다. 죽은 서버에 계속 요청을 던지면 얻는 것 없이
쿼터만 빠지기 때문이다 (504 로 끝난 호출도 정보나루 쪽에서는 차감된다).

그러니 `lines` 가 멈췄다고 재시작하지 말 것. 로그에서 이렇게 확인된다.

```bash
grep -v "^$" ~/collect.log | tail -20
```

`서버 장애로 판정 (키는 살려 둔다)` / `5분 대기 후 재확인 (n/12)` 이 보이면 정상 대기다.
1시간(12회) 을 넘겨도 안 살아나면 종료되고, systemd 가 다시 띄운다.

### 손대야 하는 경우

| 증상 | 조치 |
| --- | --- |
| `active=failed` 가 30분 이상 | `sudo systemctl restart d4l-collector` 후 `tail -50 ~/collect.log` |
| `restarts` 가 계속 증가 | 크래시 루프. `journalctl -u d4l-collector -n 100` 로 원인 확인 |
| `disk` 80 이상 | `~/backups/` 오래된 것부터 정리 |
| 그 외 | **건드리지 말 것.** 대기 중일 가능성이 높다 |

`kill` 로 죽이지 말 것. `Restart=always` 라 되살아난다. 반드시 `systemctl stop`.

### 아직 한 번도 안 돌아본 경로

이 셋은 코드는 있으나 실제로 실행된 적이 없다. 처음 겪는 것이면 로그를 남겨 두면 좋다.

1. **키 전환** — 한 키가 소진되면 다음 키로 넘어간다 (순서 1→3→4→5→2).
   `retired` 가 0 에서 1 로 바뀌는 순간이다.
2. **자정 쿼터 리셋** — 전 키가 소진되면 KST 자정까지 기다렸다 스스로 재개한다 (`--wait`).
3. **1시간 초과 장애** — 대기 12회를 다 쓰면 종료하고 systemd 가 다시 띄운다.
