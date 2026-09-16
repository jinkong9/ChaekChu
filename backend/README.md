# Backend — 도서 추천 서비스

Java 21 · Spring Boot 3.5.16 · Gradle 8.14.5 · PostgreSQL 16.15 · Elasticsearch 8.19.21 (nori) · Flyway · springdoc 2.9.1

버전 기준과 선택 이유는 [docs/TECH_STACK_AND_VERSIONS.md](../docs/TECH_STACK_AND_VERSIONS.md) 참조.

## 실행

```bash
# 1) JDK 21 을 JAVA_HOME 으로 (Gradle 8.14 는 JDK 25 위에서 안 돈다)
#    IntelliJ 라면 Settings > Build Tools > Gradle > Gradle JVM 을 21 로

# 2) 로컬 인프라 (PostgreSQL + Elasticsearch/nori)
docker compose up -d

# 3) 앱
cp .env.example .env      # Spring 과 compose 가 같은 .env 를 읽는다. 기본값 그대로 써도 된다
./gradlew bootRun
```

| 주소 | 용도 |
| --- | --- |
| http://localhost:8080/swagger-ui.html | API 문서 |
| http://localhost:8080/actuator/health | 헬스체크 (liveness / readiness 하위 경로 포함) |
| http://localhost:9200 | Elasticsearch |
| localhost:5432 (`book` / `book` / `bookdb`) | PostgreSQL. 호스트에 다른 PG 가 있으면 `.env` 의 `POSTGRES_PORT`·`DB_URL` 을 5433 등으로 |

### 추천 서버 연결

운영 Compose에서는 백엔드가 `AI_RECOMMENDATION_URL=http://ai:8000`으로 FastAPI를 호출한다.
프론트는 백엔드의 인증 API만 호출하고, AI 주소를 직접 노출하지 않는다.

```text
GET  /api/v1/recommendations?size=5&tags=소설
     Authorization: Bearer <service-jwt>

backend -> POST http://ai:8000/internal/v1/recommendations
           (userId, seedIsbns, excludeIsbns, tags, weights)
AI 응답 items[].isbn13 -> PostgreSQL books -> items[].book
```

`GET /api/v1/recommendations`는 로그인 사용자만 사용할 수 있다. `tags`가 없으면 온보딩 관심 태그를 사용하고,
서재의 `READ` 도서는 seed, 서재의 모든 도서는 exclude로 전달한다. FastAPI 장애는
`RECOMMENDATION_UNAVAILABLE`로 변환하며, FastAPI가 정상적으로 반환한 `fallback=true`는 오류가 아니다.

### Windows 에서 한글 경로일 때 (예: `C:\workspace\특화\...`)

`./gradlew test` 가 `ClassNotFoundException: ...BackendApplicationTests` 로 실패하면 경로 인코딩 문제다.
Gradle 데몬이 UTF-8 로 쓴 워커 classpath 파일을 `java.exe` 가 MS949 로 읽어서 경로가 깨진다.
`%USERPROFILE%\.gradle\gradle.properties` 에 아래 한 줄을 넣으면 해결된다 (프로젝트 파일이 아니라 개인 설정).

```properties
org.gradle.jvmargs=-Dfile.encoding=MS949 -Xmx1g
```

소스 컴파일 인코딩은 `build.gradle` 에서 UTF-8 로 고정되어 있어 영향이 없다.
영문 경로로 클론했거나 macOS/Linux 면 해당 없음.

### 캠퍼스 네트워크에서 Docker Hub 이미지가 안 받아질 때

Docker Hub 의 CDN(`production.cloudfront.docker.com`) 연결이 리셋되는 네트워크가 있다.
Elasticsearch 는 Elastic 자체 레지스트리를 쓰므로 무관하고, PostgreSQL 만 미러로 받아 태그를 바꿔 준다.

```bash
docker pull mirror.gcr.io/library/postgres:16.15
docker tag mirror.gcr.io/library/postgres:16.15 postgres:16.15
```

## 구조

