# 기술 스택 및 버전 기준

> 도서 추천·개인 서재 서비스의 구현 기준 버전 문서입니다.
>
> 기준일: 2026-08-25
>
> 상태: MVP 개발 기준 확정

## 1. 최종 선정 버전

### Backend

| 구분 | 기술 | 기준 버전 | 적용 기준 |
| --- | --- | --- | --- |
| 언어 | Java | 21 LTS | 백엔드 주 언어 |
| 프레임워크 | Spring Boot | 3.5.16 | Spring Boot 3.5 계열로 고정 |
| 빌드 | Gradle | 8.14.x | `gradle-wrapper`로 팀 전체 동일 버전 사용 |
| ORM | Spring Data JPA / Hibernate | Spring Boot 관리 버전 | 개별 Spring 모듈 버전 직접 지정 금지 |
| 인증·인가 | Spring Security | Spring Boot 관리 버전 | JWT 기반 인증 적용 |
| 관계형 DB | PostgreSQL | 16.15 | 회원, 서재, 평가, 도서 원천 데이터 저장 |
| DB 마이그레이션 | Flyway | 11.x | 운영 DB 스키마 변경 이력 관리 |
| 검색 엔진 | Elasticsearch | 8.18.1 | 도서 검색·유사 도서 조회·검색어 분석 |
| Elasticsearch 연동 | Spring Data Elasticsearch | 5.5.x | Spring Boot 3.5와 호환되는 2025.0 라인 사용 |
| 캐시 | Redis | 7.4.x | 선택 사항. 인기 도서·추천 결과 캐시 용도 |
| API 문서 | springdoc-openapi | 2.8.x | Swagger UI 제공 |

### Frontend

| 구분 | 기술 | 기준 버전 | 적용 기준 |
| --- | --- | --- | --- |
| 실행 환경 | Node.js | 24 LTS | 팀 개발 환경 및 CI의 기준 버전 |
| 패키지 매니저 | npm | 11.x | `package-lock.json`을 커밋해 의존성 고정 |
| 언어 | TypeScript | 5.9.x | 프론트엔드 주 언어 |
| UI 프레임워크 | React | 19.2.x | SPA 기반 화면 구성 |
| 빌드 도구 | Vite | 7.3.x | 빠른 개발 서버 및 프로덕션 번들링 |
| 라우팅 | React Router | 7.x | 페이지 라우팅 및 보호 라우트 구성 |
| 서버 상태 | TanStack Query | 5.x | API 요청·캐시·재검증 관리 |
| 클라이언트 상태 | Zustand | 5.x | 로그인 사용자·UI 상태 등 최소 전역 상태 관리 |
| 스타일 | Tailwind CSS | 4.x | 선택 사항. 공통 디자인 토큰을 먼저 정의한 뒤 적용 |

### Data / Recommendation

| 구분 | 기술 | 기준 버전 | 적용 기준 |
| --- | --- | --- | --- |
| 언어 | Python | 3.12.x | 외부 도서 API 수집·정제·추천 데이터 생성 |
| HTTP 수집 | Requests | 2.32.x | 국립중앙도서관·알라딘·YES24·카카오·정보나루 수집 |
| 데이터 처리 | pandas | 2.2.x | JSONL/CSV 정제 및 중복 도서 통합 |
| 추천 계산 | scikit-learn | 1.6.x | TF-IDF·코사인 유사도 기반 콘텐츠 추천 |
| JSON 처리 | orjson | 3.10.x | 대용량 JSON/JSONL 처리 시 선택 사용 |

### Infra / DevOps

| 구분 | 기술 | 기준 버전 | 적용 기준 |
| --- | --- | --- | --- |
| 컨테이너 | Docker Engine | 27.x 이상 | 로컬·배포 환경 실행 기준 |
| 컨테이너 관리 | Docker Compose | v2.x | PostgreSQL·Elasticsearch·Redis 로컬 구성 |
| 리버스 프록시 | Nginx | 1.27.x | 프론트엔드 정적 파일 및 API 프록시 |
| CI/CD | GitLab CI/CD | GitLab 제공 기능 | 테스트·빌드·이미지 배포 자동화 |
| JDK 배포판 | Eclipse Temurin | 21 | 로컬·CI·컨테이너에서 동일하게 사용 |

