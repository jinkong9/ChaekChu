# Flyway 마이그레이션

파일명 규칙: `V{번호}__{설명}.sql` (예: `V1__init.sql`). 밑줄 두 개.

- `V1__init.sql` 은 `docs/sql/V1__init.sql`(1차 ERDCloud 10테이블 + 보정 7건)을 그대로 복사한 것이다. 설계 근거는 `docs/DB_TABLE_DESIGN.md` 머리와 `docs/ERD.md`.
- `V1_1__seed_tags.sql` 은 `tags` seed(온보딩 장르 12개). `docs/sql/` 에 같은 파일을 둔다.
- 한 번 적용된 파일은 수정하지 않는다(Flyway 체크섬). 변경은 새 버전 파일로 추가하고, 설계 문서도 같이 고친다.
  추천 데이터 층(`book_texts` `book_keywords` `book_embeddings` `book_relations` `book_demand_features` `kdc_codes` + `books` 확장)은 V2 로 올린다.
- `V3__events_and_recommendation_snapshot.sql` 은 V1 의 추천·이벤트 세 표를 실제로 쓸 수 있게 고친다 —
  `recommendations.public_id`(응답의 recommendationId), `recommendation_items.ck_ri_reason` 확대(AI 계약값이 하나도 없었다),
  `user_actions` 의 `display_position`·`session_id`·`payload`, `event_type` 에 `DISMISS`·`SEARCH` 추가. `docs/sql/` 에 같은 파일을 둔다.
- `V4__drop_book_embeddings.sql` 은 V2 가 만든 `book_embeddings` 를 지운다. 벡터는 Qdrant 에 있고(09-11 EC2 확인) 이 표를
  읽거나 쓰는 코드가 없었다. 08-31 운영안이 이미 「만들지 않는다」고 정해 둔 표다 — V2 가 그 결정을 모른 채 만들었다.
- `ddl-auto: validate` 이므로 엔티티와 마이그레이션이 어긋나면 기동 시 실패한다.
- `V6__books_volume.sql` 은 `books` 에 `vol`(원장 권차)·`set_isbn`(세트 대표 ISBN)을 더한다. 시리즈는 권마다 제목이 같아
  이 둘이 없으면 「비슷한 책」이 셜록 홈즈 7권을 한 권으로 접는다. 원장에 있던 값을 적재 때 버리고 있었다.
  임베딩에는 영향이 없다 — 임베딩 입력에도 `text_hash` 에도 들어가지 않는다.

  **적용 뒤 백필이 필요하다.** V6 는 컬럼만 만든다. 원장 파케이에서 값을 넣는다:

  ```
  # 1) books_dedup.parquet → CSV (길이 가드: isbn13 13자 · set_isbn 13자 · vol 20자 이하)
  #    원장 「권」에 'littlehorses--littlecows-…' 같은 서지 오류가 8건 섞여 있다
  # 2) \copy 로 stg 에 올린 뒤 books 를 update
  # 3) vacuum (analyze, parallel 0) books;
  ```

  마지막 `parallel 0` 이 중요하다 — 컨테이너 `/dev/shm` 이 기본 64MB 라 병렬 VACUUM 이
  `could not resize shared memory segment` 로 실패한다(compose 에 `shm_size` 를 두지 않았다).

  로컬 실측(09-15): 갱신 693,792행 · 2분 5초 · 표 크기 3,278MB → 3,284MB(**+6MB**).
- `V7__books_series_lookup_index.sql` 은 `(lower(title), publisher) WHERE vol IS NOT NULL` 인덱스 하나다. 「비슷한 책」의 작품 접기가
  권차(`vol`)가 진짜 권차인지 문고 일련번호인지 가리기 위해 «같은 제목·같은 출판사가 한 해에 두 권차 이상을 냈는가» 를 요청마다 묻는다(WorkSeriesRepository).
  로컬 실측 36MB · 49초(vol 있는 693,792행만). **운영에서는 배포 전에 `CREATE INDEX CONCURRENTLY` 로 먼저 만들어 두면** 이 파일은 `IF NOT EXISTS` 로
  즉시 끝난다 — 기동 healthcheck `start_period` 가 60초라 Flyway 가 그 안에 끝나야 한다.
- `V8__user_dna_profiles.sql` 은 Book DNA 프로필 저장 표 하나다(사용자당 1행, JSONB profile). `GET /users/me/dna` 가 서재가 바뀌지 않았으면 AI 를 부르지 않고
  이 행으로 답하고, AI 장애 때는 마지막 프로필을 대신 낸다(BOOK_DNA_API_CONTRACT §5·§6). 빈 표를 만들 뿐이라 즉시 끝난다. `docs/sql/` 에 같은 파일을 둔다.
