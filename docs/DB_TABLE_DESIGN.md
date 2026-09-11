# MVP 테이블 설계 — PostgreSQL 16

> 확정 2026-09-07 · 상위 문서 `docs/ERD.md`(관계도) · `docs/BACKEND_DATA_CONTRACT.md`(필드 규칙) · `docs/API_SPEC.md`(엔드포인트)

## 적용 순서 — 1차 스키마 위에 올린다 (2026-09-07 결정)

프론트 초기 구성 때 ERDCloud 에 그린 **1차 스키마(10테이블)를 V1 으로 그대로 가고**, 이 문서의 확장 테이블을 그 위에 V2 로 올린다.
1차의 테이블·컬럼 이름이 기준이며, 이 문서(및 `POSTGRES_SCHEMA.sql`)의 이름은 V2 작성 시 1차에 맞춰 바꾼다.

| 단계 | 파일 | 내용 |
| --- | --- | --- |
| 원본 | `docs/sql/erdcloud_export_20260907.sql` | ERDCloud export 그대로 (수정 금지) |
| **V1** | **`docs/sql/V1__init.sql`** | 1차 10테이블 + 보정 7건 — 지금 프론트·API 가 깨지는 곳과 UNIQUE·FK·CHECK 만 |
| **V1.1** | **`docs/sql/V1_1__seed_tags.sql`** | `tags` seed — 온보딩 장르 12개(GENRE, 라벨 `#소설` 형태). API_SPEC §3.3 표 |
| **V2** | **`docs/sql/V2__recommendation_layer.sql`** (09-09 적용 — 로컬·EC2, Flyway CLI) | `kdc_codes` `book_keywords` `book_relations` `book_demand_features` `book_embeddings`(표만) + `books` 컬럼 3개(`description_source` `description_kakao` `text_hash`) |
| **V3** | **`docs/sql/V3__events_and_recommendation_snapshot.sql`** (09-11) | 추천 스냅샷을 쓸 수 있게 — `recommendations.public_id`·`index_version`, `recommendation_items.ck_ri_reason` 확대(AI 계약값), `user_actions` 의 `display_position`·`session_id`·`payload` + `DISMISS`·`SEARCH` |
| **V4** | **`docs/sql/V4__drop_book_embeddings.sql`** (09-11) | `book_embeddings` 제거. 벡터는 Qdrant 가 보관한다 — 08-31 운영안 §7.3 이 애초에 만들지 말라고 정해 둔 표를 V2 가 만들었고, 쓰는 코드는 없었다 |

**`book_texts` 는 만들지 않는다 (09-09 결정).** 소개문 소스가 정보나루·카카오 둘뿐이고 필요한 건 「임베딩 입력이 둘을 다 쓴다」는 것뿐이라, 표 대신
`books.description_kakao`(두 번째 소개문) + `description_source` + `text_hash` 로 흡수했다. 소스가 셋이 되면(YES24 목차 등) 그때 표로 분리한다 — §4.1 의 DDL 은 그 시점의 참고안.
`kdc_codes` 는 정보나루 `class_nm`「대 > 중 > 소」에서 파생한다 — 3자리 코드 849개, 코드별 최빈 라벨 점유율 99.9%, 1·2·3자리 451행. 별도 KDC 요목 파일이 필요 없다.
| 참고 | `docs/POSTGRES_SCHEMA.sql` | 이 문서 전체를 한 번에 만든 **목표 스키마**. V1 이 확정된 뒤로는 참고용 |

V1 보정 7건: ① `users.onboarding_status`·`updated_at` ② `users.nickname` NULL 허용 ③ `user_actions.book_id` NULL + `recommendation_id`·`rank`·`occurred_at`·`client_event_id`
④ `recommendations.mode`·`fallback`·`based_on_count`·`weights` ⑤ `recommendation_items.reason_type`·`score NUMERIC` ⑥ UNIQUE·FK·CHECK (export 에 PK 만 있었다) ⑦ 서재 상태 2단(`WISH`/`READ`, 09-02 회의)·`READ` 의 `finished_at` NULL 허용(온보딩 seed, 09-08).

이름 대응: `library_items`↔`user_library` · `user_events`↔`user_actions` · `popular_segments`↔`book_loaned_top20` · `kdc`↔`category_code` · `published_year`↔`pub_year` ·
`cover_image_url`↔`cover_url` · `applied_tags`↔`input_tags` · `model_version`↔`feature_version` · `is_seed`↔`source`. `book_tags` 는 1차에 있으므로 유지(채우는 주체는 미정).

> 아래 본문은 목표 스키마의 근거 서술이다. 컬럼 주석의 `∵` 는 그 선택의 근거다. 근거가 실측이면 출처 문서를 적었다.
>
> 컬럼 주석의 `∵` 는 그 선택의 근거다. 근거가 실측이면 출처 문서를 적었다.

## 0. 한눈에 — 16 테이블 + 뷰 1

```
[사전]     kdc_codes · tags
[카탈로그] books
[콘텐츠]   book_texts · book_keywords · book_embeddings
[파생]     book_relations · book_demand_features · book_demographics · popular_segments
[사용자]   users · user_interests · library_items
[결과]     recommendations · recommendation_items · user_events · (MV) recommendation_daily_metrics
```

**서비스 DB 에 넣지 않는 것**과 이유:

