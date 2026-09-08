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
  library/entity/LibraryItem.java · ShelfStatus(WISH/READ) · LibrarySource(SERVICE/ONBOARDING) · repository/
src/main/resources/
  application.yml                     # 환경변수 ${VAR:기본값} 방식. 프로필 파일 없음
  db/migration/V1__init.sql           # Flyway. docs/sql/V1__init.sql 복사본 (1차 10테이블 + 보정 7건). V2 = 추천 데이터 층
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
