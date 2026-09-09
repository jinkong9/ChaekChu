# 배포 — EC2 한 대에 docker compose

서버 `j15b102.p.ssafy.io` (Ubuntu 24.04 · 4 vCPU · 16GiB · 309GB). 같은 서버에 정보나루·카카오 수집기가 systemd 로 돌고 있다(`database/_pipeline/deploy/`). 서로 건드리지 않는다.

## 구성

```
deploy/
  docker-compose.yml        운영 compose (web · backend · postgres · elasticsearch · qdrant[profile])
  .env.example              환경변수 견본. 서버에서 deploy/.env 로 복사해 채운다 (커밋 금지)
  web/                      프론트 정적 파일 + nginx 리버스 프록시 이미지
    Dockerfile              node:24 로 빌드 → nginx:1.30 에 담음. 컨텍스트는 저장소 루트
    nginx/templates/        http.conf.template(인증서 전) · tls.conf.template(인증서 후). TLS_ENABLED 로 선택
    nginx/snippets/app.conf 라우팅 한 곳: /api/ · /swagger-ui/ · /v3/api-docs → backend, 나머지 SPA
  docker-compose.local.yml  로컬 전체 스택 override (포트·메모리·TLS 끔). .env.local.example 과 짝
  scripts/
    common.sh               공통: env·락·상태 경로 (/etc/b102, /var/lib/b102 우선), envval, 락
    local-up.sh             로컬 전체 스택 기동/중지 (팀원용)
    setup-ec2.sh            최초 1회: Docker · 데몬 로그 상한 · 스왑 2G · ufw 80/443 · vm.max_map_count
    setup-cd.sh             최초 1회: 그룹 b102, /etc/b102/{deploy.env,deploy.lock,git-credentials}, /var/lib/b102, Jenkins 그룹 반영
    deploy.sh               (pull) → 배포 전 pg_dump → build → up --wait → 헬스 → 상태 기록. 실패 시 조건부 자동 복구. Jenkins 도 호출
    issue-cert.sh           Let's Encrypt 최초 발급 (webroot)
    renew-cert.sh           갱신 cron
    backup-postgres.sh      pg_dump gzip 7세대 cron
```

| 서비스 | 이미지 | 메모리 상한 | 노출 |
| --- | --- | --- | --- |
| web | `b102-web:<sha>` (빌드) | 128m | **0.0.0.0:80, 443** — 유일한 외부 진입점 |
| backend | `b102-backend:<sha>` (빌드) | 1.5g | 127.0.0.1:18080 (헬스체크용) |
| postgres | `postgres:16.15` | 3g | 127.0.0.1:5432 |
| elasticsearch | `b102-elasticsearch-nori:8.19.21` (빌드, xpack 켜짐) | 4g (힙 2g) | 127.0.0.1:9200 |
| qdrant | `qdrant/qdrant:v1.18.3`, `--profile recsys` | 3g | 127.0.0.1:6333 |

기본 합계 8.6g, Qdrant 를 켜면 11.6g. 여기에 수집기 systemd 상한 3g 와 Jenkins(도입 후) 1~1.5g 가 더해진다.
Qdrant 를 켜기 전에 수집기 상한을 내려야 한다. CPU 상한은 걸지 않았다(수집기와 실측 후 결정). 컨테이너 로그는 데몬 전역 10m×3.

## 최초 배포 순서

```bash
# 0. 로컬: 키 정리 (한 번만)
mv ~/Downloads/J15B102T.pem ~/.ssh/ && chmod 600 ~/.ssh/J15B102T.pem
printf 'Host b102\n  HostName j15b102.p.ssafy.io\n  User ubuntu\n  IdentityFile ~/.ssh/J15B102T.pem\n' >> ~/.ssh/config

# 1. 서버 준비
ssh b102 'git clone https://lab.ssafy.com/s15-bigdata-recom-sub1/S15P21B102.git ~/S15P21B102'
ssh b102 'sudo bash ~/S15P21B102/deploy/scripts/setup-ec2.sh'   # 끝나면 재로그인 (docker 그룹)

# 2. 환경변수
ssh b102 'cp ~/S15P21B102/deploy/.env.example ~/S15P21B102/deploy/.env && chmod 600 ~/S15P21B102/deploy/.env'
ssh b102 'vim ~/S15P21B102/deploy/.env'   # POSTGRES_PASSWORD · ELASTIC_PASSWORD · LETSENCRYPT_EMAIL 등. openssl rand -base64 32

# 3. 기동 (HTTP)
ssh b102 'bash ~/S15P21B102/deploy/scripts/deploy.sh'
curl -I http://j15b102.p.ssafy.io/nginx-health           # 안 되면 AWS 보안 그룹 80/443 확인

# 4. HTTPS
ssh b102 'bash ~/S15P21B102/deploy/scripts/issue-cert.sh'
ssh b102 "sed -i 's/^TLS_ENABLED=.*/TLS_ENABLED=true/' ~/S15P21B102/deploy/.env && cd ~/S15P21B102 && docker compose -f deploy/docker-compose.yml up -d web"
curl -I https://j15b102.p.ssafy.io/nginx-health

# 5. cron
ssh b102 '(crontab -l; echo "0 3 * * * $HOME/S15P21B102/deploy/scripts/backup-postgres.sh >> $HOME/backup-postgres.log 2>&1"; echo "0 4 * * * $HOME/S15P21B102/deploy/scripts/renew-cert.sh >> $HOME/certbot.log 2>&1") | crontab -'
```

