-- V5 — 검색 색인 층 · 추천 후보 층 표시 (2026-09-15). books 는 L0 331만 권 메타데이터로 그대로 두고, 「어느 책을 ES 에 색인하는가」와 「어느 책을 추천 후보로 쓰는가」를 컬럼으로 적는다.
--
-- 왜
--   [1] L0 만 구간 2,265,032권은 93.4% 가 소개·표지가 없고 원장 누적 대출의 0.97% 다. 검색 결과에 빈 카드로 나올 뿐 추천에 기여가 없다 (09-14 전수조사).
--   [2] 검색은 기존 L1(누적 대출 72+ ∪ 신간, books 안 1,047,435권)을 그대로 색인한다 — 사용자가 아는 책은 찾혀야 한다.
--   [3] 추천 후보는 더 좁힌다 — 「원장 누적 대출 90% 커버리지(임계 843+) ∪ 신간(2025+)」에서 전자책·교과서·학습참고서·신호 없는 책을 뺀 약 44만 권.
--       기존 L1 의 3단계 꼬리 56.6만 권은 키워드 3.5%·함께대출 40% 로 신호가 약해 임베딩·이웃 탐색에서 잡음이 된다.
--   [4] 색인기(BookIndexRowRepository)는 books 전 행을 읽으므로 파일만으로는 걸러지지 않는다. DB 에 표시가 있어야 색인기·추천·API 가 같은 기준을 본다.
--       행은 지우지 않는다 — ISBN·제목 정확 조회, 찜·기록, 상세 서지는 L0 전체가 대상이다.
--
-- 값은 database/_pipeline/scripts/build_candidates.py 가 계산하고 load_service_tables.sh --only candidates 가 넣는다. 임계·규칙은 candidates/<날짜>/manifest.json.

ALTER TABLE books
    ADD COLUMN catalog_layer       CHAR(4),
    ADD COLUMN is_candidate        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN candidate_exclusion VARCHAR(12);
-- catalog_layer       : CORE(누적 대출 임계 이상) / NEW(신간 트랙) / TAIL(그 외 L1 — 누적 72+ 꼬리) / NULL(L0 만 — 메타데이터 전용)
--                       **검색 색인 대상 = catalog_layer IS NOT NULL** (= 기존 L1)
-- is_candidate        : **추천 후보** = catalog_layer IN ('CORE','NEW') AND candidate_exclusion IS NULL
-- candidate_exclusion : CORE·NEW 인데 후보에서 뺀 이유 — EBOOK / TEXTBOOK / STUDY_AID / NO_SIGNAL. TAIL·L0 만·포함이면 NULL

ALTER TABLE books ADD CONSTRAINT ck_books_catalog_layer
    CHECK (catalog_layer IS NULL OR catalog_layer IN ('CORE', 'NEW', 'TAIL'));
ALTER TABLE books ADD CONSTRAINT ck_books_candidate_exclusion
    CHECK (candidate_exclusion IS NULL OR candidate_exclusion IN ('EBOOK', 'TEXTBOOK', 'STUDY_AID', 'NO_SIGNAL'));
ALTER TABLE books ADD CONSTRAINT ck_books_candidate_needs_layer
    CHECK (NOT is_candidate OR catalog_layer IN ('CORE', 'NEW'));

-- 색인기가 id 키셋으로 검색 층만 훑는다 (331만 중 약 105만). 추천 배치·통계용으로 후보 부분 인덱스도 둔다.
CREATE INDEX idx_books_searchable_id ON books (id) WHERE catalog_layer IS NOT NULL;
CREATE INDEX idx_books_candidate_id  ON books (id) WHERE is_candidate;