```
src/main/java/com/ssafy/b102/
  BackendApplication.java
  global/
    config/SecurityConfig.java        # 무상태 JWT(oauth2ResourceServer). 공개: 헬스체크·Swagger·/auth/oauth/*
    config/WebMvcConfig.java          # @CurrentUserId 리졸버
    config/OpenApiConfig.java         # Swagger Bearer 인증 버튼
    error/                            # ErrorCode · ErrorResponse{code,message,details} · BusinessException · GlobalExceptionHandler
    security/                         # 401/403 JSON EntryPoint·Handler · @CurrentUserId
    web/ApiPaths.java                 # "/api/v1" (context-path 를 쓰지 않는 이유는 주석)
  auth/
    jwt/                              # JwtProperties(app.jwt) · JwtConfig(HS256 Nimbus encoder/decoder) · JwtTokenProvider
    oauth/                            # OAuthProperties(app.oauth) · Kakao/GoogleOAuthClient(RestClient) · OAuthStateCookie
    service/OAuthLoginService.java    # 코드 교환 → 사용자 조회·생성 → JWT
    controller/AuthController.java    # GET /auth/oauth/{provider}/authorize · /callback (API_SPEC §2)
  user/
    entity/                           # User · Tag · UserInterest · enum(OAuthProvider, Gender, OnboardingStatus)
    service/UserService · OnboardingService   # 조회·생성 / 프로필·취향(관심 태그 교체, seed 책 → 서재)
    controller/UserController.java    # GET /users/me · POST /users/me/profile · POST /users/me/preferences (API_SPEC §3)
  book/entity/Book.java · repository/    # V1 books 읽기 매핑 (채우는 주체는 배치)
  book/dto/BookSummaryResponse.java      # API_SPEC §1.5 BookSummary — 검색·인기·추천·서재 공통 원소
  book/entity/KdcMainClass.java          # KDC 대분류 10개 → category 라벨("문학"). kdc_codes 는 V2
  book/dto/BookSummaryMapper.java        # PG 행(Book·컬럼) → BookSummary. 빈 — KdcCategoryResolver 를 주입해 검색과 같은 2단계 분류 경로를 낸다
  book/repository/PopularBookRepository  # book_loaned_top20 조회(JdbcClient): 세그먼트 1개 · 합산 재랭킹 · 전 세그먼트 상위 N
  book/service/PopularBookService.java   # §4.2 3단 세그먼트 규칙(연령+성별 / 연령만 합산 / 전체 합산) · §4.3 홈 링 조립
  book/controller/BookPopularController  # GET /books/popular?size= · GET /books/popular-segments (로그인 필요, PENDING 가능)
  book/controller/BookDetailController   # GET /books/{bookId} · /{bookId}/co-loans (§4.4·§4.6). 경로 변수는 \d+ — /search·/popular 와 안 겹친다
  book/service/BookDetailService.java    # id 또는 ISBN13 조회 · metrics 문자열 조립 · my(본인 서재) 조인
  book/service/BookIdentifiers.java      # 「13자리 978/979 면 ISBN13, 아니면 내부 id」 판별 한 곳. 상세와 이벤트가 같은 값을 받는다
  book/service/WorkKey.java              # 「정규화 제목 + 대표 저자」 = 같은 작품 판별. 비슷한 책에서 다른 판본을 접는다(§4.5)
  book/service/BookDemandRankResolver    # 기준월 경계값 5개(1·3·5·10·25%) 캐시 → "상위 N%". 275만 행 등수 세기를 대체
  book/repository/BookDetailRepository   # book_demand_features · book_relations 조회(JdbcClient)
  user/controller/TagController.java     # GET /tags — 태그 사전(§10-0). 프론트 GENRES 하드코딩의 원천
  book/service/KdcCategoryResolver.java  # kdc_codes(V2) 949행을 메모리에 올려 category_code → "문학 > 한국문학" 2단계 경로. refresh() 로 재로드
  library/entity/LibraryItem.java · ShelfStatus(WISH/READ) · LibrarySource(SERVICE/ONBOARDING) · repository/
  search/                                # 도서 검색 (Elasticsearch, API_SPEC §4.1). PG 가 원천, ES 는 읽기 모델
    controller/BookSearchController.java # GET /books/search?q=&page=&size= (로그인 필요). 파라미터 검증 → 400 VALIDATION_FAILED
    service/BookSearchService.java       # ISBN 분기(하이픈 무시 13자리) → ES 조회 → BookSummary 조립. ES 장애 → 503 SEARCH_UNAVAILABLE
    dto/BookSearchResponse.java          # { total, page, size, items: BookSummary[] }
    config/SearchProperties.java         # app.search.* — alias(books) · 물리 인덱스 = 매핑 버전(books_v2) · 기동 시 생성·색인 모드
    config/SearchIndexInitializer.java   # 기동 시 alias 없으면 인덱스 생성(동기) → 새 alias 이거나 alias 가 옛 매핑 인덱스를 가리키면 백그라운드 전체 색인·alias 전환. ES 가 죽어 있어도 기동은 계속
    document/BookDocument.java           # ES 문서 (V1 books 1행 ↔ 1문서). 매핑은 resources/elasticsearch/*.json 이 진실
    repository/BookSearchRepository.java # 검색 읽기 인터페이스 (search / findByIsbn13) + BookSearchResult(total, items)
    repository/ElasticsearchBookSearchRepository.java  # NativeQuery: cross_fields AND(title^3·authors^2·publisher) + ngram phrase + title.keyword×10 · 정렬 _score, id
    service/BookIndexService.java        # 인덱스 생성·alias 전환 · indexAll / indexUpdatedSince(증분, 삭제 미반영) / reindexInto(완전할 때만 alias 이동, 아니면 IncompleteIndexException). 1000건 keyset bulk
    service/BookDocumentMapper.java      # Book 엔티티 → BookDocument
    service/AuthorNameParser.java        # books.author 원문("한강 지음", "지은이: A;그림: B", "A (지은이), B (옮긴이)") → authors 배열. 옮긴이 제외
  recommendation/                         # GET /recommendations → 태그·행동 기반은 FastAPI, 콜드스타트는 인기순위
    controller/RecommendationController.java
    service/RecommendationService.java   # 관심 태그·seed/exclude 구성, 세그먼트 인기 콜드스타트, AI ISBN → BookSummary 결합
    client/AiRecommendationClient.java   # RestClient, timeout, AI 장애 변환
    config/RecommendationProperties.java # app.recommendation.*
    service/RecommendationSnapshotService # 내보낸 덱을 recommendations·items 에 저장(REQUIRES_NEW — 부르는 쪽이 readOnly). 실패해도 응답은 나간다
    repository/RecommendationSnapshotRepository # 덱·항목 쓰기 + public_id → 내부 id (이벤트가 덱을 되찾는 통로)
    service/SimilarBookService.java      # §4.5 비슷한 책 — 기준 책 한 권만 seed 로 넣은 추천. fallback=true 면 버리고 빈 배열
    controller/SimilarBookController.java # GET /books/{bookId}/similar?size= (경로는 /books 아래, 구현이 추천이라 여기 둔다)
  event/                                  # POST /events — 행동 이벤트 수집 (API_SPEC §7). 언제나 202
    controller/EventController.java
    service/EventService.java            # 절대 던지지 않는다. 타입별 필수값·도서 실재·컬럼 폭을 보고 못 채우면 저장하지 않고 버린다
    entity/EventType.java                # 7종 + 타입별 필수 조건(recommendationId / bookId)
    repository/UserActionRepository.java # user_actions INSERT (JdbcClient, 트랜잭션 없음). (user_id, client_event_id) 중복은 ON CONFLICT DO NOTHING
src/main/resources/
  application.yml                     # 환경변수 ${VAR:기본값} 방식. 프로필 파일 없음
  db/migration/V1__init.sql           # Flyway. docs/sql/V1__init.sql 복사본 (1차 10테이블 + 보정 7건). V2 = 추천 데이터 층
  db/migration/V3__events_and_recommendation_snapshot.sql  # recommendations.public_id·index_version · reason_type CHECK 확대 · user_actions 의 display_position·session_id·payload · DISMISS/SEARCH
  elasticsearch/books-settings.json     # analyzer: korean(nori mixed + 품사 필터) · bigram(공백 제거 후 2-gram) · normalizer exact(공백 제거). shards 1 / replicas 0
  elasticsearch/books-mappings.json     # dynamic=strict. title·authors = korean + .ngram(bigram) + .keyword(normalizer exact) · vol(keyword, v6). 바꾸면 app.search.index-name 을 올린다(=매핑 버전)
docker/elasticsearch/Dockerfile       # elasticsearch:8.19.21 + analysis-nori
docker-compose.yml                    # 로컬 인프라만. 앱은 포함하지 않음
Dockerfile                            # 앱 배포 이미지 (multi-stage, temurin 21)
```