| 제외 | 이유 | 어디에 있나 |
| --- | --- | --- |
| 도서관 원장 `holdings`(1.4억 행) · `libraries`(1,660관) | **근처 도서관 기능 MVP 배제**(09-07). 원장은 카탈로그·인기 지표의 원천으로만 | `project_personal/data4library/*.parquet`, 월 스냅샷 |
| 수집 원본 `book_source_records` · `ingestion_runs` | 원본 JSON 3GB+. 재처리는 파이프라인 영역 | `d4l_usage.jsonl` · `kakao_enriched.jsonl` · EC2 백업 |
| `book_tags`(책별 태그 점수) | MVP 태그는 KDC 대분류에서 파생. 점수·신뢰도가 필요해지면 추가 | `tags.kdc_prefixes` 로 대체 |
| `book_series` · `book_identifiers` · `book_classifications` | 필요한 것은 작품 묶기 키·세트 ISBN·KDC 하나 → `books` 컬럼 3개로 흡수 | `books.work_key` `set_isbn` `kdc` |
| 국중 회수 텍스트의 임베딩 입력 | 보강재로 −0.11%p, 1단계 대체재 대상 25권 | `book_texts` 에 TOC 표시용으로만 |

## 1. 원칙

1. **ISBN13 은 논리 키, PK 는 BIGINT 대리키.** 문자열 PK 를 모든 FK 에 전파하지 않는다. API 는 `bookId` 를 불투명 문자열로 노출한다.
2. **소스별 원문은 행으로, 화면 대표값은 컬럼으로.** 소개문은 `book_texts` 에 소스별 행, `books.description` 에 대표값 하나. 덮어쓰지 않고 `description_source` 로 출처를 남긴다.
3. **JSONB 는 「항상 통째로 읽고 쓰는 고정 키 묶음」에만.** `recommendations.weights` `feature_scores`. 조인·필터·FK 검증이 필요한 것은 행이다 (`user_interests`, `book_relations`).
4. **NULL 은 「모름」, 0 은 「없음」.** `trending_score` NULL(신간) ≠ 0(인기 없음). `rating` NULL(미평가) ≠ 1.
5. **임베딩은 책당 1벡터, 입력은 저장하지 않고 조립한다.** 연구 결론(소스별 평균 폐기). `input_hash` 로 변경분만 재임베딩.
6. **어휘 색인이 주(主) 추천 신호다.** `tsvector` 대상 = 제목·저자·출판사·키워드·소개. 검색용만이 아니다 (`EMBEDDING_STUDY_REPORT.md` §8.4).
7. **작품 단위 묶기가 임베딩보다 먼저다.** `books.work_key` 로 추천·검색 결과에서 작품당 1권.

<br/>

## 2. 사전

### 2.1 `kdc_codes` — KDC 코드 → 이름

```sql
CREATE TABLE kdc_codes (
    code        VARCHAR(10)  NOT NULL,
    -- ∵ 자연키. 외부 표준이고 불변이며 조인이 항상 코드로 일어난다.
    label       VARCHAR(200) NOT NULL,
    parent_code VARCHAR(10),
    -- ∵ NULL = 대분류 10개. "813.62" → "813" → "81" → "8" 를 재귀 CTE 로 만든다.
    depth       SMALLINT     NOT NULL,
    PRIMARY KEY (code),
    CONSTRAINT fk_kdc_parent FOREIGN KEY (parent_code) REFERENCES kdc_codes (code)
);
```

`books.category_path`(「문학 > 한국문학 > 소설」)는 이 표로 만든 비정규화 값이다. 원장 KDC 는 1단계 100% 라 분류 경로도 100% 채워진다.

### 2.2 `tags` — 서비스가 허용하는 태그 사전

```sql
CREATE TABLE tags (
    code          VARCHAR(30)  NOT NULL,
    -- ∵ FICTION · ESSAY · SCIENCE … 불변 코드. users.interest 와 recommendations.applied_tags 가 이 코드를 쓴다.
    label         VARCHAR(50)  NOT NULL,
    -- ∵ "#소설" 형태의 표시명. 프론트 SUGGESTED_TAGS 와 온보딩 GENRES 가 여기로 매핑된다 (API_SPEC §3.3).
    tag_type      VARCHAR(10)  NOT NULL,
    -- ∵ GENRE(장르) / THEME(소재) / SIGNAL(#신간 #지금뜨는 같은 상태) — 계약 §3.1.1
    kdc_prefixes  TEXT[]       NOT NULL DEFAULT '{}',
    -- ∵ 책 → 장르 태그 파생 규칙. 예: FICTION = {'813','823','833','843','853','863','873','883','893'}.
    --   book_tags 테이블을 두지 않고 이 접두 목록으로 books.kdc 에서 계산한다.
    is_selectable BOOLEAN      NOT NULL DEFAULT TRUE,
    -- ∵ 온보딩·기준 조절에서 고를 수 있는 태그인지. SIGNAL 태그는 서버가 붙이고 사용자는 못 고른다.
    sort_order    SMALLINT     NOT NULL DEFAULT 0,
    PRIMARY KEY (code),
    CONSTRAINT uq_tags_label UNIQUE (label),
    CONSTRAINT ck_tags_type CHECK (tag_type IN ('GENRE','THEME','SIGNAL'))
);
```

<br/>

## 3. 카탈로그

### 3.1 `books` — ISBN 1행

