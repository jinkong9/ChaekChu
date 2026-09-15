-- V6 — books 에 권차(vol)·세트 ISBN(set_isbn) 추가 (2026-09-15). 원장에 있던 값을 적재 때 버리고 있었다.
--
-- 무엇이 문제였나
--   카탈로그는 ISBN13 하나가 한 행인데, 시리즈는 권마다 제목이 같다. 비룡소 셜록 홈즈 7권이
--   제목·저자·출판사·연도·KDC 가 모두 같고 소개문까지 시리즈 공통 문구라 books 안에서 구별할 값이 없다.
--   그래서 「비슷한 책」의 작품 접기(WorkKey)가 7권을 1권으로 뭉갰다 — 주홍색 연구와 네 개의 서명은 다른 소설인데도.
--
-- 값은 원장에 있었다 (books_dedup.parquet)
--   9788949124216  set_isbn=9788949124209  vol=1
--   9788949124223  set_isbn=9788949124209  vol=2   … vol=7 까지
--   build_service_tables.py 가 원장에서 loans·lib_count 만 집어 오느라 두 컬럼이 빠졌다.
--
-- 추천 후보 44만 권 기준 실측 (제목+저자가 겹치는 116,170행 · 39,096묶음)
--   vol 로 갈라지는 묶음          16,513 (42.2%)  ← 시리즈가 제대로 분리된다
--   set_isbn 은 있고 vol 이 없음      393 ( 1.0%)  ← set_isbn 만으로도 분리한다(아래)
--   둘 다 없음 = 판본 중복          22,190 (56.8%)  ← 접는 게 맞는 동작
--
-- 임베딩에는 영향이 없다. 임베딩 입력(embedding_text)은 bookname·authors·publisher·pub_year·class_no·class_nm 여섯 필드뿐이고,
-- 재임베딩 트리거인 books.text_hash 도 title|author|category_code|keywords|description 으로 두 컬럼을 쓰지 않는다.
-- AI 배치는 파케이 스냅샷을 읽지 이 표를 읽지 않는다. 전권 재임베딩은 일어나지 않는다.

ALTER TABLE books ADD COLUMN vol      VARCHAR(20);
ALTER TABLE books ADD COLUMN set_isbn VARCHAR(13);
-- vol      : 원장 「권」 컬럼 그대로. 대부분 '1' '2' … 지만 0.4% 는 '상' '1-2' 처럼 숫자가 아니라 VARCHAR 다.
--            NULL 은 «단권» 이 아니라 «미상» 이다 — 도서관이 안 적었을 수도 있다. 단권 판정에 쓰면 안 된다.
-- set_isbn : 세트(시리즈) 대표 ISBN. 같은 세트의 권들이 공유한다. **작품 식별자가 아니다** —
--            이것으로 접으면 시리즈 전체가 한 권이 된다. 「이 값이 있으면 세트의 한 권」이라는 신호로만 쓴다.
--            FK 를 걸지 않는다: 대표 ISBN 이 books 에 없을 수 있다(세트 자체는 대출 이력이 없어 카탈로그에서 빠지기도 한다).

COMMENT ON COLUMN books.vol      IS '원장 권차. NULL = 미상(단권이라는 뜻이 아니다)';
COMMENT ON COLUMN books.set_isbn IS '세트 대표 ISBN. 세트 구성원 신호이지 작품 식별자가 아니다';

-- 인덱스는 두지 않는다. 지금 쓰임이 「행을 읽은 뒤 작품 키를 만드는 것」뿐이라 조회 조건에 들어가지 않는다.
-- 「이 시리즈의 다른 권」 같은 화면이 생기면 그때 (set_isbn, vol) 로 만든다.
