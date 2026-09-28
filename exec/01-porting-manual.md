# S15P21B102 포팅 매뉴얼

## 1. 시스템 구성

도서 추천 서비스는 웹 클라이언트, Spring API, Python 추천 API, PostgreSQL, Elasticsearch로 구성된다. Qdrant는 추천 벡터 검색을 사용할 때 선택적으로 켠다.

```text
Browser
  -> HTTPS :443 / HTTP :80
     -> Nginx web container
        -> /api/v1, /swagger-ui, /v3/api-docs -> Spring Boot API :8080
        -> 그 외 경로 -> React SPA

Spring API
  -> PostgreSQL :5432       원천 데이터·사용자·서재·추천 이력
  -> Elasticsearch :9200    도서 검색 인덱스(한국어 nori)
  -> FastAPI :8000           추천·BOOK DNA 계산
       -> (선택) Qdrant :6333 임베딩 기반 도서 검색
```

배포 구성은 EC2 한 대의 Docker Compose다. 외부에서 접속하는 포트는 Nginx의 80·443이며, 데이터베이스·검색엔진·백엔드 관리 포트는 loopback에 묶는다. GitLab webhook은 Nginx를 거쳐 호스트 Jenkins에 전달된다.

### 주요 기능과 경계

- 카카오·Google OAuth 로그인, 3단계 신규 사용자 온보딩
- 도서 검색·상세·인기도서·비슷한 책·함께 대출된 책
- 개인 서재의 읽음·찜 상태, 평점·완독일·한 줄 감상
- 관심 태그와 독서 행동 기반 추천, 추천 노출·선택 이벤트 기록
- BOOK DNA 리포트 및 랜덤 책 가챠
- Python 추천 서버는 내부 API이며 프론트엔드가 직접 호출하지 않는다.

## 2. 기준 버전

### WAS·웹 런타임 세부 설정

| 구분 | 제품·설정 |
| --- | --- |
| Backend WAS | Spring Boot 내장 Tomcat. 별도 Tomcat 설치·관리 없음 |
| Spring API | 컨테이너 8080, 운영 호스트 127.0.0.1:18080 |
| API prefix | /api/v1 |
| OpenAPI | /v3/api-docs, Swagger UI /swagger-ui/index.html |
| Python API | FastAPI + Uvicorn, 기본 8000, health /health |
| Frontend build | Node 24 Alpine, npm ci → npm run build |
| Frontend web server | nginx:1.30-alpine 정적 SPA와 reverse proxy |
| Elasticsearch 분석 | 8.19.21 + analysis-nori, 한국어 형태소와 공백 제거 bigram |
| 시간 기준 | DB 저장 UTC, 브라우저 표시 Asia/Seoul |

Gradle wrapper는 8.14.5이며 JDK toolchain은 21이다. Windows 한글 경로에서 Gradle 테스트 worker의 classpath 인코딩 문제가 발생하면 backend/README.md의 사용자별 Gradle 설정을 확인한다. IntelliJ·VS Code 등 IDE 버전과 운영 서버 Docker Engine의 patch 버전은 저장소에서 고정하지 않는다.

### 개발·빌드 도구

| 구분 | 기준 | 저장소 근거 |
| --- | --- | --- |
| IDE | 저장소에서 특정 제품·버전을 고정하지 않음 | 팀 개발 환경에서 확인 필요 |
| JDK | Eclipse Temurin 21 | `backend/Dockerfile`, Gradle toolchain |
| Spring Boot | 3.5.16 | `backend/build.gradle` |
| Gradle | 8.14.5 | `backend/gradle/wrapper/gradle-wrapper.properties` |
| WAS | Spring Boot 내장 Tomcat | Boot 의존성 관리. 별도 WAS 설치 없음 |
| Node.js | 24 | `frontend` 및 배포 Dockerfile |
| npm | lockfile 기준 npm 설치 | `frontend/package-lock.json` |
| React / TypeScript / Vite | 19.2 / 5.9 / 7.3 계열 | `frontend/package.json` |
| Python | 3.12 | `ai/pyproject.toml`, `ai/Dockerfile` |
| Python API | FastAPI·Uvicorn | `ai/pyproject.toml` 및 `ai/src/recommendation/api.py` |

### 운영 런타임