원천: 정보나루 원장 최빈값(서지·KDC·`set_isbn`·누적 대출·소장관 수) → 정보나루 usage → 카카오 → 국중 부가기호 순으로 채운다.

```sql
CREATE TABLE books (
    id                 BIGINT       GENERATED BY DEFAULT AS IDENTITY,
    isbn13             CHAR(13)     NOT NULL,
    -- ∵ NOT NULL: 검증된 ISBN13 이 없으면 카탈로그에 올리지 않는다 (계약 §2.1).
    set_isbn           CHAR(13),
    -- ∵ 원장 세트 ISBN(22%). work_key 의 1순위 재료.
    work_key           VARCHAR(300) NOT NULL,
    -- ∵ 작품 묶기 키. set_isbn 이 있으면 'S:'||set_isbn, 없으면 'T:'||정규화 제목 어간||'|'||대표 저자.
    --   같은 작품의 다른 ISBN 이 추천 칸을 두 번 차지하는 문제(연구 §6.5)를 이 키로 막는다.
    --   NOT NULL: 단권은 자기 자신이 작품이다.
    title              VARCHAR(500) NOT NULL,
    subtitle           VARCHAR(500),
    authors            TEXT[]       NOT NULL DEFAULT '{}',
    -- ∵ 역할어(지음·옮김) 를 뗀 저자명 배열. GIN 인덱스로 authors && ARRAY['한강'] 가 인덱스를 탄다.
    --   #같은작가 · SAME_AUTHOR 가 이 연산이다. 옮긴이는 빼고 그림작가는 넣는다(아동서 비중).
    --   서지 3필드만으로 P@10 13.89 — 저자는 어떤 조합에서도 빠지면 안 된다 (연구 §7.2).
    authors_text       TEXT         NOT NULL DEFAULT '',
    -- ∵ 배열을 ' · ' 로 이은 평문. tsvector 와 API authors 조립용. NOT NULL '' 인 이유:
    --   tsvector 는 하나라도 NULL 이면 전체가 NULL 이 되어 그 책이 검색에서 조용히 사라진다.
    publisher          VARCHAR(255),
    published_date     DATE,
    -- ∵ NULL 허용: 실제 출간일을 아는 책이 적다. 발행예정일로 대체하지 않는다.
    published_year     SMALLINT,
    -- ∵ 따로 두는 이유: 원장·정보나루가 연도만 준다. 신간 판정도 연도 단위.
    kdc                VARCHAR(10),
    -- ∵ 원장 1,660개관 최빈값. 정보나루 class_no 와 20% 불일치 — 원장이 정본 (연구 §4.4).
    category_path      VARCHAR(200),
    -- ∵ kdc_codes 재귀로 만든 "문학 > 한국문학 > 소설". 화면·서재 선반·API category 가 읽는 비정규화 값.
    audience_code      CHAR(1),
    -- ∵ 국중 부가기호 [0] 독자대상 (0 교양 · 1 실용 · 4 청소년 · 7 아동 …). 1단계 73%.
    --   함께대출 쌍의 88% 가 같은 코드지만 재정렬 키로는 소개문 없는 책에서만 +1.4%p (연구 §7.4).
    --   UI 필터와 「텍스트 결측 책 재정렬」에만 쓴다.
    form_code          CHAR(1),
    is_ebook           BOOLEAN      NOT NULL DEFAULT FALSE,
    page_count         INTEGER,
    cover_image_url    TEXT,
    -- ∵ 가장 큰 변형(알라딘 cover500 등)을 저장. 축소는 프론트 lib/coverUrl.ts 가 한다.
    description        TEXT,
    description_source VARCHAR(20),
    -- ∵ 대표 소개문 하나. 정보나루 desc(86.7%) → 카카오 contents(68%) → **SIBLING**(같은 세트 형제 권의 소개) 순. 원문은 book_texts 에 소스별로.
    --   SIBLING: 소개 없는 책의 정체가 서점 비유통 전집 낱권이라(연구 §3.3), 제목 어간+출판사가 같은 형제 권에 소개가 있으면 빌려온다.
    --   1단계 소개 없음 41,541권 중 6,649권(16%) 회복. 비용 0.
    --   NULL = 둘 다 없음. 빈 문자열로 두지 않는다 — content_status 판정이 흐려진다.
    content_status     VARCHAR(15)  NOT NULL DEFAULT 'PENDING',
    -- ∵ PENDING / TEXT_RICH / TEXT_SHORT / TEXT_NONE. PENDING 이 필요한 이유: "아직 안 긁음"과
    --   "긁었는데 없음"을 섞으면 쿼터 소진을 결측으로 기록했던 사고(19,472건)와 같은 구조가 된다.
    loans_total        BIGINT,
    -- ∵ 원장 누적 대출 합. 후보 필터·prior 전용. 랭킹 주신호 금지 (결정 3).
    holder_libs        INTEGER,
    -- ∵ 소장관 수. 보조 인기 신호.
    popularity_score   NUMERIC(5,2),
    -- ∵ 0~100. book_demand_features 최신월에서 배치가 계산해 비정규화. 검색 정렬 2순위.
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT uq_books_isbn13 UNIQUE (isbn13),
    CONSTRAINT ck_books_isbn13 CHECK (isbn13 ~ '^(978|979)[0-9]{10}$'),
    -- ∵ 한국 상품 EAN(8809 접두 교구·세트)이 원장의 ISBN 자리에 섞여 있었다.
    CONSTRAINT ck_books_content_status CHECK (content_status IN ('PENDING','TEXT_RICH','TEXT_SHORT','TEXT_NONE')),
    CONSTRAINT ck_books_page_count CHECK (page_count IS NULL OR page_count > 0),
    CONSTRAINT ck_books_popularity CHECK (popularity_score IS NULL OR popularity_score BETWEEN 0 AND 100),
    CONSTRAINT fk_books_kdc FOREIGN KEY (kdc) REFERENCES kdc_codes (code)
);
CREATE INDEX idx_books_work_key    ON books (work_key);
CREATE INDEX idx_books_authors_gin ON books USING GIN (authors);
CREATE INDEX idx_books_kdc         ON books (kdc);
CREATE INDEX idx_books_year        ON books (published_year);
CREATE INDEX idx_books_popularity  ON books (popularity_score DESC NULLS LAST);
CREATE INDEX idx_books_lexical     ON books USING GIN (
    to_tsvector('simple', title || ' ' || authors_text || ' ' || coalesce(publisher, '') || ' ' || coalesce(description, ''))
);
-- ∵ 어휘 색인. 검색뿐 아니라 추천의 어휘 후보 생성(상위 50)에 쓴다 — 연구 §8.4.
--   'simple' 사전인 이유: 한국어 형태소 사전이 기본 PostgreSQL 에 없다. 어절 단위 + 키워드 정확 일치로 시작하고,
--   PGroonga/pg_bigm 채택 시 이 인덱스만 교체한다 (SEARCH_INDEX_COMPARISON.md). 키워드는 book_keywords 에서 조인.
```

