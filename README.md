# 프로젝트명

> 한 줄 소개 (이 프로젝트가 무엇을 해결하는지)

SSAFY 15기 2학기 관통 프로젝트 · 서울 1캠퍼스 B반 102팀

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
- [개발 일정](docs/PROJECT_SCHEDULE.md)
- [MVP 구현 계획](docs/MVP_IMPLEMENTATION_PLAN.md)
- [백엔드 데이터 계약](docs/BACKEND_DATA_CONTRACT.md)
- [MVP ERD (확정)](docs/ERD.md) · [테이블 설계](docs/DB_TABLE_DESIGN.md) · [실행 DDL](docs/POSTGRES_SCHEMA.sql)
- [ERDCloud Import DDL](docs/ERDCLOUD_IMPORT.sql)
- [백엔드 API 명세](docs/API_SPEC.md)
- [추천 데이터 기반 서비스 방향](docs/RECOMMENDATION_SERVICE_DIRECTION.md)
- [팀원 소개](#팀원-소개)
- [협업 규칙](#협업-규칙)

<br/>

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | |
| 개발 기간 | 2026.MM.DD ~ 2026.MM.DD |
| 팀 구성 | 프론트엔드 N명 / 백엔드 N명 |
| 배포 URL | |

### 기획 배경

<!-- 어떤 문제를 발견했고, 왜 이 서비스가 필요한지 -->

### 타겟 사용자

<!-- 누구를 위한 서비스인지 -->

<br/>

## 주요 기능

### 1. 기능명

- 설명
- 설명

### 2. 기능명

- 설명

### 3. 기능명

- 설명

<br/>

## 기술 스택

> 버전 선택 이유와 호환성 기준은 [기술 스택 및 버전 기준](docs/TECH_STACK_AND_VERSIONS.md)에서 관리합니다.

### Frontend

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Language | TypeScript | 5.9.x |
| Framework | React | 19.2.x |
| State | TanStack Query / Zustand | 5.x / 5.x |
| Styling | Tailwind CSS | 4.x |
| Build | Vite | 7.3.x |

### Backend

| 분류 | 기술 | 버전 |
| --- | --- | --- |
| Language | Java | 21 LTS |
| Framework | Spring Boot | 3.5.16 |
| ORM | Spring Data JPA / Hibernate | Spring Boot 관리 버전 |
| Database | PostgreSQL / Elasticsearch | 16.15 / 8.18.1 |
| Auth | Spring Security + JWT | Spring Boot 관리 버전 |

### Infra / DevOps

| 분류 | 기술 |
| --- | --- |
| CI/CD | GitLab CI/CD |
| Container | Docker Engine 27.x / Compose v2 |
| Server | Eclipse Temurin 21 |
| Web Server | Nginx 1.27.x |

### 협업 도구

| 분류 | 도구 |
| --- | --- |
| 형상 관리 | GitLab |
| 이슈 관리 | Jira |
| 문서 관리 | Notion / Confluence |
| 커뮤니케이션 | Mattermost |
| 디자인 | Figma |

<br/>

## 시스템 아키텍처

```
<!-- 아키텍처 다이어그램 이미지 또는 텍스트 도식 -->
```

<br/>

## ERD

확정 ERD 는 [MVP ERD](docs/ERD.md)(관계도)와 [테이블 설계](docs/DB_TABLE_DESIGN.md)(DDL 과 근거)에 있고, ERDCloud 에서는 [Import용 DDL](docs/ERDCLOUD_IMPORT.sql)을 가져오면 됩니다.

<br/>

## API 명세

| Method | Endpoint | 설명 | 인증 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/` | | |
| `POST` | `/api/v1/` | | |

> 전체 명세는 Swagger UI에서 확인: `http://localhost:8080/swagger-ui/index.html`

<br/>

## 프로젝트 구조

```
S15P21B102/
├── backend/
│   └── src/
├── frontend/
│   └── src/
├── docs/
└── README.md
```

<br/>

## 실행 방법

### 사전 요구사항

- Node.js `24 LTS`
- JDK `21`
- Docker Engine `27.x` 이상

### 환경 변수

`.env` 파일을 프로젝트 루트에 생성합니다.

```bash
# backend/.env
DB_URL=
DB_USERNAME=
DB_PASSWORD=
JWT_SECRET=
```

```bash
# frontend/.env
VITE_API_BASE_URL=
```

### Backend

```bash
cd backend
./gradlew clean build
./gradlew bootRun
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Docker Compose

```bash
docker compose up -d
```

<br/>

## 팀원 소개

| 이름 | 역할 | 담당 업무 | GitLab |
| --- | --- | --- | --- |
| | 팀장 / BE | | |
| | BE | | |
| | BE | | |
| | FE | | |
| | FE | | |
| | FE | | |

<br/>

## 협업 규칙

### 브랜치 전략

| 브랜치 | 용도 |
| --- | --- |
| `master` | 배포 가능한 상태 |
| `develop` | 개발 통합 브랜치 |
| `feature/{Jira-이슈번호}-{기능명}` | 기능 개발 |
| `fix/{Jira-이슈번호}-{내용}` | 버그 수정 |

### 커밋 메시지

```
{태그}: {제목}

{본문 - 필요 시}

{Jira 이슈번호}
```

| 태그 | 의미 |
| --- | --- |
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 |
| `style` | 코드 포맷팅, 세미콜론 누락 등 |
| `docs` | 문서 수정 |
| `test` | 테스트 코드 |
| `chore` | 빌드, 패키지 매니저 설정 등 |

### 코드 리뷰

- MR 생성 후 최소 1명 이상 승인 시 머지
- 리뷰는 24시간 내 응답