| 구분 | 배포 기준 | 설정 근거 |
| --- | --- | --- |
| 서버 OS·사양 | Ubuntu 24.04, 4 vCPU, 16 GiB RAM, 309 GB | `deploy/README.md` |
| 배포 방식 | Docker Compose, EC2 단일 서버 | `deploy/docker-compose.yml` |
| 웹 서버 | Nginx 1.30 Alpine | `deploy/web/Dockerfile` |
| Spring 런타임 | Eclipse Temurin 21 JRE Alpine | `backend/Dockerfile` |
| PostgreSQL | 16.15 | Compose image |
| Elasticsearch | 8.19.21 + analysis-nori | Compose 및 Elasticsearch Dockerfile |
| Qdrant | 1.18.3, 선택 profile `recsys` | Compose image |
| Jenkins | LTS 2.568.3, OpenJDK 21 | `deploy/jenkins/README.md` 기준(2026-09-07) |

IDE 버전, 작성 PC의 Git 버전 등 저장소에서 확인할 수 없는 개발자 PC 값은 팀의 실제 설치 환경을 기준으로 별도 기록한다.

## 3. 저장소와 로컬 실행

### 3.0 구성 파일과 빌드 범위

| 경로 | 역할 |
| --- | --- |
| frontend/ | React SPA, npm lockfile 기반 재현 빌드, MSW mock |
| backend/ | Spring API, JPA/Flyway, OAuth/JWT, 검색·추천 API |
| ai/ | FastAPI 온라인 추천 API, 추천·DNA 계산, 오프라인 CLI·평가 |
| database/ | 외부 도서 API별 수집기·정규화기·품질 확인 자료 |
| deploy/ | 운영·로컬 Compose, Nginx, 백업·배포·인증서 script |
| scripts/ci/ | Jenkins가 호출하는 frontend/backend/AI/data/deploy 검증 script |
| docs/ | API 계약, ERD, 기술 기준, 데이터·AI 운영 문서 |

### 3.0.1 사전 요구사항

| 작업 | 필요 환경 |
| --- | --- |
| 전체 로컬 Compose | Docker Desktop 또는 Linux Docker Engine, Compose v2, Git Bash(Windows) |
| Backend 단독 실행 | JDK 21, Docker로 PostgreSQL·Elasticsearch |
| Frontend 단독 실행 | Node.js 24, npm, 백엔드 또는 MSW 설정 |
| AI 개발 | Python 3.12, uv 권장 |
| 원본 수집·대량 색인 | API별 호출 권한, 외부 데이터 파일 위치, 작업별 별도 설정 |

모노레포의 대량 원본 데이터 약 5.5GB는 저장소 밖 project_personal/에 두는 운영 방식이다. 저장소만 clone하면 DB seed나 원본 수집 자료까지 함께 복원되는 것은 아니다.

### 3.1 Clone

비공개 SSAFY GitLab 저장소이므로 팀원에게 프로젝트 접근 권한이 필요하다.

```bash
git clone https://lab.ssafy.com/s15-bigdata-recom-sub1/S15P21B102.git
cd S15P21B102
```

### 3.2 권장: 전체 로컬 스택

Docker가 실행 중인 Windows에서는 Git Bash를 사용한다. 첫 실행 때 예시 환경 파일을 기준으로 로컬 설정을 준비한다.

```bash
bash deploy/scripts/local-up.sh
bash deploy/scripts/local-up.sh logs -f backend
```

로컬 전체 스택은 Nginx 웹, Spring API, Python API, PostgreSQL, Elasticsearch로 구성된다. Qdrant는 필요할 때만 `recsys` profile로 추가한다. 로컬 주소는 웹 `http://localhost:8088`, Swagger `http://localhost:8088/swagger-ui/index.html`, 백엔드 health `http://localhost:18080/actuator/health`, PostgreSQL `localhost:15432`, Elasticsearch `localhost:19200`이다.

첫 실행 스크립트는 deploy/.env.local을 예시에서 생성하고 운영 Compose 위에 docker-compose.local.yml을 적용한다. 개발 로컬의 기본 상한은 운영보다 낮고 TLS는 비활성화된다. 중지는 down으로 하고, down -v는 PostgreSQL·Elasticsearch volume까지 삭제하므로 데이터가 필요하면 사용하지 않는다. Qdrant를 켤 때는 PROFILES='--profile recsys'를 추가한다.

