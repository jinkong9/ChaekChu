-- V11 — 검색 노출까지 막는 제외 규칙 (2026-09-18). V5 가 만든 층 표시 위에 「검색에도 내보내지 않는다」를 더한다.
--
-- 왜 (09-18 운영 화면에서 발견)
--   [1] 도서관이 한 곳도 소장하지 않은 책이 검색·추천에 나왔다. 예: /books/3299010 — 2025년 자비출판, 원장에 아예 없음(소장 0개관·대출 0).
--       원인은 L1 큐가 **수집 대상 목록**이었다는 것. 신간 트랙은 국중 서지에서 「2025년 이후 발행」만 보고 뽑았고 원장 조건이 없었다
--       (build_enrich_queue.py: 「신간은 국중 쪽에만 있을 수 있다」). 수집에는 맞는 규칙이지만 노출 기준으로 쓰면 빌릴 수 없는 책이 들어온다.
--       신간에 준 면제는 「대출 횟수」에 대한 것이지 「소장 여부」가 아니다 (09-18 사용자 결정).
--   [2] 전자책이 종이책과 나란히 떠서 같은 책이 둘로 보였다. 예: /books/2503974 · /books/2503978 (달러구트, 종이 17,800원 / 전자 13,000원).
--       L0 정의의 「전자책 제외」가 국중 경로에만 걸려 있어 원장 경로로 들어온 전자책이 남았다.
--   [3] 수험서·문제집·교과서는 추천 후보에서만 빼고 검색에는 그대로 뒀는데, 도서 추천 서비스의 검색 결과로도 부적절하다는 판단 (09-18 사용자 결정).
--
-- 그래서 「층에 속하는가(catalog_layer)」와 「검색에 내보내는가(is_searchable)」를 분리한다.
--   검색 노출 = is_searchable = 층 있음 ∧ 제외 사유가 없거나 NO_SIGNAL 뿐      ← 색인기가 이 컬럼만 본다
--   추천 후보 = is_candidate  = is_searchable ∧ 층이 CORE·NEW ∧ 제외 사유 없음  (NO_SIGNAL 도 후보에서는 뺀다)
-- NO_SIGNAL(소개·표지·키워드·관계 전부 없음)만 검색을 막지 않는다 — 서지만 있어도 제목으로 찾는 것은 되어야 하기 때문이다.

ALTER TABLE books ADD COLUMN is_searchable BOOLEAN NOT NULL DEFAULT FALSE;
-- 값은 database/_pipeline/scripts/build_candidates.py 가 계산하고 load_service_tables.sh --only candidates 가 넣는다.

-- 초기값은 V5 와 같은 뜻(층에 속하면 검색)으로 채운다. 두 가지 이유다.
--   ① 아래 ck_books_candidate_needs_searchable 가 기존 행(is_candidate=true, 기본값 false)에 걸려 마이그레이션이 실패한다.
--   ② 마이그레이션만 배포되고 적재가 아직이면 검색이 통째로 비어 버린다. 이 값이면 적재 전까지 지금 동작이 그대로 유지된다.
-- 적재가 돌면 소장 0개관·전자책·교과서·수험서가 false 로 내려간다. catalog_layer 부분 인덱스를 타므로 전체 훑기는 아니다.
UPDATE books SET is_searchable = TRUE WHERE catalog_layer IS NOT NULL;

-- 제외 사유에 NO_HOLDING(원장에 없음 = 소장 0개관) 추가
ALTER TABLE books DROP CONSTRAINT ck_books_candidate_exclusion;
ALTER TABLE books ADD CONSTRAINT ck_books_candidate_exclusion
    CHECK (candidate_exclusion IS NULL
           OR candidate_exclusion IN ('EBOOK', 'TEXTBOOK', 'STUDY_AID', 'NO_SIGNAL', 'NO_HOLDING'));

-- 후보는 반드시 검색 대상이기도 하다
ALTER TABLE books ADD CONSTRAINT ck_books_candidate_needs_searchable
    CHECK (NOT is_candidate OR is_searchable);
-- 검색 대상이면 층이 있어야 한다
ALTER TABLE books ADD CONSTRAINT ck_books_searchable_needs_layer
    CHECK (NOT is_searchable OR catalog_layer IS NOT NULL);

-- 색인기가 id 키셋으로 검색 대상만 훑는다. V5 의 catalog_layer 기준 인덱스를 대체한다.
DROP INDEX IF EXISTS idx_books_searchable_id;
CREATE INDEX idx_books_searchable_id ON books (id) WHERE is_searchable;