## 로컬에서 전체 스택 띄우기 (팀원용)

JDK·Node 없이 web·backend·PostgreSQL·Elasticsearch 를 컨테이너로 한 번에 띄운다. 운영 compose 위에 `docker-compose.local.yml` 을 덧씌우는 방식이라 운영 설정과 갈라지지 않는다. `backend/docker-compose.yml`(PG+ES 만, 백엔드 개발용) 과 동시에 띄워도 이름·포트가 달라 충돌하지 않는다.

```bash
bash deploy/scripts/local-up.sh              # 처음엔 deploy/.env.local 을 견본에서 자동 생성. 빌드 3~5분
bash deploy/scripts/local-up.sh logs -f backend
bash deploy/scripts/local-up.sh down         # 중지 (데이터 유지)
bash deploy/scripts/local-up.sh down -v      # 중지 + 데이터 삭제
```

| 주소 | 용도 |
| --- | --- |
| http://localhost:8088 | 웹 (프론트 + `/api/` 프록시) |
| http://localhost:8088/swagger-ui/index.html | API 문서 |
| http://localhost:18080/actuator/health | backend 직접 |
| localhost:15432 | PostgreSQL (`book` / `.env.local` 의 비번 / `bookdb`) |
| localhost:19200 | Elasticsearch (`elastic` / `.env.local` 의 비번) |

- 소스를 고쳤으면 다시 `local-up.sh` 를 실행하면 바뀐 이미지만 재빌드된다.
- 캠퍼스 네트워크에서 이미지 pull 이 실패하면 [backend/README](../backend/README.md) 의 미러 방법을 쓴다.
- **DB 는 비어 있다.** V1 스키마와 seed 데이터가 들어오기 전까지 검색·추천 화면은 빈 결과다. seed 는 EC2 pg_dump 를 잘라 만드는 스크립트로 이후 제공한다.
- Windows 는 Git Bash 에서 실행한다. PowerShell 이면 `local-up.sh` 안의 `docker compose ...` 명령을 그대로 쳐도 된다.

## 자동 배포 (Jenkins CD) 와 운영 스위치

`dev` 의 Jenkins CI 가 전부 통과하면 `deploy (dev)` 스테이지가 **`/etc/b102/cd-enabled` 파일이 있을 때만** 같은 workspace 의 SHA 로 `deploy.sh --no-pull` 을 실행한다.
파일이 없으면 CI 성공 뒤 "cd-gate-closed" 로 끝나고 서버는 바뀌지 않는다. 문서만 바뀐 커밋(`docs-only`)은 배포하지 않는다.

```bash
sudo touch /etc/b102/cd-enabled   # 자동 배포 켬
sudo rm /etc/b102/cd-enabled      # 끔 (장애 대응·수동 작업 중에는 끈다)
```

수동 배포와 Jenkins 배포는 `setup-cd.sh` 가 만든 같은 파일을 쓴다. 그래서 둘이 겹치지 않는다.

| | 경로 | 권한 |
| --- | --- | --- |
| 운영 비밀값 | `/etc/b102/deploy.env` | root:b102 640 |
| 배포 락 | `/etc/b102/deploy.lock` | root:b102 660 |
| 릴리스 상태 | `/var/lib/b102/current-release`, `previous-release` | root:b102 2770 |
| pg_dump 저장소 | `/var/lib/b102/backups` (`bookdb_*` 일일 7세대, `pre_<sha>_*` 배포 전 5세대) | root:b102 2770 |
| GitLab pull 인증 | `/etc/b102/git/credentials` (Jenkins checkout 토큰 재사용, 읽기 전용) | root:b102 640 |