<br/>

## 4. 콘텐츠

### 4.1 `book_texts` — 소스별 소개문 원문

```sql
CREATE TABLE book_texts (
    id           BIGINT      GENERATED BY DEFAULT AS IDENTITY,
    book_id      BIGINT      NOT NULL,
    source       VARCHAR(20) NOT NULL,
    -- ∵ DATA4LIBRARY(desc) / KAKAO(contents) / NATIONAL_LIBRARY(목차 표시용만).
    text_type    VARCHAR(15) NOT NULL,
    -- ∵ DESCRIPTION / CONTENTS / TOC. 국중 소개·요약은 넣지 않는다 (임베딩에 해롭고 대체재 대상 25권).
    content      TEXT        NOT NULL,
    -- ∵ NOT NULL: 텍스트가 없으면 행을 만들지 않는다. 결측은 행 부재.
    char_count   INTEGER     NOT NULL,
    is_truncated BOOLEAN     NOT NULL DEFAULT FALSE,
    -- ∵ 카카오는 250자 하드캡에서 문장 중간에 잘린다. 임베딩 조립 시 마지막 미완 문장을 버릴지 판단하는 재료.
    content_hash CHAR(64)    NOT NULL,
    -- ∵ SHA-256. 재수집 시 같은 내용이면 updated_at 을 건드리지 않는다 → 재임베딩 대상에서 빠진다.
    collected_at TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT uq_bt_book_source_type UNIQUE (book_id, source, text_type),
    -- ∵ 소스별 최신 한 행. 이력은 두지 않는다.
    CONSTRAINT ck_bt_source CHECK (source IN ('DATA4LIBRARY','KAKAO','NATIONAL_LIBRARY')),
    CONSTRAINT ck_bt_type   CHECK (text_type IN ('DESCRIPTION','CONTENTS','TOC')),
    CONSTRAINT fk_bt_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX idx_bt_updated ON book_texts (updated_at);
-- ∵ "어제 이후 갱신된 텍스트" → 재임베딩 대상 추출.
```

소스별 행을 유지하는 이유 두 가지(ERD v2 §5.2): 두 소개문의 단어 자카드 중앙값 0.147 로 실제로 다른 내용이고, 갱신 단위가 소스별이다.
「소스별 평균 임베딩」은 폐기됐지만 이 두 이유는 남는다. 임베딩 배치가 조회 시 `STRUCT` 템플릿에 두 소개문을 이어 붙인다.

### 4.2 `book_keywords` — 정보나루 키워드

```sql
CREATE TABLE book_keywords (
    book_id BIGINT       NOT NULL,
    keyword VARCHAR(100) NOT NULL,
    weight  NUMERIC(8,2),
    rank    SMALLINT     NOT NULL,
    -- ∵ API 가 준 순서(가중치 내림차순 99.4%). 50개 전부 저장한다 — 어휘 색인은 50개까지 단조 증가(+0.74%p).
    --   밀집 임베딩 입력은 상위 30개(20~30 에서 포화, 50 vs 30 은 잡음). 결측은 채우지 않는다 — 소개문에서 뽑은 키워드는 −0.25%p (연구 §6.6).
    PRIMARY KEY (book_id, keyword),
    CONSTRAINT fk_bk_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX idx_bk_keyword ON book_keywords (keyword);
-- ∵ 어휘 후보 생성에서 "같은 키워드를 가진 책" 조인. TF-IDF 가 이긴 이유의 절반이 키워드 정확 겹침이다.
```

텍스트가 아니라 **단어·가중치 쌍**이라 `book_texts` 와 분리한다. 가장 무거운 텍스트 신호(빼면 −0.73%p)지만 1단계 48% 에만 있다 — 없는 책은 행이 없다.
사용자에게 `#태그` 로 노출하지 않는다: 통제 어휘가 아니고 저자명·출판사명이 섞여 있다.