전체 스택이 올라오면 web health는 /nginx-health, backend readiness는 /actuator/health/readiness, AI health는 /health로 확인한다. backend/swagger 링크는 팀 내부용으로 현재 공개되어 있어, 외부 운영 전에는 Nginx 공개 정책을 다시 검토한다.

Compose의 새 DB는 빈 데이터베이스다. 앱은 Flyway로 스키마를 만들지만, 서비스에 필요한 대량 도서·추천 자료는 별도 데이터 준비 절차가 필요하다.

### 3.3 개별 개발 서버

Backend:

```bash
cd backend
cp .env.example .env
docker compose up -d
./gradlew bootRun
```

Frontend:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

Python 추천 API:

```bash
cd ai
uv sync --extra dev
uv run uvicorn recommendation.api:app --host 127.0.0.1 --port 8000
```

`backend/docker-compose.yml`은 PostgreSQL·Elasticsearch 개발 인프라만 시작한다. 프론트 개발 서버는 기본적으로 `/api`를 localhost의 백엔드로 프록시한다.

### 3.4 빌드

```bash
# Frontend
cd frontend && npm ci && npm run build

# Backend
cd backend && ./gradlew bootJar

# Python API image (저장소 루트에서 실행)
docker build -f ai/Dockerfile -t b102-ai:local ai
```

컨테이너 빌드는 `backend/Dockerfile`에서 테스트를 제외하고 실행한다. 변경 검증은 Jenkins CI와 `scripts/ci/README.md`의 로컬 절차를 따른다.

## 4. 빌드·운영 환경 변수

### 4.1 Frontend·Backend 빌드 변수

| 변수 | 적용 위치 | 의미·기준값 |
| --- | --- | --- |
| VITE_API_BASE_URL | Frontend 빌드 | 운영은 /api/v1. 브라우저 요청을 Nginx로 보냄 |
| VITE_ENABLE_MSW | Frontend 빌드 | mock 화면 개발 때 true, 운영 image는 false |
| VITE_PROXY_TARGET | Vite 개발 서버 | 미지정 시 localhost:8080 백엔드 proxy |
| SERVER_PORT | Spring runtime | 기본 8080 |
| DB_URL / DB_USERNAME / DB_PASSWORD | Spring runtime | PostgreSQL JDBC 접속. Compose 내부 hostname은 postgres |
| DB_POOL_SIZE | Spring runtime | 운영 Compose 기본 10, local example 5 |
| ES_URIS / ES_USERNAME / ES_PASSWORD | Spring runtime | Compose 내부 Elasticsearch 주소·인증 |
| SEARCH_INDEX_ALIAS / SEARCH_INDEX_NAME | Spring runtime | 논리 alias books, 매핑 버전 인덱스 books_v7 |
| SEARCH_CREATE_INDEX_ON_START / SEARCH_INDEX_ON_START | Spring runtime | 없을 때 alias 생성, IF_CREATED 기본 색인 정책 |
| FRONTEND_ORIGIN / OAUTH_REDIRECT_BASE_URL | Spring runtime | OAuth 성공 후 브라우저 목적지 및 proxy 뒤 callback origin |
| JWT_SECRET / JWT_ACCESS_TTL_SECONDS | Spring runtime | 운영 access JWT 기본 수명 900초, 서명 재료는 서버에서만 주입 |
| JWT_REFRESH_TTL_SECONDS / JWT_REFRESH_GRACE_SECONDS | Spring runtime | 기본 14일 절대 만료, 회전 직후 경합 허용 10초 |
| AI_RECOMMENDATION_URL | Spring runtime | Compose 내부 기본 http://ai:8000 |
| AI_CONNECT_TIMEOUT / AI_READ_TIMEOUT | Spring runtime | 기본 2초 / 10초, DNA 별도 읽기 timeout 15초 |

Frontend build argument는 deploy/web/Dockerfile에서 설정한다. 운영 웹은 API를 같은 origin의 /api/v1로 부르고, frontend에 OAuth client secret이나 AI service 주소를 빌드해 넣지 않는다. .env.example은 기본값·형식의 안내용이며 실 서비스 비밀값이 아니다.

### 4.2 운영 Compose 변수

