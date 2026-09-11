# MVP ERD (확정 2026-09-07 · 갱신 09-08 서재 2단)

> 프로젝트 S15P21B102 · 테이블별 DDL 과 근거는 `docs/DB_TABLE_DESIGN.md` · 목표 스키마 `docs/POSTGRES_SCHEMA.sql` · ERDCloud `docs/ERDCLOUD_IMPORT.sql`
>
> **적용은 두 단계다.** 프론트 초기 1차 스키마(ERDCloud, 10테이블)를 보정해 **V1** 으로 먼저 가고(`docs/sql/V1__init.sql`), 아래 관계도의 추천 데이터 층은 **V2** 로 그 위에 올린다.
> 1차 이름(`user_library` `user_actions` `book_loaned_top20` `category_code` …)이 기준이다 — 대응표는 `DB_TABLE_DESIGN.md` 머리.
>
> 09-01 의 5테이블 초안을 **16테이블 + 뷰 1** 로 확정했다. 늘어난 것은 추천·상세·홈이 실제로 읽어야 하는 데이터의 자리다
> (소스별 소개문·키워드·벡터·함께대출 관계·월별 수요·세그먼트 인기·KDC 사전·태그 사전). 근처 도서관 기능은 MVP 에서 뺐다.

## 설계 원칙

- **ISBN13 은 논리 키, PK 는 BIGINT.** API 는 `bookId` 를 불투명 문자열로 노출한다.
- **소스별 원문은 행, 화면 대표값은 컬럼.** `book_texts` 에 정보나루·카카오 소개문을 소스별로, `books.description` 에 대표값 하나와 출처.
- **책당 벡터 1개.** 임베딩 입력은 저장하지 않고 조립한다(`STRUCT` 템플릿). 소스별 평균 벡터는 폐기(임베딩 연구 09-07).
  **벡터는 PostgreSQL 에 두지 않는다(09-11 정정).** Qdrant 가 보관·검색한다 — 아래 `BOOK_EMBEDDINGS` 는 설계 시점의 자리이고,
  V2 가 만든 실제 표는 한 번도 쓰이지 않아 **V4 로 제거**했다(`EMBEDDING_QDRANT_OPERATING_PLAN.md` §7.3 이 애초에 만들지 말라고 정해 둔 표다).
- **어휘 색인이 주 추천 신호.** `books` 의 tsvector(제목·저자·출판사·소개) + `book_keywords` 정확 조인 → 밀집 벡터와 역순위 융합.
- **작품 단위 묶기.** `books.work_key`(세트 ISBN → 제목 어간+저자) 로 추천·검색 결과에서 작품당 1권.
- **서비스 DB 에 두지 않는 것**: 도서관 원장 1.4억 행·1,660관(파케이), 수집 원본 JSON(파이프라인), 책별 태그 점수(KDC 파생으로 대체).

## 관계도

```mermaid
erDiagram
    KDC_CODES ||--o{ KDC_CODES : parent
    KDC_CODES ||--o{ BOOKS : classifies
    BOOKS ||--o{ BOOK_TEXTS : has
    BOOKS ||--o{ BOOK_KEYWORDS : has
    BOOKS ||--o| BOOK_EMBEDDINGS : vector
    BOOKS ||--o{ BOOK_RELATIONS : source
    BOOKS o|--o{ BOOK_RELATIONS : target
    BOOKS ||--o{ BOOK_DEMAND_FEATURES : monthly
    BOOKS ||--o{ BOOK_DEMOGRAPHICS : monthly
    BOOKS ||--o{ POPULAR_SEGMENTS : ranked
    TAGS ||--o{ USER_INTERESTS : chosen
    USERS ||--o{ USER_INTERESTS : has
    USERS ||--o{ LIBRARY_ITEMS : owns
    BOOKS ||--o{ LIBRARY_ITEMS : saved_in
    USERS ||--o{ RECOMMENDATIONS : receives
    RECOMMENDATIONS ||--o{ RECOMMENDATION_ITEMS : contains
    BOOKS ||--o{ RECOMMENDATION_ITEMS : recommended
    USERS ||--o{ USER_EVENTS : acts
    RECOMMENDATIONS o|--o{ USER_EVENTS : measured
    BOOKS o|--o{ USER_EVENTS : about

    KDC_CODES {
        varchar code PK
        varchar label
        varchar parent_code FK
        smallint depth
    }
    TAGS {
        varchar code PK
        varchar label UK
        varchar tag_type
        text_array kdc_prefixes
        boolean is_selectable
    }
    BOOKS {
        bigint id PK
        char isbn13 UK
        char set_isbn
        varchar work_key
        varchar title
        text_array authors
        text authors_text
        varchar publisher
        smallint published_year
        varchar kdc FK
        varchar category_path
        char audience_code
        integer page_count
        text cover_image_url
        text description
        varchar description_source
        varchar content_status
        bigint loans_total
        numeric popularity_score
    }
    BOOK_TEXTS {
        bigint id PK
        bigint book_id FK
        varchar source
        varchar text_type
        text content
        char content_hash
        timestamptz updated_at
    }
    BOOK_KEYWORDS {
        bigint book_id PK_FK
        varchar keyword PK
        numeric weight
        smallint rank
    }
    BOOK_EMBEDDINGS {
        bigint book_id PK_FK
        varchar model PK
        smallint dim
        bytea vector_fp16
        char input_hash
        timestamptz built_at
    }
    BOOK_RELATIONS {
        bigint id PK
        bigint source_book_id FK
        bigint target_book_id FK
        char target_isbn13
        varchar relation_type
        smallint rank
    }
    BOOK_DEMAND_FEATURES {
        bigint book_id PK_FK
        char as_of_month PK
        bigint loan_cum
        integer loan_3m
        integer loan_24m
        numeric trending_score
        numeric steady_score
    }
    BOOK_DEMOGRAPHICS {
        bigint book_id PK_FK
        char as_of_month PK
        varchar age_group PK
        char gender PK
        integer loan_count
    }
    POPULAR_SEGMENTS {
        varchar segment_id PK
        date period_start PK
        smallint rank PK
        bigint book_id FK
        integer loan_count
    }
    USERS {
        bigint id PK
        varchar oauth_provider UK
        varchar oauth_subject UK
        varchar nickname
        smallint birth_year
        char gender
        varchar onboarding_status
    }
    USER_INTERESTS {
        bigint user_id PK_FK
        varchar tag_code PK_FK
    }
    LIBRARY_ITEMS {
        bigint id PK
        bigint user_id FK
        bigint book_id FK
        varchar status
        smallint rating
        varchar review_text
        date finished_date
        boolean is_seed
    }
    RECOMMENDATIONS {
        bigint id PK
        bigint user_id FK
        varchar mode
        varchar model_version
        varchar embedding_model
        jsonb weights
        jsonb applied_tags
        smallint based_on_count
        boolean fallback
        timestamptz generated_at
    }
    RECOMMENDATION_ITEMS {
        bigint recommendation_id PK_FK
        bigint book_id PK_FK
        smallint rank
        numeric score
        jsonb feature_scores
        jsonb tags
        varchar reason_type
        varchar reason_text
    }
    USER_EVENTS {
        bigint id PK
        bigint user_id FK
        bigint recommendation_id FK
        bigint book_id FK
        varchar event_type
        smallint rank
        varchar client_event_id
        timestamptz occurred_at
    }
```