### 4.3 `book_embeddings` — 책당 벡터 1개

```sql
CREATE TABLE book_embeddings (
    book_id       BIGINT       NOT NULL,
    model         VARCHAR(50)  NOT NULL,
    -- ∵ 'multilingual-e5-large' (연구 §5). 모델을 바꾸면 행이 새로 생기고 옛 행은 지운다.
    dim           SMALLINT     NOT NULL,
    vector_fp16   BYTEA        NOT NULL,
    -- ∵ 1024 × 2바이트 = 2KB. PostgreSQL 은 정본 저장소이고, 유사도 탐색은 Elasticsearch dense_vector(기술 스택)가 한다.
    --   pgvector 로 가려면 이 컬럼만 vector(1024) 로 바꾸면 된다 — 확장 의존을 MVP 에 넣지 않으려는 선택.
    input_hash    CHAR(64)     NOT NULL,
    -- ∵ STRUCT 입력 텍스트의 SHA-256. 원천(제목·저자·분류·키워드·소개)이 바뀐 책만 재임베딩.
    --   입력 텍스트 자체는 저장하지 않는다 — books·book_keywords·book_texts 에서 언제든 다시 조립된다.
    built_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (book_id, model),
    CONSTRAINT fk_be_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
```

입력 조립 규칙(연구 §6 `STRUCT`):
```
제목: {title}
저자: {authors_text}
분류: {category_path}
키워드: {book_keywords 상위 30, 없으면 빈 줄}
소개: {book_texts DATA4LIBRARY.DESCRIPTION} {book_texts KAKAO.CONTENTS}
```
창 512 토큰 · fp16 · 정규화. 1단계 34만 권 61분(RTX 4070). 월 원장 갱신 뒤 `input_hash` 가 달라진 책만.

<br/>

## 5. 파생 — 배치가 만들고 버전을 단다

### 5.1 `book_relations` — 정보나루 함께대출·마니아·다독자

```sql
CREATE TABLE book_relations (
    id             BIGINT      GENERATED BY DEFAULT AS IDENTITY,
    source_book_id BIGINT      NOT NULL,
    target_book_id BIGINT,
    -- ∵ NULL 허용이 필수. 정답의 3~17% 가 아직 카탈로그에 없다(1단계 밖). ISBN 을 먼저 보존하고 적재되면 연결한다.
    target_isbn13  CHAR(13)    NOT NULL,
    relation_type  VARCHAR(12) NOT NULL,
    -- ∵ CO_LOAN / MANIA_REC / READER_REC. 성격이 다르다 — 함께대출은 인기 편향(상위 1% 책 25.7%),
    --   마니아는 취향 신호(3.9%) (연구 §4.3). 화면 「함께 대출된 책」은 CO_LOAN 만.
    rank           SMALLINT    NOT NULL,
    collected_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_br UNIQUE (source_book_id, relation_type, target_isbn13),
    CONSTRAINT ck_br_type CHECK (relation_type IN ('CO_LOAN','MANIA_REC','READER_REC')),
    CONSTRAINT fk_br_src FOREIGN KEY (source_book_id) REFERENCES books (id) ON DELETE CASCADE,
    CONSTRAINT fk_br_tgt FOREIGN KEY (target_book_id) REFERENCES books (id)
);
CREATE INDEX idx_br_src_type    ON book_relations (source_book_id, relation_type, rank);
CREATE INDEX idx_br_unlinked    ON book_relations (target_isbn13) WHERE target_book_id IS NULL;
-- ∵ 새 책이 적재될 때 연결할 관계를 찾는다.
```

**1단계 83% 의 주 추천 신호**다. 임베딩은 이것이 없는 17% 와 2·3단계용. 방향이 있다(대칭 30%)라 `(source → target)` 그대로 두고 역방향을 만들지 않는다.

### 5.2 `book_demand_features` — 월별 수요 지표

```sql
CREATE TABLE book_demand_features (
    book_id         BIGINT      NOT NULL,
    as_of_month     CHAR(7)     NOT NULL,
    -- ∵ 'YYYY-MM'. PK 에 넣는 이유: 랭킹이 "직전 2년 차분 + 4 × 3개월 모멘텀"(결정 3). 덮어쓰면 차분이 불가능하다.
    loan_cum        BIGINT,
    loan_3m         INTEGER,
    loan_24m        INTEGER,
    -- ∵ NULL 허용: 관측 기간이 짧은 책은 차분이 불가능하다.
    trending_score  NUMERIC(5,2),
    steady_score    NUMERIC(5,2),
    -- ∵ NULL = 신간·관측 부족. 0 = 인기 없음. 원시 증감이 아니라 동시기 상대화 값 (전체 대출량이 감소 추세).
    holder_libs     INTEGER,
    feature_version VARCHAR(20) NOT NULL,
    PRIMARY KEY (book_id, as_of_month),
    CONSTRAINT fk_bdf_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX idx_bdf_month_trending ON book_demand_features (as_of_month, trending_score DESC NULLS LAST);
```

원장 1.4억 행은 파케이에 두고 월 배치가 여기에 ISBN 단위 파생값만 넣는다. `books.popularity_score` 는 최신월 행에서 계산한 캐시.
API `metrics[]`(「전국 대출 순위」「누적 대출」)의 원천.

### 5.3 `book_demographics` — 연령·성별 대출 분포