## 2. 왜 이 조합을 선택했는가

### Java·Spring Boot

Java 21은 LTS 버전이며, Spring Boot 3.5.16은 Java 17 이상을 요구하므로 Java 21을 사용해 안정적인 장기 지원 기반을 확보한다. Spring Boot가 관리하는 Spring Framework, Spring Security, JPA/Hibernate 버전은 개별적으로 덮어쓰지 않는다.

Spring Boot 4.x도 사용할 수 있지만, 현재 프로젝트는 추천·검색·개인 서재의 핵심 기능을 빠르게 완성하는 것이 우선이다. 따라서 Jakarta 전환과 Spring Framework 7 전환에 따른 초기 마이그레이션 비용을 피하기 위해 Boot 3.5 계열을 선택한다.

참고: [Spring Boot 3.5 System Requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html), [Spring Boot 공식 프로젝트 페이지](https://spring.io/projects/spring-boot/)

### PostgreSQL·Elasticsearch

PostgreSQL은 서비스의 원천 데이터 저장소로 사용한다. 도서·회원·서재·평가·추천 이력처럼 정합성이 중요한 데이터는 PostgreSQL을 기준으로 관리하고, Elasticsearch에는 검색과 추천 조회에 필요한 문서 형태의 읽기 모델을 저장한다.

Spring Data Elasticsearch의 공식 호환표에서 Spring Data 2025.0 라인은 Elasticsearch 8.18.1 및 Spring Framework 6.2.x와 조합된다. 따라서 Spring Boot 3.5와 Elasticsearch 8.18.1을 사용한다. Elasticsearch 9.x는 Spring Data 6.x·Spring Framework 7.x 조합에 해당하므로 이번 기준에서는 선택하지 않는다.

참고: [Spring Data Elasticsearch 버전 호환표](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/versions.html), [PostgreSQL 버전 정책](https://www.postgresql.org/support/versioning/)

### React·Vite·Node.js

React 19.2와 TypeScript를 사용해 타입 안정성을 확보하고, Vite 7.3으로 프론트엔드 빌드와 개발 서버를 구성한다. Vite 7은 Node.js 20.19+ 또는 22.12+를 요구하므로 Node.js 24 LTS를 팀 기준으로 고정한다.

Node.js 24 LTS는 Vite 7의 Node.js 요구사항을 충족하며, 로컬 확인 환경도 Node.js 24.18.0·npm 11.16.0이다. Vite 8은 별도 업그레이드 대상으로 남긴다. MVP 기간 중에는 번들러 변경으로 인한 예기치 않은 플러그인 호환성 문제를 피하고 Vite 7 계열을 유지한다.

참고: [Node.js 릴리스 일정](https://nodejs.org/en/about/previous-releases), [React 19.2](https://react.dev/blog/2025/10/01/react-19-2), [Vite 7](https://vite.dev/blog/announcing-vite7)

## 3. 서비스에서의 역할 분리

```text
외부 도서 API
    │
    ├─ Python 수집·정제 스크립트
    │       ├─ PostgreSQL: 원천 도서·정규화 데이터 저장
    │       └─ Elasticsearch: 검색·추천용 도서 문서 색인
    │
    └─ Spring Boot API
            ├─ PostgreSQL: 회원·서재·평가·추천 이력 CRUD
            ├─ Elasticsearch: 도서 검색·유사 도서 조회
            └─ Redis: 인기 도서·추천 결과 캐시(필요할 때만)
                    │
                    └─ React + TypeScript 웹 클라이언트
```

### 저장 원칙

1. PostgreSQL을 도서와 사용자 데이터의 원천 저장소로 둔다.
2. Elasticsearch는 검색 및 추천 조회 성능을 위한 읽기 모델로 사용한다.
3. Elasticsearch 색인 실패가 PostgreSQL 저장 실패로 이어지지 않도록 수집과 색인을 분리한다.
4. API 응답 DTO에는 외부 API의 원본 필드명을 그대로 노출하지 않고, 프로젝트 공통 도서 모델로 변환한다.
5. 수집 원본은 JSONL로 보관할 수 있지만, 서비스 조회는 PostgreSQL·Elasticsearch의 정규화된 데이터를 사용한다.

## 4. 추천 기능 구현 기준

### MVP 1단계: 콘텐츠 기반 추천

- 입력 데이터: 제목, 저자, 출판사, 주제어, 책소개, 카테고리, 독자 선호 장르
- 처리: 텍스트 정규화 → TF-IDF 벡터화 → 코사인 유사도 계산
- 저장: 도서 검색 필드는 Elasticsearch, 사용자 선호와 추천 이력은 PostgreSQL
- 결과: 사용자가 좋아요·서재 등록·높은 평점을 준 도서와 유사한 도서 추천

### MVP 2단계: 사용자 행동 반영

- 행동별 가중치 예시: 높은 평점 > 서재 등록 > 좋아요 > 상세 조회
- 최근 행동에 더 높은 가중치를 부여한다.
- 이미 읽었거나 서재에 등록한 도서는 기본 추천 결과에서 제외한다.
- 추천 근거를 함께 저장해 `비슷한 장르`, `선호 저자`, `최근 관심 도서`처럼 설명 가능한 결과를 제공한다.

### 이후 확장

사용자·도서·행동 데이터가 충분히 쌓인 뒤 협업 필터링 또는 콘텐츠 기반 결과와의 혼합 추천을 검토한다. 초기부터 Kafka, 별도 ML 서버, 대규모 분산 처리를 도입하지 않고 Spring Scheduler 또는 GitLab CI Scheduled Pipeline으로 정기 추천 계산을 실행한다.

## 5. 의존성 관리 규칙

- Java 버전은 `21`로 고정하고, CI와 Docker 이미지도 Eclipse Temurin 21을 사용한다.
- Spring Boot Starter가 관리하는 Spring·Hibernate·Jackson·Tomcat 버전은 직접 지정하지 않는다.
- Gradle Wrapper를 커밋해 모든 개발자가 같은 Gradle 버전을 사용한다.
- 프론트엔드는 `package-lock.json`을 커밋하고, CI에서는 `npm ci`를 사용한다.
- Python은 `requirements.txt` 또는 `pyproject.toml`에 상한을 포함해 재현 가능한 환경을 만든다.
- Docker 이미지에는 `latest` 태그를 사용하지 않고 위 기준 버전 또는 패치 버전을 명시한다.
- 보안 패치가 필요한 경우에만 같은 메이저·마이너 안에서 패치 버전을 올리고, 메이저 업그레이드는 별도 이슈와 호환성 검증 후 진행한다.

## 6. 환경 기준

| 항목 | 기준 |
| --- | --- |
| 문자 인코딩 | UTF-8 |
| 서비스 표시 시간대 | Asia/Seoul |
| 서버 저장 시간 | UTC 기준 `Instant` 권장 |
| API 기본 경로 | `/api/v1` |
| 로컬 실행 | Docker Compose로 PostgreSQL·Elasticsearch 실행 |
| 필수 환경 변수 | DB 접속 정보, Elasticsearch 접속 정보, JWT Secret, 외부 API Key |

## 7. 구현 순서

1. `backend`에 Java 21·Spring Boot 3.5.16·Gradle 8.14.x 기준 프로젝트를 생성한다.
2. PostgreSQL 스키마와 Flyway 마이그레이션을 먼저 구성한다.
3. Elasticsearch 8.18.1 인덱스 매핑과 도서 검색 API를 구성한다.
4. Python 수집·정제 스크립트의 실행 결과를 공통 도서 모델에 맞춘다.
5. React·TypeScript·Vite 프론트엔드를 생성하고 API 계약에 맞춰 화면을 연결한다.
6. 추천 MVP를 콘텐츠 기반으로 구현한 뒤 사용자 행동 가중치를 추가한다.

## 8. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-08-25 | 프로젝트 기준 기술 스택 및 버전 확정 |
