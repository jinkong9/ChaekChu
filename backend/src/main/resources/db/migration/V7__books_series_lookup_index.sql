-- V7 — 「이 제목을 이 출판사가 여러 권으로 냈는가」 조회용 인덱스 (2026-09-16).
--
-- 무엇이 문제였나
--   원장 vol 은 권차와 문고 일련번호가 섞여 있다 — 데미안 민음사 44(세계문학전집 44번)·범우사 638(사르비아총서 638번).
--   「비슷한 책」이 vol 을 권차로 믿고 접지 않아 데미안 판본 94권이 24묶음으로 갈렸고, 상세 화면에 「데미안」이 네 번 떴다.
--   반대로 vol 을 아예 무시하면 토지 21권·학사검전 9권이 한 권으로 뭉개진다.
--
-- 가르는 기준
--   같은 제목·같은 출판사가 한 해에 두 권차 이상을 낸 기록이 있으면 시리즈다(토지 나남 2002 21권, 셜록 홈즈 비룡소 2013 7권).
--   고전을 다른 전집에 다시 넣은 경우는 연도가 달라 걸리지 않는다(데미안 민음사 2000·2009).
--   WorkSeriesRepository 가 요청마다 책 10권 안팎을 VALUES 조인으로 묻는다 — 3.3M 행 전수 조회를 막으려면 인덱스가 필요하다.
--
-- 크기·시간 (로컬 실측, books 3,312,470행 중 vol 있는 693,792행만)
--   36MB · 49초. 운영에서는 배포 전에 CREATE INDEX CONCURRENTLY 로 먼저 만들어 두면 이 파일은 IF NOT EXISTS 로 즉시 끝난다
--   (기동 healthcheck start_period 60초 안에 Flyway 가 끝나야 한다).

CREATE INDEX IF NOT EXISTS idx_books_title_publisher_vol
    ON books (lower(title), publisher)
    WHERE vol IS NOT NULL;

COMMENT ON INDEX idx_books_title_publisher_vol IS
    '시리즈 판정용 — (제목, 출판사) 로 권차 있는 행을 모아 한 해에 두 권차 이상인지 본다(WorkSeriesRepository)';