패키지는 도메인별로 `com.ssafy.b102.{domain}` 아래 `controller / service / repository / dto / entity` 로 나눈다.
공통(설정·예외·응답 포맷)은 `global` 에 둔다.

## 규칙

- Spring Boot 가 관리하는 라이브러리 버전은 `build.gradle` 에서 덮어쓰지 않는다.
- 스키마 변경은 Flyway 마이그레이션 파일로만 한다. `ddl-auto` 는 `validate` 고정.
- 설정값은 `application.yml` 의 `${ENV:기본값}` 으로 받고, 비밀값은 `.env` 에만 둔다. `.env` 는 커밋하지 않는다.
- API 기본 경로는 `/api/v1`. 응답 시각은 UTC `Instant`, 표시 변환은 프론트에서.
- Swagger 설명은 **한글로, 동작·상태 코드·왜 그런지까지** 적는다(`@Operation` description + `@ApiResponses`). 프론트가 명세 대신 읽는 문서다.
- 인증은 OAuth(카카오·Google)만. 자체 가입·비밀번호 없음. 로컬에서 실제 로그인을 해 보려면 `.env` 에 `JWT_SECRET`·`OAUTH_*`·`FRONTEND_ORIGIN` 을 채운다(`.env.example` 참고).
- 테스트는 실제 PostgreSQL 이 필요하다(CI 는 compose 로 띄움). 로컬은 `deploy/scripts/local-up.sh` 의 PG(15432)를 쓰면 된다:
  `DB_URL=jdbc:postgresql://localhost:15432/bookdb DB_PASSWORD=<deploy/.env.local 값> ES_URIS=http://localhost:19200 ES_USERNAME=elastic ES_PASSWORD=<값> ./gradlew test`
- 한글 경로에서 `./gradlew test` 가 테스트 클래스를 못 찾으면 `"-Dorg.gradle.jvmargs=-Dfile.encoding=MS949 -Xmx1g"` 를 명령에 붙인다(아래 「Windows 에서 한글 경로일 때」).
