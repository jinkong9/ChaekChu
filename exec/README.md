# S15P21B102 포팅 산출물

현재 저장소의 구현·설정과 팀에서 전달한 시연 자료를 기준으로 빌드·배포·DB 스키마·시연 방법을 정리한다.

## 파일 목록

| 파일 | 내용 |
| --- | --- |
| [01-porting-manual.md](./01-porting-manual.md) | 시스템 구성, 기준 버전, 로컬 빌드·실행, 운영 배포, 환경 설정, DB·ERD 안내 |
| [02-external-services.md](./02-external-services.md) | 외부 서비스의 용도, 연동 위치, 필요한 계정·권한 |
| [03-database/README.md](./03-database/README.md) | 스키마 파일 범위, 데이터 덤프 링크, PostgreSQL·Qdrant 복원 방법 |
| [03-database/schema-only.sql](./03-database/schema-only.sql) | 백엔드 Flyway V1~V12를 기준으로 재구성한 데이터 행 없는 스키마 |
| [04-demo-scenario.md](./04-demo-scenario.md) | 신규 사용자와 기존 사용자의 약 3분 시연 절차 |

## 기준과 주의

- 운영 데이터 덤프(PostgreSQL 도서 데이터, Qdrant 스냅샷)는 용량 때문에 별도 드라이브에 올렸다. 링크와 복원 방법은 [03-database/README.md](./03-database/README.md)에 있다. `schema-only.sql`은 저장소의 마이그레이션 파일에서 DDL을 모아 만든 스키마 참조본이다.
- 앱 DB를 새로 준비할 때는 애플리케이션이 Flyway 마이그레이션을 적용하도록 한다. `schema-only.sql`을 먼저 적용한 DB에는 Flyway 이력이 없으므로 그대로 앱을 기동하지 않는다.
- DB 스키마 파일에는 도서·사용자·태그 seed 행과 운영 데이터를 넣지 않았다. 검색·추천에 필요한 도서 데이터는 위 데이터 덤프로 복원하며, 덤프에 개인정보는 포함하지 않았다.
- 외부 서비스 문서에는 비밀 자격 정보의 이름이나 값을 싣지 않는다. 실제 배포 값은 저장소 밖의 승인된 비밀 보관 절차로 전달한다.
- 기준 저장소 상태에는 `docs/성진이의 노력.md` 미추적 파일이 있었다. 이 포팅 산출물 작성 과정에서 기존 파일은 변경하지 않았다.
