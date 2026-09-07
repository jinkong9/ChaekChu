# Flyway 마이그레이션

파일명 규칙: `V{번호}__{설명}.sql` (예: `V1__init.sql`). 밑줄 두 개.

- 초안 스키마는 `docs/POSTGRES_SCHEMA.sql` 에 있다. ERD 확정 후 `V1__init.sql` 로 옮긴다.
- 한 번 적용된 파일은 수정하지 않는다. 변경은 새 버전 파일로 추가한다.
- `ddl-auto: validate` 이므로 엔티티와 마이그레이션이 어긋나면 기동 시 실패한다.