### 배포 전 백업과 롤백 규칙

- `deploy.sh` 는 `up` 직전에 `pg_dump` 를 `pre_<sha>_*.sql.gz` 로 남긴다(5세대). 일일 백업(`bookdb_*`, 7세대)과 별도.
- 마이그레이션 지문(`db/migration/*.sql` 의 sha256)을 릴리스마다 기록한다.
- 새 릴리스 기동이 실패하거나 **배포 후 헬스체크(readiness·http·https)가 실패하면** 같은 경로로: **지문이 직전 성공 릴리스와 같을 때만** 코드를 직전 SHA 로 자동 복구한다. `current-release` 는 헬스까지 통과한 뒤에만 갱신되고, 실패는 `/var/lib/b102/last-failed-release` 에 남는다. **지문이 다르면(이번 배포에 migration 이 있으면) 자동 복구하지 않는다.** Flyway 는 전진 전용이라 DB 를 자동으로 되돌리면 데이터가 유실될 수 있다. 사람이 `pre_<sha>` dump 를 보고 판단한다.
- 배포 = 마이그레이션 실행이다. migration 이 든 MR 은 머지 전에 스키마 담당 리뷰를 거친다.

## 평소 배포

```bash
ssh b102 'bash ~/S15P21B102/deploy/scripts/deploy.sh'          # origin/dev 최신을 pull 해서 배포 (git-credentials 로 인증)
ssh b102 'BRANCH=feature/x bash ~/S15P21B102/deploy/scripts/deploy.sh'   # 특정 브랜치
ssh b102 'bash ~/S15P21B102/deploy/scripts/deploy.sh --no-pull'          # 현재 체크아웃 그대로
```

수동 배포는 Jenkins 가 죽었을 때의 fallback 이다. 평상시에는 `dev` 머지가 곧 배포다(gate 가 열려 있을 때).
공용 락(`/etc/b102/deploy.lock`)이 있어 수동·자동이 겹치면 뒤에 온 쪽이 거부된다.

## 운영

AI 모델·태그 sidecar·Qdrant index를 갱신하거나 롤백할 때는
[`AI 모델·태그·임베딩 Index 운영 Runbook`](../docs/AI_MODEL_TAG_INDEX_RUNBOOK.md)의
version 기록, alias 전환, health smoke test 순서를 따른다. `AI_INDEX_VERSION`만
되돌리지 말고 `books_active` alias도 같은 이전 index로 복구해야 한다.

```bash
cd ~/S15P21B102 && C="docker compose -f deploy/docker-compose.yml"
$C ps                                  # 상태
$C logs -f --tail 200 backend          # 로그
docker stats --no-stream               # 메모리 (상한 대비)
curl -s 127.0.0.1:18080/actuator/health/readiness
$C restart backend                     # 백엔드만 재기동
$C up -d --profile recsys qdrant       # 추천 붙일 때
docker exec -it b102-postgres psql -U book -d bookdb
```

## 주의

- **초기 대량 적재(300만 건)는 이 상한으로 돌리지 않는다.** 새벽에 backend 를 내리고 PG·ES 상한을 임시로 풀어 적재한 뒤 원복한다. ES 는 적재 전 `refresh_interval=-1`, `number_of_replicas=0`.
- ES 컨테이너 상한(4g)을 바꾸면 `.env` 의 `ES_JAVA_OPTS` 힙도 절반으로 맞춘다.
- `deploy/.env` 의 PostgreSQL 비밀번호는 첫 초기화에만 반영된다. 나중에 바꾸면 `ALTER ROLE`.
- Swagger 는 팀 내부용으로 열어두었다. 공개 서비스가 되면 `web/nginx/snippets/app.conf` 에서 막는다.
- 로컬 개발 인프라(`backend/docker-compose.yml`)와 컨테이너 이름이 같다. 한 PC 에서 둘을 동시에 띄우지 않는다.
- compose 프로젝트명은 `brbbr` 이지만 **볼륨 이름은 `b102_*` 로 고정**되어 있다(`volumes.*.name`). 프로젝트명을 바꿔도 서버의 PG 데이터·ES 인덱스·인증서가 그대로 연결되게 하기 위한 것이니 볼륨 이름은 바꾸지 않는다.
- 프로젝트명이 바뀐 뒤 첫 배포 전에는 서버에서 옛 프로젝트를 한 번 내려야 한다(컨테이너 이름이 같아 충돌): `docker compose -p b102 -f deploy/docker-compose.yml down` (볼륨은 유지됨) → `deploy.sh`.