| 그룹 | 주요 설정 |
| --- | --- |
| 릴리스·도메인 | RELEASE, DOMAIN, TLS_ENABLED, LETSENCRYPT_EMAIL |
| PostgreSQL | POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST_PORT, DB_POOL_SIZE |
| Elasticsearch | ELASTIC_PASSWORD, ES_JAVA_OPTS |
| Qdrant | QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION, QDRANT_TAG_COLLECTION, QDRANT_VECTOR_NAME |
| 추천 런타임 | AI_PORT, AI_LOG_LEVEL, AI_MODEL_VERSION, AI_INDEX_VERSION, AI_FEATURE_VERSION, AI_TAG_VERSION |
| OAuth | OAUTH_KAKAO_CLIENT_ID/SECRET, OAUTH_GOOGLE_CLIENT_ID/SECRET, AUTH_CALLBACK_TOKEN_IN_FRAGMENT |
| 백업·로그 | BACKUP_DIR, LOG_LEVEL_APP |

실제 배포 기본값은 deploy/.env.example, 로컬 값은 deploy/.env.local.example을 기준으로 한다. 운영 Qdrant는 Docker Compose의 recsys profile에 포함된다. Jenkins 배포 stage는 해당 profile을 전달하므로 배포 파이프라인에서는 Qdrant가 켜지는 구성이다. 수동 실행에서 profile을 생략하면 Qdrant가 시작되지 않는다.

### 4.3 AI 온라인·오프라인 설정 구분

온라인 FastAPI는 AI_PORT, AI_LOG_LEVEL, 모델·index/tag 버전과 Qdrant 연결 정보만 사용한다. 외부 GMS 호출 설정은 임베딩·태그 sidecar의 오프라인 생성 작업에 필요한 값이며 API 컨테이너에 불필요하다. 배치 제한 설정에는 timeout, dimension, batch size, rule confidence threshold, cache 경로와 예상 비용 상한이 있다. 데이터 파이프라인 자체 환경 파일은 deploy/.env와 별도 위치에서 관리한다.

실제 값은 `.env.example` 파일에 기본값·설명과 함께 정의되어 있다. `.env.example`을 복사해 로컬 값을 채우며, 비밀번호·토큰·외부 API 자격 정보의 값은 Git에 기록하지 않는다.

| 영역 | 변수 이름 | 용도·기준 |
| --- | --- | --- |
| Frontend 빌드 | `VITE_API_BASE_URL`, `VITE_ENABLE_MSW` | 운영 `/api/v1`, MSW 비활성화. 웹 이미지 빌드 시 전달 |
| Database | `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `DB_POOL_SIZE` | PostgreSQL 접속과 커넥션 풀 |
| Search | `ES_URIS`, `ES_USERNAME`, `ES_PASSWORD`, `SEARCH_INDEX_ALIAS`, `SEARCH_INDEX_NAME`, `SEARCH_INDEX_ON_START` | Elasticsearch 접속·인덱스 생성 및 색인 정책 |
| Auth | `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `JWT_REFRESH_GRACE_SECONDS`, `FRONTEND_ORIGIN`, `AUTH_CALLBACK_TOKEN_IN_FRAGMENT` | 짧은 수명의 JWT와 회전형 HttpOnly refresh cookie, OAuth redirect 검증 |
| OAuth | `OAUTH_REDIRECT_BASE_URL`, `OAUTH_KAKAO_CLIENT_ID`, `OAUTH_KAKAO_CLIENT_SECRET`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET` | OAuth 앱 등록과 콜백 연결 |
| AI API | `AI_RECOMMENDATION_URL`, `AI_CONNECT_TIMEOUT`, `AI_READ_TIMEOUT`, `AI_DNA_READ_TIMEOUT`, `AI_DNA_CACHE_TTL` | Spring API에서 내부 FastAPI 호출 |
| AI·Qdrant 운영 | `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `QDRANT_TAG_COLLECTION`, `AI_MODEL_VERSION`, `AI_INDEX_VERSION`, `AI_FEATURE_VERSION`, `AI_TAG_VERSION` | 벡터 색인·추천 모델 버전. Qdrant를 쓰지 않는 경우 관련 설정 생략 가능 |
| 운영 Compose | `DOMAIN`, `TLS_ENABLED`, `LETSENCRYPT_EMAIL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `ELASTIC_PASSWORD`, `BACKUP_DIR` | 도메인·TLS·서비스 계정·백업 위치 |
| 오프라인 데이터 작업 | `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `TAG_API_URL`, `TAG_API_KEY`, `TAG_MODEL` 및 배치 제한 변수 | 추천 인덱스·태그 sidecar 작업 전용. 온라인 API 컨테이너에는 불필요 |