## 테이블 역할

| 층 | 테이블 | 역할 | 채우는 주체 |
| --- | --- | --- | --- |
| 사전 | `kdc_codes` | KDC 코드→이름·상위 | 1회 적재 |
| | `tags` | 관심·추천 태그 사전, KDC 접두로 장르 파생 | 1회 적재 |
| 카탈로그 | `books` | ISBN 1행 — 서지·KDC·작품키·대표 소개·표지·인기 | 월 배치 (원장 → usage → 카카오) |
| 콘텐츠 | `book_texts` | 소스별 소개문 원문 (+국중 목차 표시용) | 수집기 |
| | `book_keywords` | 정보나루 키워드·가중치 (1단계 48%) | 수집기 |
| | ~~`book_embeddings`~~ | **폐기(V4, 09-11)** — 벡터는 Qdrant `books_active` 에 있다 | 임베딩 배치 → Qdrant |
| 파생 | `book_relations` | 함께대출·마니아·다독자 (1단계 83%, **주 추천 신호**) | 수집기 |
| | `book_demand_features` | 월별 누적·3개월·24개월·모멘텀 | 월 배치 (원장) |
| | `book_demographics` | 연령·성별 대출 분포 (3.2%) | 수집기 |
| | `popular_segments` | 세그먼트 인기 상위 100 (홈 링·온보딩) | 월 배치 |
| 사용자 | `users` · `user_interests` · `library_items` | OAuth 계정·관심 태그·서재(찜/완독+평점·감상 — `WISH`/`READ` 2단, 09-02) | 서비스 |
| 결과 | `recommendations` · `recommendation_items` · `user_events` · MV | 추천 스냅샷·순위·이유·행동 로그·일별 지표 | 서비스 |

## 주요 제약

- `books.isbn13` UNIQUE, `^(978|979)[0-9]{10}$`. `work_key` NOT NULL.
- `book_texts (book_id, source, text_type)` UNIQUE — 소스별 최신 한 행.
- `book_relations (source_book_id, relation_type, target_isbn13)` UNIQUE. `target_book_id` 는 카탈로그 미적재면 NULL.
- `users (oauth_provider, oauth_subject)` UNIQUE.
- `library_items (user_id, book_id)` UNIQUE. `status` ∈ `WISH`/`READ`(2단, 09-02). `WISH` ⇒ `finished_date IS NULL`; `READ` 는 완독일이 있어도(서재 API) 없어도(온보딩 seed = 서비스 이전에 읽은 책) 된다.
- `recommendation_items (recommendation_id, rank)` UNIQUE, `rank ≥ 1`, `score 0~100`.
- `user_events (user_id, client_event_id)` UNIQUE — 재전송 중복 방지.

## 제외한 것과 이유

| 제외 | 이유 |
| --- | --- |
| `libraries` · `holdings` | 근처 도서관 기능 MVP 배제 (09-07). 원장은 파케이에서 카탈로그·인기 지표의 원천으로만 |
| `book_source_records` · `ingestion_runs` | 원본 JSON 3GB+, 파이프라인 영역 |
| `book_series` · `book_identifiers` · `book_classifications` | `books.work_key` · `set_isbn` · `kdc` 컬럼으로 흡수 |
| `book_tags` | 책 태그는 `tags.kdc_prefixes` 로 KDC 에서 결정적으로 파생 |
| `book_ratings` · `user_seed_books` | `library_items.rating` · `is_seed` 로 통합 |
