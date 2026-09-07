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
  scripts/
    setup-ec2.sh            최초 1회: Docker · 데몬 로그 상한 · 스왑 2G · ufw 80/443 · vm.max_map_count
    deploy.sh               git pull → build → up --wait → 헬스체크 → prune. Jenkins 가 그대로 호출
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

합계 11.6g + 수집기 상한 3g. 컨테이너 로그는 데몬 전역 10m×3.

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

## 평소 배포

```bash
ssh b102 'bash ~/S15P21B102/deploy/scripts/deploy.sh'          # dev 최신
ssh b102 'BRANCH=feature/x bash ~/S15P21B102/deploy/scripts/deploy.sh'   # 특정 브랜치
```

배포 잠금(`deploy/.deploy.lock`)이 있어 동시 실행은 거부된다. Jenkins 도입 후에는 Jenkins 가 이 스크립트를 호출한다.

## 운영

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