환경 변수 전체 설명·기본값은 `deploy/.env.example`, `deploy/.env.local.example`, `backend/.env.example`, `frontend/.env.example`, `ai/README.md`에서 확인한다. 표에 든 비밀 변수는 이름만 안내하며 실제 값을 싣지 않는다.

## 5. 배포와 시연 환경

운영 배포 대상은 문서 기준 `j15b102.p.ssafy.io`의 Ubuntu EC2다. 운영용 환경 파일은 서버 checkout의 `deploy/.env`이며 예시에서 복사해 권한을 제한한다. 배포 문서 기준 소유·그룹·mode는 ubuntu:b102 640이고 Jenkins도 같은 파일을 읽는다. GitLab checkout·Jenkins 내부 접근 자료는 문서에 값으로 기록하지 않고 별도 보호 경로에 둔다. 운영 Compose와 실행 순서는 [배포 안내](../deploy/README.md)를 기준으로 한다.
### CI/CD 흐름

1. GitLab Merge Request와 `dev` 변경을 Jenkins가 검증한다.
2. 빌드·테스트가 통과하고 배포 스위치가 허용하면 Jenkins가 해당 commit SHA로 배포한다.
3. 마이그레이션 포함 배포는 사전 PostgreSQL 백업을 만든다.
4. Compose health check와 `deploy/scripts/smoke.sh` 결과를 확인한다.
5. 실패 시 배포 스크립트의 마이그레이션 지문·이전 release 기준 복구 규칙을 따른다.

Jenkins는 호스트 서비스로 운영되며 외부 UI 공개를 피하고 SSH 터널로 관리한다. 세부 설치·토큰 전달 방법은 저장소의 Jenkins 운영 문서에 있고, 본 포팅 문서에는 실제 자격 정보를 기록하지 않는다.

### 컨테이너 자원

#### 서버 리소스·컨테이너 한도

| Container | Compose 제한 | 호스트 게시 포트 |
| --- | --- | --- |
| web | 128 MiB | 80, 443 전체 인터페이스 |
| backend | 1536 MiB | 127.0.0.1:18080 |
| ai | 1 GiB | 호스트 게시 없음, Compose network에 8000 expose |
| postgres | 3 GiB | 127.0.0.1:5432 |
| elasticsearch | 4 GiB, JVM heap 기본 2 GiB | 127.0.0.1:9200 |
| qdrant | 5 GiB | 127.0.0.1:6333, recsys profile |

Compose에 정의된 기본 서비스(web·backend·AI·PostgreSQL·Elasticsearch)의 memory limit 합은 약 9.6 GiB이며 Qdrant 포함 시 약 14.6 GiB다. deploy/README.md와 Jenkins README의 과거 합계 8.6 GiB는 AI container 1 GiB를 제외한 계산이다. 호스트에는 Jenkins와 도서 수집 systemd 작업도 함께 있어, Qdrant·CI 빌드를 동시에 돌릴 때는 사용 가능 메모리를 확인한다. Docker json-file 로그는 서비스별 10 MiB × 3 파일로 제한한다. 실제 컨테이너 limit은 deploy/docker-compose.yml을 기준으로 한다.

### 최초 서버 준비·TLS

1. 비공개 GitLab에서 저장소를 clone하고 deploy/scripts/setup-ec2.sh를 1회 실행한다. Docker, swap, UFW 80·443, vm.max_map_count와 로그 제한을 설정한다.
2. deploy/.env.example을 deploy/.env로 복사해 도메인·DB·Elasticsearch·OAuth 및 모델 설정을 채우고 파일 권한을 제한한다.
3. deploy/scripts/deploy.sh로 HTTP 구성에서 서비스를 기동하고 /nginx-health와 backend readiness를 확인한다.
4. deploy/scripts/issue-cert.sh로 webroot 방식 인증서를 발급한다. 발급 후 TLS_ENABLED=true로 바꾸고 web container를 재기동한다.
5. 매일 PostgreSQL 백업과 인증서 갱신 작업이 스케줄되어 있는지 확인한다. 인증서가 갱신된 경우 nginx reload를 수행한다.

