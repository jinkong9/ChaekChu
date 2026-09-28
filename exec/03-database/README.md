# DB 스키마 참조 파일

## 파일 범위

`schema-only.sql`은 현재 저장소의 백엔드 Flyway migration V1~V12를 순서대로 검토해 구조 정의를 모은 파일이다.

- 기준 데이터 행, 사용자·서재·추천 데이터는 포함하지 않는다.
- Flyway 관리 테이블과 Flyway 적용 이력은 포함하지 않는다.
- seed migration V1.1은 태그 데이터만 넣으므로 제외했다.
- 기존 행에 대한 migration backfill은 제외했다. 새 빈 데이터베이스에서는 행이 없으므로 스키마 생성에 필요하지 않다.
- 파일은 저장소의 migration으로 재구성했으며, 운영 PostgreSQL 서버에서 `pg_dump`로 직접 만든 덤프가 아니다.

## 새 환경 구성

서비스 데이터베이스는 **schema-only 파일을 먼저 실행하지 말고**, 비어 있는 PostgreSQL 데이터베이스에 Spring Boot를 실행해 Flyway가 V1~V12를 적용하도록 한다. Flyway가 seed tag와 마이그레이션 이력도 관리한다.

`schema-only.sql`은 ERD 검토, 제출용 구조 확인, 별도 빈 데이터베이스에서의 DDL 확인 용도다. 적용할 경우 PostgreSQL 16에서 비어 있는 데이터베이스에만 사용한다. 이 파일로 만든 DB에는 Flyway history가 없으므로 앱 시작용 DB로 그대로 사용하지 않는다.

```bash
createdb -h 127.0.0.1 -p 15432 -U book bookdb_schema_review
psql -h 127.0.0.1 -p 15432 -U book -d bookdb_schema_review -v ON_ERROR_STOP=1 -f schema-only.sql
```

## ERD와 정본

- 실행 가능한 schema change: `backend/src/main/resources/db/migration/V1__init.sql` ~ `V12__refresh_tokens.sql`
- 관계도: `docs/ERD.md`
- 컬럼·인덱스 설계: `docs/DB_TABLE_DESIGN.md`
- 기존 ERDCloud import: `docs/ERDCLOUD_IMPORT.sql` (초기 모델)

migration이 적용된 운영 DB의 데이터 백업은 개인정보·대용량 도서 자료가 포함될 수 있으므로 일반 제출물과 분리해 보호된 보관 위치에서 관리한다.
