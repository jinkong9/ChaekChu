-- V3 — 추천 스냅샷 저장과 행동 이벤트 보강 (2026-09-11). V1 의 recommendations · recommendation_items · user_actions 를 실제로 쓸 수 있게 고친다.
--
-- 왜 필요한가
--   V1 을 설계한 뒤 추천이 FastAPI 로 넘어가면서 계약이 달라졌다. 그대로 두면 다음 두 가지가 물리적으로 불가능하다.
--   [1] 추천 스냅샷을 한 행도 저장할 수 없다 — 응답의 recommendationId 는 AI 가 만든 문자열("rec_ab12…")인데 PK 는 BIGINT IDENTITY 다.
--       user_actions.recommendation_id 는 그 BIGINT 를 참조하므로, 스냅샷이 없으면 노출·클릭 이벤트의 절반이 저장조차 안 된다.
--   [2] 저장하려 해도 CHECK 에 걸린다 — AI 가 주는 reason_type 은 TAG_MATCH/SEMANTIC/CO_LOAN/TRENDING/STEADY(계약 경로)와
--       MANIA_REC/READER_REC(관계 경로)인데 V1 CHECK 목록에 하나도 없다.
--   [3] 「보여줬는데 안 눌렀다」를 알 수 없다 — 노출이 덱 단위라 어떤 책이 실제로 화면에 떴는지 남지 않는다. 부정 신호가 통째로 비어 있다.
--
-- 무엇을 바꾸나
--   recommendations       public_id(대외 식별자) · index_version 추가 — 화면에 내보낸 id 로 이벤트를 되찾는다
--   recommendation_items  ck_ri_reason 을 AI 계약값까지 넓힘 (V1 목록은 그대로 남긴다 — 세그먼트 인기 경로가 SEGMENT_POPULAR 를 쓴다)
--   user_actions          display_position(실제 표시 자리) · session_id(방문 묶기) · payload(검색어·체류시간) 추가,
--                         event_type 에 DISMISS(넘김 = 부정 신호) · SEARCH(질의 의도) 추가
--
-- 지금까지 이 세 표에 쓰기가 일어난 적이 없다(엔티티도 레포지토리도 없었다). 그래도 운영 데이터가 있을 경우를 대비해 backfill 을 먼저 둔다.

-- ── [1] 추천 스냅샷 ──────────────────────────────────────────────

ALTER TABLE recommendations ADD COLUMN public_id     VARCHAR(64);
ALTER TABLE recommendations ADD COLUMN index_version VARCHAR(30);
-- public_id     : API 응답의 recommendationId 그대로. AI 계약은 "rec_" + sha256 앞 16자, 세그먼트 인기 경로는 "rec-" + UUID(40자)
-- index_version : 응답의 indexVersion. feature_version(= modelVersion)과 짝이다 — 어떤 색인으로 뽑았는지 없으면 결과를 재현할 수 없다

UPDATE recommendations SET public_id = 'rec_legacy_' || id WHERE public_id IS NULL;
ALTER TABLE recommendations ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE recommendations ADD CONSTRAINT uq_rec_public UNIQUE (public_id);

-- 같은 추천을 다시 조회해도 새로 저장하지 않는다(설계 문서). 덱은 요청마다 새 id 라 사실상 append 지만,
-- 이벤트가 늦게 도착해도 되도록 public_id 조회는 유니크 인덱스 한 번으로 끝나야 한다.

ALTER TABLE recommendation_items DROP CONSTRAINT ck_ri_reason;
ALTER TABLE recommendation_items ADD CONSTRAINT ck_ri_reason CHECK (reason_type IN (
    -- V1 설계 목록 — 서버가 직접 만드는 이유
    'SAME_AUTHOR','SAME_CATEGORY','TEXT_SIMILARITY','SEGMENT_POPULAR',
    'DEMAND_POPULAR','MOMENTUM','NEW_BOOK','INITIAL_PREFERENCE',
    -- FastAPI 계약 경로 (ai/src/recommendation/top_k.py REASON_TEMPLATES)
    'TAG_MATCH','SEMANTIC','CO_LOAN','TRENDING','STEADY',
    -- FastAPI 관계 경로 (정보나루 마니아·다독자 추천)
    'MANIA_REC','READER_REC'));

-- ── [2] 행동 이벤트 ──────────────────────────────────────────────

ALTER TABLE user_actions ADD COLUMN display_position SMALLINT;
ALTER TABLE user_actions ADD COLUMN session_id       VARCHAR(36);
ALTER TABLE user_actions ADD COLUMN payload          JSONB NOT NULL DEFAULT '{}'::jsonb;
-- display_position : 화면에서 실제로 몇 번째 자리에 보였나. rank(서버가 매긴 순위)와 다르다 —
--                    추천 화면이 덱을 태그 겹침으로 재정렬한 뒤 앞 5장만 펴기 때문이다(RecommendPage). 위치 편향 보정의 기준.
-- session_id       : 한 번의 방문을 묶는 클라이언트 생성 키. 검색 → 상세 → 찜 처럼 이어진 행동을 볼 수 있다
-- payload          : 타입마다 다른 값. SEARCH 의 query·resultCount, BOOK_VIEW 의 dwellMs.
--                    신호 하나 추가할 때마다 마이그레이션하지 않으려고 둔 칸이다 — 화면이 채우는 값만 들어간다

ALTER TABLE user_actions ADD CONSTRAINT ck_ua_payload  CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE user_actions ADD CONSTRAINT ck_ua_position CHECK (display_position IS NULL OR display_position >= 1);

ALTER TABLE user_actions DROP CONSTRAINT ck_ua_type;
ALTER TABLE user_actions ADD CONSTRAINT ck_ua_type CHECK (event_type IN (
    'IMPRESSION','CLICK','REASON_VIEW','BOOK_VIEW','WISH',
    'DISMISS',   -- 카드를 넘기거나 다른 책을 꺼내 올림 = 유일한 부정 신호. exclude 후보의 원천
    'SEARCH'));  -- 질의 의도. payload.query 에 검색어

-- 개인화 피드백이 읽는 경로: 「이 사용자의 최근 CLICK/WISH/DISMISS」. 기존 idx_ua_user_book 은 책이 정해진 뒤에만 쓴다.
CREATE INDEX idx_ua_user_type_time ON user_actions (user_id, event_type, occurred_at DESC);
