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
  global/config/SecurityConfig.java   # 헬스체크·Swagger 만 공개, 나머지 인증 필요
src/main/resources/
  application.yml                     # 환경변수 ${VAR:기본값} 방식. 프로필 파일 없음
  db/migration/                       # Flyway. V1 은 ERD 확정 후 docs/POSTGRES_SCHEMA.sql 에서
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
