# 책추책책추

> 서재에 기록한 책과 도서관 대출 데이터를 바탕으로, 나에게 맞는 책을 추천 이유와 함께 보여 주는 개인 서재·도서 추천 서비스

SSAFY 15기 2학기 특화 프로젝트 · 서울 1캠퍼스 B반 102팀

<br/>

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [시스템 아키텍처](#시스템-아키텍처)
- [ERD](#erd)
- [API 명세](#api-명세)
- [프로젝트 구조](#프로젝트-구조)
- [실행 방법](#실행-방법)
- [팀원 소개](#팀원-소개)
- [협업 규칙](#협업-규칙)
- 문서: [개발 일정](docs/PROJECT_SCHEDULE.md) · [MVP 구현 계획](docs/MVP_IMPLEMENTATION_PLAN.md) · [추천 서비스 방향](docs/RECOMMENDATION_SERVICE_DIRECTION.md) · [AI 추천 계약](docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md) · [BOOK DNA 계약](docs/BOOK_DNA_API_CONTRACT.md) · [데이터 파이프라인](docs/pipeline/README.md) · [배포](deploy/README.md)

<br/>

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | 책추책책추 |
| 개발 기간 | 2026.08.25 ~ 2026.09.28 (5주) |
| 팀 구성 | 프론트엔드 3명 / 백엔드 2명 / AI 1명 |
| 배포 URL | https://j15b102.p.ssafy.io |

### 기획 배경

- **찾을 수 있어야 한다** — 국립중앙도서관과 도서관 정보나루의 ISBN 을 합쳐 카탈로그를 만들고, 한 출처에 없다는 이유로 책을 빼지 않는다.
- **지금 읽을 책을 골라 준다** — 전국 도서관의 대출 수요와 신간으로 추천 후보를 만든다.
- **기록할수록 정교해진다** — 처음에는 연령·성별 인기와 온보딩 취향으로 추천하고, 서재와 별점이 쌓이면 개인화한다. 모든 추천에는 이유를 함께 보여 준다.

### 타겟 사용자

- 다음에 읽을 책을 고르기 어려운 독자
- 읽은 책을 기록하고 자신의 독서 취향을 알고 싶은 독자

<br/>

## 주요 기능

### 1. 소셜 로그인 · 온보딩

- 카카오 · Google OAuth 로그인, 액세스 토큰(15분) + HttpOnly 리프레시 쿠키 회전
- 프로필(닉네임 · 출생연도 · 성별) → 관심 분야 → 읽은 책과 별점의 3단계 온보딩

### 2. 홈 · 도서 검색 · 상세

- 연령 × 성별 세그먼트별 인기 도서를 WebGL 링으로 보여 주는 홈
- Elasticsearch(nori) 검색 — 전체 / 제목 / 저자 범위, KDC 분류(대 → 중 → 소) 필터
- 도서 상세에서 비슷한 책(임베딩)과 함께 대출된 책 제공

### 3. 내 서재

- 찜(WISH) · 읽음(READ) 두 상태로 관리
- 완독일 · 별점 · 감상(300자) 기록

### 4. 맞춤 추천

- 콜드스타트 / 개인화 두 모드, 추천마다 이유와 태그 표시
- 관심 태그를 바꿔 추천 기준을 조절하고, 덱 단위로 다시 추천받기

### 5. BOOK DNA

- 서재를 바탕으로 독서 타입, 성향 지표, 장르 레이더, 키워드, 독서 습관 리포트
- **책 가챠** — 추천 후보에서 무작위로 한 권
- **익명 책 이상형 월드컵** — 제목 · 저자 없이 소개문만 보고 16강을 겨루고, 우승한 책만 공개

<br/>

## 기술 스택

### Frontend

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Language | TypeScript | 5.9 |
| Framework | React / React Router | 19.2 / 7 |
| State | TanStack Query / Zustand | 5 / 5 |
| Styling | Tailwind CSS | 4 |
| Graphics · Motion | PixiJS / Motion | 8 / 12 |
| Build · Mock | Vite / MSW | 7.3 / 2 |

### Backend

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Language | Java | 21 |
| Framework | Spring Boot | 3.5.16 |
| ORM · Migration | Spring Data JPA / Flyway | Spring Boot 관리 버전 |
| Auth | Spring Security, OAuth2 Client, JWT(Resource Server) | Spring Boot 관리 버전 |
| API 문서 | springdoc-openapi | 2.9.1 |

### AI

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Language · Framework | Python / FastAPI | 3.12 / 0.115+ |
| Embedding | text-embedding-3-small (GMS) | 1536차원 |
| LLM | gpt-4o-mini (GMS) — 태그 생성, 월드컵 소개문 | |

### Data · Infra

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Database | PostgreSQL | 16.15 |
| Search | Elasticsearch + nori | 8.19.21 |
| Vector DB | Qdrant | 1.18.3 |
| Server | AWS EC2 (Ubuntu 24.04) | |
| Container | Docker / Docker Compose | 27.x / v2 |
| Web Server | Nginx + Let's Encrypt | 1.30 |
| CI/CD | Jenkins (GitLab Webhook) | LTS 2.568.3 |

<br/>

## 시스템 아키텍처

```
Browser ──HTTPS──▶ Nginx (React SPA 정적 파일 + 리버스 프록시)
                     │
                     └─ /api/* ──▶ Spring Boot
                                     ├─ PostgreSQL        회원 · 서재 · 도서 · 추천 기록
                                     ├─ Elasticsearch     도서 검색 (nori)
                                     └─ FastAPI (내부)    추천 · 비슷한 책 · BOOK DNA
                                          └─ Qdrant       도서 · 태그 임베딩

[오프라인 배치]
정보나루 · 카카오 수집 → PostgreSQL 적재 / Elasticsearch 색인
AI CLI → GMS 임베딩 → Qdrant 컬렉션 적재 → alias 교체
```

- Spring Boot 는 인증, 추천 입력(seed · 제외 목록) 결정, 결과 저장을 맡는다.
- FastAPI 는 Qdrant 후보 검색 → 재랭킹(취향 · 태그 · 함께대출 · 대출 추세) → 추천 이유 생성을 맡는다.
- 데이터 출처: 국립중앙도서관(서지), 도서관 정보나루(대출 · 함께대출), 카카오(책소개). 검색 대상 약 98만 권, 추천 후보 약 41만 권.

<br/>

## ERD

Flyway 마이그레이션(`backend/src/main/resources/db/migration`, V1 ~ V12)으로 18개 테이블을 만든다. 관계도는 [MVP ERD](docs/ERD.md), 설계 근거는 [테이블 설계](docs/DB_TABLE_DESIGN.md)에 있다.

| 영역 | 테이블 |
| --- | --- |
| 회원 | users, user_interests, tags, refresh_tokens |
| 도서 | books, book_tags, kdc_codes, book_keywords, book_relations, book_demand_features, book_loaned_top20 |
| 서재 · 행동 | user_library, user_actions |
| 추천 | recommendations, recommendation_items |
| BOOK DNA | user_dna_profiles, book_world_cup_synopses, book_world_cup_sessions |

<br/>

## API 명세

모든 경로는 `/api/v1` 아래에 있고, 인증(`/auth/*`)을 제외하면 Bearer JWT 가 필요하다.

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/auth/oauth/{provider}/authorize` · `/callback` | 카카오 · Google 로그인 |
| `POST` | `/auth/refresh` · `/auth/logout` | 토큰 갱신 · 로그아웃 |
| `GET` | `/users/me` | 내 정보 |
| `POST` | `/users/me/profile` · `/users/me/preferences` | 온보딩 |
| `GET` | `/books/search` | 도서 검색 |
| `GET` | `/books/popular` · `/books/popular-segments` | 인기 도서 |
| `GET` | `/books/{bookId}` · `/similar` · `/co-loans` | 도서 상세 · 비슷한 책 · 함께 대출된 책 |
| `GET` | `/books/random` | 책 가챠 |
| `GET` | `/tags` · `/kdc` | 태그 · KDC 분류 사전 |
| `GET` | `/recommendations` | 맞춤 추천 |
| `POST` | `/recommendations/next` | 다시 추천받기 |
| `GET` | `/library/me` | 내 서재 |
| `POST` · `PATCH` · `DELETE` | `/library` · `/library/{libraryItemId}` | 서재 담기 · 수정 · 빼기 |
| `GET` | `/users/me/dna` | BOOK DNA |
| `POST` | `/users/me/dna/world-cup/sessions` · `/{sessionId}/picks` | 책 이상형 월드컵 |
| `POST` | `/events` | 행동 이벤트 기록 |

> 전체 명세는 [API 명세](docs/API_SPEC.md) 또는 Swagger UI(`http://localhost:8080/swagger-ui.html`)에서 확인

<br/>

## 프로젝트 구조

```
S15P21B102/
├── frontend/   React SPA
├── backend/    Spring Boot API 서버
├── ai/         FastAPI 추천 서버 · 임베딩/태그 배치 CLI
├── database/   원천 데이터 수집 스크립트와 조사 문서
├── deploy/     운영 docker compose, Nginx, Jenkins, 배포 스크립트
├── scripts/ci/ 컴포넌트별 CI 스크립트
├── docs/       기획 · 설계 · 계약 문서
└── Jenkinsfile
```

<br/>

## 실행 방법

### 사전 요구사항

- Node.js `24 LTS`
- JDK `21`
- Python `3.12` (+ `uv`)
- Docker Engine `27.x` 이상

### Backend

```bash
cd backend
docker compose up -d      # PostgreSQL · Elasticsearch
cp .env.example .env      # JWT_SECRET(32바이트 이상) 필수, 로그인은 OAUTH_* 필요
./gradlew bootRun         # http://localhost:8080
```

### AI

```bash
cd ai
uv sync --extra dev
uv run uvicorn recommendation.api:app --port 8000
```

추천 · BOOK DNA 를 쓰려면 `QDRANT_URL`, `AI_INDEX_VERSION` 이 필요하다. 자세한 내용은 [ai/README.md](ai/README.md) 참고.

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env      # VITE_ENABLE_MSW=true 면 백엔드 없이 mock 으로 동작
npm run dev               # http://localhost:5173
```

### 배포

EC2 에서 `deploy/docker-compose.yml` 로 운영하며, `dev` 브랜치에 머지되면 Jenkins 가 빌드 · 배포한다. 자세한 내용은 [deploy/README.md](deploy/README.md) 참고.

<br/>

## 팀원 소개

| 이름 | 역할 | 담당 업무 |
| --- | --- | --- |
| 양금규 | BE | 백엔드, 데이터 수집 · 적재, 설계 문서 |
| 조성진 | BE | 백엔드, 인프라 · 배포 · CI/CD |
| 이어진 | AI | 추천 · BOOK DNA · 임베딩 (FastAPI) |
| 이가영 | FE | 프론트엔드 |
| 장민식 | FE | 프론트엔드 |
| 홍유라 | FE | 프론트엔드 |

<br/>

## 협업 규칙

### 브랜치 전략

| 브랜치 | 용도 |
| --- | --- |
| `dev` | 개발 통합 · 배포 브랜치 |
| `feature/{FE\|BE\|AI\|OPS}-{기능명}` | 기능 개발 |
| `fix/{FE\|BE\|AI\|OPS}-{내용}` | 버그 수정 |

### 커밋 메시지

```
[{태그}] {제목}
```

| 태그 | 의미 |
| --- | --- |
| `Feat` | 새로운 기능 추가 |
| `Fix` | 버그 수정 |
| `Refactor` | 리팩토링 |
| `Style` | UI · 스타일, 코드 포맷팅 |
| `Perf` | 성능 개선 |
| `Docs` | 문서 수정 |
| `Test` | 테스트 코드 |
| `Chore` | 빌드, 설정 변경 |

### 코드 리뷰

- 기능 브랜치에서 `dev` 로 MR 을 올리고, [MR 템플릿](.gitlab/merge_request_templates/Default.md)을 따른다.
- 이슈는 Jira 로 관리한다 (1주 스프린트, [Jira 가이드](jira/jira_guide.md)).