```sql
CREATE TABLE book_demographics (
    book_id     BIGINT      NOT NULL,
    as_of_month CHAR(7)     NOT NULL,
    age_group   VARCHAR(10) NOT NULL,
    -- ∵ '10' '20' … '50+'
    gender      CHAR(1)     NOT NULL,
    -- ∵ 'F' / 'M' / 'A'(합계)
    loan_count  INTEGER     NOT NULL,
    PRIMARY KEY (book_id, as_of_month, age_group, gender),
    CONSTRAINT fk_bdg_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
```

정보나루 `loanGrps` 는 1단계 3.2% 에만 있다. `books` 에 JSONB 로 넣으면 97% 가 빈 값이라 별도 표. 상세 화면 `loanByAge` 에만 쓴다.

### 5.4 `popular_segments` — 세그먼트 인기 (홈 링 · 온보딩 그리드)

```sql
CREATE TABLE popular_segments (
    segment_id   VARCHAR(10) NOT NULL,
    -- ∵ '20_F' 처럼 연령대_성별. 10·20·30·40·50+ × F/M = 10개. 전체는 'ALL'.
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,
    rank         SMALLINT    NOT NULL,
    book_id      BIGINT      NOT NULL,
    loan_count   INTEGER     NOT NULL,
    PRIMARY KEY (segment_id, period_start, rank),
    CONSTRAINT fk_ps_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX idx_ps_book ON popular_segments (book_id);
```

프론트 `public/data/popular-ring.json`(10세그먼트 × 20권, 3개월 창)을 API 로 바꾸는 `GET /books/popular-segments` 와 온보딩의 `GET /books/popular` 가 읽는다. 월 배치가 채우고 직전 기간은 남긴다(비교용). 각 세그먼트 상위 100 까지 저장.

<br/>

## 6. 사용자

### 6.1 `users`

```sql
CREATE TABLE users (
    id                BIGINT       GENERATED BY DEFAULT AS IDENTITY,
    oauth_provider    VARCHAR(10)  NOT NULL,
    oauth_subject     VARCHAR(255) NOT NULL,
    nickname          VARCHAR(20),
    -- ∵ 2~20자 (API_SPEC §3.2). OAuth 직후 NULL, 온보딩 0단계에서 채움.
    birth_year        SMALLINT,
    -- ∵ 연도만. 세그먼트(연령대) 계산에 연도만 필요하고 개인정보는 최소로.
    gender            CHAR(1),
    -- ∵ NULL = 응답 안 함 (온보딩에 그 선택지가 있다).
    onboarding_status VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
    -- ∵ PENDING / COMPLETED / SKIPPED. "완료했는데 비었음"(COMPLETED)과 "건너뜀"(SKIPPED)이 다르다.
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT uq_users_oauth UNIQUE (oauth_provider, oauth_subject),
    CONSTRAINT ck_users_provider CHECK (oauth_provider IN ('KAKAO','GOOGLE')),
    CONSTRAINT ck_users_gender CHECK (gender IS NULL OR gender IN ('F','M')),
    CONSTRAINT ck_users_onboarding CHECK (onboarding_status IN ('PENDING','COMPLETED','SKIPPED')),
    CONSTRAINT ck_users_birth_year CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100)
);
```

OAuth access token·이메일·비밀번호는 저장하지 않는다. 서비스 JWT 는 무상태(`sub = users.id`).

### 6.2 `user_interests` — 관심 태그

```sql
CREATE TABLE user_interests (
    user_id    BIGINT      NOT NULL,
    tag_code   VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tag_code),
    CONSTRAINT fk_ui_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ui_tag  FOREIGN KEY (tag_code) REFERENCES tags (code)
);
```

이전 ERD 의 `users.interest_tags JSONB` 를 행으로 바꿨다. FK 가 있어야 없는 태그 코드가 저장되지 않고, 「이 태그를 고른 사용자」집계가 인덱스를 탄다. 최대 5개는 애플리케이션이 막는다.

### 6.3 `library_items` — 서재 (찜·완독 + 평점·감상)

```sql
CREATE TABLE library_items (
    id            BIGINT       GENERATED BY DEFAULT AS IDENTITY,
    -- ∵ 대리키: 프론트가 PATCH /library/{libraryItemId} 로 호출한다. 복합키를 URL 에 노출하지 않는다.
    user_id       BIGINT       NOT NULL,
    book_id       BIGINT       NOT NULL,
    status        VARCHAR(10)  NOT NULL,
    -- ∵ WISH / READ — 09-02 회의에서 2단 확정(「읽는 중」폐기). 좋아요는 별도 표가 아니라 status = WISH.
    rating        SMALLINT,
    -- ∵ NULL = 미평가. 상태와 무관하게 둘 수 있다(찜만 하고 별점 주기 가능).
    review_text   VARCHAR(300),
    -- ∵ 본인 기록 전용. 추천·검색·임베딩에 쓰지 않는다. 공백만이면 NULL.
    finished_date DATE,
    -- ∵ READ 일 때만. 서재 API 로 READ 가 되면 서버가 오늘로 채운다. 온보딩 seed 는 READ 인데 NULL(서비스 이전에 읽은 책) — 프론트가 연표·통계에서 뺀다.
    is_seed       BOOLEAN      NOT NULL DEFAULT FALSE,
    -- ∵ 온보딩에서 고른 책(POST /users/me/preferences books[]). 콜드스타트 prior 와 이후 평점을 구분.
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT uq_li_user_book UNIQUE (user_id, book_id),
    CONSTRAINT ck_li_status CHECK (status IN ('WISH','READ')),
    CONSTRAINT ck_li_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT ck_li_review CHECK (review_text IS NULL OR btrim(review_text) <> ''),
    CONSTRAINT ck_li_finished CHECK (status = 'READ' OR finished_date IS NULL),
    -- ∵ WISH 면 완독일 없음. READ 는 있어도(서재 API) 없어도(온보딩 seed) 된다
    CONSTRAINT fk_li_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_li_book FOREIGN KEY (book_id) REFERENCES books (id)
);
CREATE INDEX idx_li_user_status ON library_items (user_id, status, updated_at DESC);
CREATE INDEX idx_li_user_read   ON library_items (user_id, finished_date DESC) WHERE status = 'READ';
-- ∵ BOOK DNA(GET /users/me/dna) 와 완독 연표가 완독일 역순으로 읽는다.
```

