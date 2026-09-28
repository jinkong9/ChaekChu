# DB 스키마와 데이터 덤프

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

## 데이터 덤프 (최신본, 2026-09-28)

덤프 파일은 용량(합계 약 4.5GB)이 커서 저장소 대신 별도 드라이브에 업로드했다.

- **다운로드: https://drive.google.com/drive/folders/1iOcf5eo0C7z-oqrq9O838zkeWrtFFzPp?usp=sharing**

| 파일 | 크기 | 내용 |
| --- | --- | --- |
| `bookdb_data_20260928.sql.gz` | 811MB | PostgreSQL 데이터 전용 덤프 (도서 표 9개) |
| `qdrant_books_d360fbce86932f2d.snapshot` | 3.72GB | Qdrant 도서 임베딩 440,377건 (1536차원, Cosine) |
| `qdrant_tags_d360fbce86932f2d.snapshot` | 300KB | Qdrant 태그 임베딩 20건 |

SHA-256:

```
e5f367b6aaace259718ee2e0b2b15bc0ec08bad9568e82a6f44bc51d148c766b  qdrant_books_d360fbce86932f2d.snapshot
0c76958ea768eac30cec35e8ae0efc8a37994178ca473dd9d0923ad30ffddf67  qdrant_tags_d360fbce86932f2d.snapshot
```

### 포함 범위

PostgreSQL 덤프는 운영 DB에서 `pg_dump --data-only`로 도서 표만 지정해 만들었다. 구조(DDL)는 들어 있지 않으며 Flyway가 만든다.

| 테이블 | 행 수 | 내용 |
| --- | --- | --- |
| books | 3,308,813 | 도서 카탈로그 |
| book_relations | 13,699,166 | 함께 대출된 책 등 도서 간 관계 |
| book_keywords | 8,784,823 | 도서 키워드 |
| book_demand_features | 2,749,303 | 월별 대출 수요 지표 |
| book_tags | 2,023,895 | 도서별 태그 |
| book_loaned_top20 | 1,200 | 연령·성별 인기 도서 |
| kdc_codes | 949 | KDC 분류 |
| tags | 12 | 태그 사전 |
| book_world_cup_synopses | 494 | 책 월드컵 소개문 |

- **개인정보가 있는 표는 데이터를 넣지 않았다.** users, user_interests, user_library, user_actions, recommendations, recommendation_items, user_dna_profiles, book_world_cup_sessions, refresh_tokens 는 Flyway가 만든 빈 표로 남는다.
- `flyway_schema_history` 는 Flyway가 새로 기록하므로 제외했다.
- Qdrant 스냅샷에는 도서 벡터와 도서 정보 payload만 있다.

## PostgreSQL 데이터 복원

`psql` 16.10 이상이 필요하다. 덤프 첫머리의 `\restrict` 명령을 그보다 낮은 버전은 읽지 못한다.

1. 비어 있는 DB에 백엔드를 한 번 기동해 Flyway가 V1~V12를 적용하게 한다. (위 「새 환경 구성」)
2. Flyway seed(V1.1)가 넣은 태그 12건을 비운다. 덤프의 `tags` 와 키가 겹친다.

   ```bash
   docker exec -i b102-postgres psql -U book -d bookdb -c "TRUNCATE tags CASCADE;"
   ```

3. 데이터를 넣는다. 압축을 풀면 수 GB라 몇 분 걸린다.

   ```bash
   gunzip -c bookdb_data_20260928.sql.gz | docker exec -i b102-postgres psql -U book -d bookdb -v ON_ERROR_STOP=1
   ```

   컨테이너가 아닌 PostgreSQL이면 `docker exec -i b102-postgres` 를 빼고 `psql -h <호스트> -p <포트> -U book -d bookdb ...` 로 실행한다.

4. 통계를 갱신하고 건수를 확인한다. `books` 가 `3308813` 이면 정상이다.

   ```bash
   docker exec -i b102-postgres psql -U book -d bookdb -c "ANALYZE;" -c "SELECT count(*) FROM books;"
   ```

5. 검색 색인을 만든다. 검색은 Elasticsearch 에서 하며, 백엔드가 기동할 때 `books` 로 색인한다. 기본값 `SEARCH_INDEX_ON_START=IF_CREATED` 는 색인이 없을 때만 돌기 때문에, 1단계 기동에서 빈 색인이 이미 만들어졌다. `SEARCH_INDEX_ON_START=ALWAYS` 로 한 번 재기동해 전체 색인한 뒤 원래 값으로 되돌린다.

## Qdrant 벡터 복원

Qdrant **v1.18.3** 을 쓴다(스냅샷을 만든 버전). 포트 6333 은 서버 안(127.0.0.1)에서만 열려 있으므로 서버에서 실행한다. API 키는 `deploy/.env` 의 `QDRANT_API_KEY` 다.

1. Qdrant를 기동한다. 운영 compose에서는 `recsys` 프로필에 있다.

   ```bash
   docker compose -f deploy/docker-compose.yml --profile recsys up -d qdrant
   ```

2. 스냅샷을 올려 컬렉션을 복원한다.

   ```bash
   export QDRANT_API_KEY=<API 키>
   curl -X POST "http://localhost:6333/collections/books_d360fbce86932f2d/snapshots/upload?priority=snapshot" \
     -H "api-key: $QDRANT_API_KEY" -F "snapshot=@qdrant_books_d360fbce86932f2d.snapshot"
   curl -X POST "http://localhost:6333/collections/tags_d360fbce86932f2d/snapshots/upload?priority=snapshot" \
     -H "api-key: $QDRANT_API_KEY" -F "snapshot=@qdrant_tags_d360fbce86932f2d.snapshot"
   ```

3. 별칭을 연결한다. AI 서버는 컬렉션 이름이 아니라 별칭으로 조회한다.

   ```bash
   curl -X POST "http://localhost:6333/collections/aliases" -H "api-key: $QDRANT_API_KEY" -H "Content-Type: application/json" \
     -d '{"actions":[{"create_alias":{"collection_name":"books_d360fbce86932f2d","alias_name":"books_active"}},{"create_alias":{"collection_name":"tags_d360fbce86932f2d","alias_name":"tags_active"}}]}'
   ```

4. 확인한다. `points_count` 가 `440377` 이면 정상이다.

   ```bash
   curl -s -H "api-key: $QDRANT_API_KEY" http://localhost:6333/collections/books_active
   ```

5. AI 서버 환경 변수를 맞추고 재기동한다. `AI_INDEX_VERSION` 이 비어 있으면 AI 서버는 빈 결과를 돌려준다. 재기동 뒤 `GET /health` 의 `indexVersion` 이 아래 값과 같은지 확인한다.

   | 변수 | 값 |
   | --- | --- |
   | `QDRANT_URL` | `http://qdrant:6333` |
   | `QDRANT_API_KEY` | Qdrant와 같은 키 |
   | `QDRANT_COLLECTION` | `books_active` |
   | `QDRANT_TAG_COLLECTION` | `tags_active` |
   | `AI_INDEX_VERSION` | `d4l-small-candidates-450k-20260915-034700` |
   | `EMBEDDING_DIMENSION` | `1536` |

추천 결과의 도서 상세는 PostgreSQL `books` 에서 가져오므로 PostgreSQL 데이터를 먼저 복원한다.
