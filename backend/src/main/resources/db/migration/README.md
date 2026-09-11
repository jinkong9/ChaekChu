# Flyway 마이그레이션

파일명 규칙: `V{번호}__{설명}.sql` (예: `V1__init.sql`). 밑줄 두 개.

- `V1__init.sql` 은 `docs/sql/V1__init.sql`(1차 ERDCloud 10테이블 + 보정 7건)을 그대로 복사한 것이다. 설계 근거는 `docs/DB_TABLE_DESIGN.md` 머리와 `docs/ERD.md`.
- `V1_1__seed_tags.sql` 은 `tags` seed(온보딩 장르 12개). `docs/sql/` 에 같은 파일을 둔다.
- 한 번 적용된 파일은 수정하지 않는다(Flyway 체크섬). 변경은 새 버전 파일로 추가하고, 설계 문서도 같이 고친다.
  추천 데이터 층(`book_texts` `book_keywords` `book_embeddings` `book_relations` `book_demand_features` `kdc_codes` + `books` 확장)은 V2 로 올린다.
- `V3__events_and_recommendation_snapshot.sql` 은 V1 의 추천·이벤트 세 표를 실제로 쓸 수 있게 고친다 —
  `recommendations.public_id`(응답의 recommendationId), `recommendation_items.ck_ri_reason` 확대(AI 계약값이 하나도 없었다),
  `user_actions` 의 `display_position`·`session_id`·`payload`, `event_type` 에 `DISMISS`·`SEARCH` 추가. `docs/sql/` 에 같은 파일을 둔다.
- `ddl-auto: validate` 이므로 엔티티와 마이그레이션이 어긋나면 기동 시 실패한다.