<br/>

## 7. 결과

### 7.1 `recommendations` — 추천 스냅샷

```sql
CREATE TABLE recommendations (
    id                BIGINT      GENERATED BY DEFAULT AS IDENTITY,
    user_id           BIGINT      NOT NULL,
    -- ∵ NOT NULL: 비회원 추천은 없다 (08-31 결정).
    mode              VARCHAR(15) NOT NULL,
    model_version     VARCHAR(50) NOT NULL,
    embedding_model   VARCHAR(50),
    -- ∵ NULL 허용: 콜드스타트는 임베딩을 쓰지 않을 수 있다. 재현을 위해 남긴다.
    weights           JSONB       NOT NULL,
    -- ∵ JSONB 가 맞는 자리: 키가 taste/coLoan/trending/steady/newField 5개로 고정이고 항상 통째로 읽고 쓴다.
    applied_tags      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- ∵ tags.code 배열. GET /recommendations?tags= 로 사용자가 바꾸면 새 스냅샷.
    based_on_count    SMALLINT    NOT NULL DEFAULT 0,
    -- ∵ "최근 기록한 N권을 보고 골랐어요".
    fallback          BOOLEAN     NOT NULL DEFAULT FALSE,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT ck_rec_mode CHECK (mode IN ('COLD_START','PERSONALIZED')),
    CONSTRAINT ck_rec_weights CHECK (jsonb_typeof(weights) = 'object'),
    CONSTRAINT ck_rec_tags CHECK (jsonb_typeof(applied_tags) = 'array'),
    CONSTRAINT fk_rec_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_rec_user_gen ON recommendations (user_id, generated_at DESC);
```

새로 계산된 성공 결과만 저장한다. 같은 스냅샷을 돌려주는 조회마다 행을 만들지 않는다. Redis 캐시는 선택이고 이 표를 대체하지 않는다.

### 7.2 `recommendation_items`

```sql
CREATE TABLE recommendation_items (
    recommendation_id BIGINT       NOT NULL,
    book_id           BIGINT       NOT NULL,
    rank              SMALLINT     NOT NULL,
    score             NUMERIC(5,2) NOT NULL,
    feature_scores    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- ∵ { taste: 88, coLoan: null, … }. NULL 인 요인은 계산에서 제외됐다는 뜻 — 0 과 다르다.
    tags              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- ∵ 카드에 표시할 태그 라벨 배열 ("#소설", "#내취향근접").
    reason_type       VARCHAR(20)  NOT NULL,
    reason_text       VARCHAR(500) NOT NULL,
    -- ∵ NOT NULL: 카드에 이유를 항상 표시하는 것이 MVP 완료 조건.
    PRIMARY KEY (recommendation_id, book_id),
    CONSTRAINT uq_ri_rank UNIQUE (recommendation_id, rank),
    CONSTRAINT ck_ri_rank CHECK (rank >= 1),
    CONSTRAINT ck_ri_score CHECK (score BETWEEN 0 AND 100),
    CONSTRAINT ck_ri_reason CHECK (reason_type IN
        ('SAME_AUTHOR','SAME_CATEGORY','TEXT_SIMILARITY','SEGMENT_POPULAR',
         'DEMAND_POPULAR','MOMENTUM','NEW_BOOK','INITIAL_PREFERENCE')),
    CONSTRAINT fk_ri_rec  FOREIGN KEY (recommendation_id) REFERENCES recommendations (id) ON DELETE CASCADE,
    CONSTRAINT fk_ri_book FOREIGN KEY (book_id) REFERENCES books (id)
);
```

### 7.3 `user_events` — 행동 로그