최초 실행·갱신 명령은 deploy/README.md의 순서를 따른다. DNS가 서버를 가리키고 외부 80·443이 허용되어야 HTTP-01 인증서 발급이 가능하다.

### 백업·롤백과 배포 후 점검

일일 pg_dump 백업은 gzip으로 보관하고 기본 7세대를 유지한다. migration이 포함된 신규 배포와 첫 릴리스는 배포 직전 백업을 남기며, pre-release 백업은 5세대 관리한다. migration 파일 집합의 SHA-256 지문이 바뀐 배포는 DB를 자동 복원하지 않는다. Flyway migration은 전진 적용이므로 실패 시 백업을 검토하고 운영자가 복구 여부를 결정한다. 지문이 같은 코드 배포는 헬스 실패 시 이전 코드 release로 조건부 복귀할 수 있다.

배포 후에는 Compose health, GET /actuator/health/readiness, 공개 /nginx-health와 deploy/scripts/smoke.sh를 확인한다. 사용자 흐름 smoke test는 사전 승인된 완료 사용자 세션으로 별도 실행한다. 배포·백업의 상세 조건은 deploy/README.md 및 deploy/scripts/deploy.sh가 정본이다.

### 배포 확인 주소와 포트

| 용도 | 주소·포트 |
| --- | --- |
| 서비스 | `https://j15b102.p.ssafy.io` |
| Nginx health | `/nginx-health` |
| Spring health | 호스트 loopback `127.0.0.1:18080/actuator/health` |
| Webhook | `/gitlab-webhook/post` (Nginx에서 호스트 Jenkins로 전달) |
| 공개 포트 | 80, 443 |
| 내부·운영자 전용 | Spring 18080, PostgreSQL 5432, Elasticsearch 9200, Qdrant 6333 (Qdrant는 선택) |

도메인·서버·인증서 상태는 변할 수 있으므로 제출 전 운영 담당자가 현재 값과 응답을 다시 확인한다.

## 6. DB 접속·마이그레이션·ERD

| 환경 | PostgreSQL | Database | 계정 |
| --- | --- | --- | --- |
| backend 개발 Compose | `localhost:5432` (충돌 시 포트 변경) | `bookdb` | `book` |
| 전체 로컬 Compose | `localhost:15432` | `bookdb` | `book` |
| 운영 Compose 내부 | `postgres:5432` | 운영 설정으로 주입 | 운영 설정으로 주입 |

물리 스키마의 실행 가능한 기준은 `backend/src/main/resources/db/migration/V1__init.sql`부터 `V12__refresh_tokens.sql`까지의 Flyway migration이다. Hibernate는 `ddl-auto: validate`로만 동작한다. 설계 관계도는 `docs/ERD.md`, 상세 컬럼 설계는 `docs/DB_TABLE_DESIGN.md`, 초기 ERDCloud import 자료는 `docs/ERDCLOUD_IMPORT.sql`이다. 이 문서 폴더의 `03-database/schema-only.sql`은 현재 저장소 migration 기준으로 합친 스키마 참조본이며 운영 DB를 직접 덤프한 파일은 아니다.

운영 적재 상태 기록(2026-09-11 기준): books 약 331만 행, kdc_codes 949행, book_demand_features 약 275만 행, book_tags 약 242만 행, book_loaned_top20 1,200행. 이 수치는 저장소 문서에 남은 특정 시점 값이며 현재 서버와 같다고 보장하지 않는다. 이 테이블들이 비어 있으면 Flyway와 앱 health가 정상이어도 검색·인기도서·추천 결과가 빈 상태일 수 있다. 신규 DB 복원은 스키마 적용 후 별도 데이터 적재와 Elasticsearch 재색인까지 확인해야 한다.

ERDCloud용 초기 모델과 V1 이후 운영 스키마에는 차이가 있다. 최종 DB 구조를 설명할 때는 Flyway와 docs/ERD.md를 먼저 대조하고, docs/ERDCLOUD_IMPORT.sql을 최신 스키마라고 단정하지 않는다.

새 환경에서 앱을 띄울 때는 Flyway를 사용한다. 제출용 참조 파일을 확인·복원해야 한다면 `03-database/README.md`의 적용 주의 사항을 먼저 읽는다.