```sql
CREATE TABLE user_events (
    id                BIGINT      GENERATED BY DEFAULT AS IDENTITY,
    user_id           BIGINT      NOT NULL,
    recommendation_id BIGINT,
    -- ∵ NULL 허용: BOOK_VIEW 는 검색을 거쳐 올 수 있다.
    book_id           BIGINT,
    -- ∵ NULL 허용: IMPRESSION 은 덱 단위(recommendationId 만).
    event_type        VARCHAR(15) NOT NULL,
    rank              SMALLINT,
    client_event_id   VARCHAR(64),
    occurred_at       TIMESTAMPTZ NOT NULL,
    -- ∵ 클라이언트 발생 시각. created_at(서버 수신)과 나눠 시계 오차·지연 전송을 구분.
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT uq_ue_client UNIQUE (user_id, client_event_id),
    -- ∵ 재전송 중복 방지. NULL 은 UNIQUE 에서 서로 다르게 취급되므로 client_event_id 없는 행은 막지 않는다.
    CONSTRAINT ck_ue_type CHECK (event_type IN ('IMPRESSION','CLICK','REASON_VIEW','BOOK_VIEW','WISH')),
    CONSTRAINT fk_ue_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ue_rec  FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_ue_book FOREIGN KEY (book_id) REFERENCES books (id)
);
CREATE INDEX idx_ue_occurred  ON user_events (occurred_at);
CREATE INDEX idx_ue_rec_type  ON user_events (recommendation_id, event_type) WHERE recommendation_id IS NOT NULL;
CREATE INDEX idx_ue_user_book ON user_events (user_id, book_id, occurred_at DESC) WHERE book_id IS NOT NULL;
-- ∵ 마지막 인덱스는 개인화 입력용. BOOK_VIEW 는 낮은 가중치 + 최근성·중복 감쇠라 사용자별 도서별 최근 조회를 본다.
```

파티셔닝은 하지 않는다. 선언적 파티셔닝은 UNIQUE 에 파티션 키를 요구해 `(user_id, client_event_id)` 전역 UNIQUE 를 걸 수 없다. 베타 규모(수십만 행)에서는 불필요.

### 7.4 `recommendation_daily_metrics` — 발표·운영 지표 (MV)

```sql
CREATE MATERIALIZED VIEW recommendation_daily_metrics AS
SELECT
    date_trunc('day', e.occurred_at)::date               AS day,
    r.mode,
    r.fallback,
    count(*) FILTER (WHERE e.event_type = 'IMPRESSION')  AS impressions,
    count(*) FILTER (WHERE e.event_type = 'CLICK')       AS clicks,
    count(*) FILTER (WHERE e.event_type = 'WISH')        AS wishes,
    count(*) FILTER (WHERE e.event_type = 'REASON_VIEW') AS reason_views,
    count(DISTINCT e.user_id)                            AS users
FROM user_events e
JOIN recommendations r ON r.id = e.recommendation_id
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX idx_rdm_key ON recommendation_daily_metrics (day, mode, fallback);
-- ∵ UNIQUE 인덱스가 있어야 REFRESH MATERIALIZED VIEW CONCURRENTLY 가 된다. 일 1회 갱신.
```

<br/>

## 8. 생성 순서 (Flyway V1)

FK 방향대로. `POSTGRES_SCHEMA.sql` 이 이 순서다.

```
kdc_codes → tags → books → book_texts → book_keywords → book_embeddings
→ book_relations → book_demand_features → book_demographics → popular_segments
→ users → user_interests → library_items
→ recommendations → recommendation_items → user_events → recommendation_daily_metrics
```

## 9. 화면·API 가 읽는 곳

| 화면 · API | 읽는 표 |
| --- | --- |
| 검색 `GET /books/search` | `books` (`idx_books_lexical`, `popularity_score`) + `book_keywords` |
| 상세 `GET /books/{id}` | `books` · `book_texts`(TOC) · `book_demand_features`(metrics) · `book_demographics`(loanByAge) · `library_items`(my) |
| 함께 대출 `…/co-loans` | `book_relations` CO_LOAN |
| 비슷한 책 `…/similar` | `book_embeddings`(ES 읽기 모델) ‖ `idx_books_lexical` → 융합 → `work_key` 묶기 |
| 홈 링 · 온보딩 인기 | `popular_segments` |
| 추천 `GET /recommendations` | `library_items` `user_interests` `user_events`(입력) → `book_relations` `book_embeddings` `book_demand_features`(후보) → `recommendations` + `items`(저장) |
| 서재 · BOOK DNA | `library_items` (+ `books.kdc`·`category_path`) |
| 이벤트 | `user_events` → MV |

## 10. 이전 ERD(09-01, 5테이블)와 달라진 것

| 09-01 | 확정 | 이유 |
| --- | --- | --- |
| `books.authors JSONB` | `authors TEXT[]` + `authors_text` | GIN 배열 연산(같은 저자), tsvector 입력. 저자는 최강 서지 신호 |
| `books.tags JSONB` | 제거 → `tags.kdc_prefixes` 로 파생 | 책 태그를 저장할 근거가 없다. KDC 에서 결정적으로 나온다 |
| `books.published_date` 만 | + `published_year` · `kdc` · `category_path` · `set_isbn` · `work_key` · `audience_code` · `loans_total` | 원장·부가기호가 주는 것을 다 쓴다. 작품 묶기·분류 경로·독자대상이 화면과 추천에 필요 |
| `users.interest_tags JSONB` | `user_interests` | FK 검증 |
| `library_items.finished_at` | `finished_date` + `is_seed` | 프론트 필드명 일치, seed 구분 |
| `recommendations` | + `based_on_count` `embedding_model` | 프론트 문구, 재현 |
| 없음 | `book_texts` `book_keywords` `book_embeddings` `book_relations` `book_demand_features` `book_demographics` `popular_segments` `kdc_codes` `tags` | 추천·상세·홈이 읽을 데이터의 자리가 없었다 |
| ERD v2 초안 20테이블 | 16테이블 | 도서관 2표(MVP 배제) · 수집 원본 2표(파이프라인) · 시리즈/식별자/분류/책태그 4표(`books` 컬럼 흡수) |
