#!/usr/bin/env bash
# V1 테이블 적재 — 로컬·EC2 공용. PostgreSQL 컨테이너(b102-postgres)에 docker exec 로 psql 을 실행한다.
#
#   bash load_service_tables.sh <load_dir> [--only books|book_tags|book_loaned_top20]
#     load_dir  build_service_tables.py / fetch_segment_popular.py 가 만든 폴더 (books.csv.gz · book_tags.csv.gz · book_loaned_top20.csv)
#   환경변수  PG_CONTAINER(기본 b102-postgres) · PG_USER(book) · PG_DB(bookdb)
#
# 방식: 파일을 컨테이너로 복사하지 않는다. psql 표준입력 하나에 「SQL → \copy … from stdin → CSV 본문 → \. → SQL」을 순서대로 흘린다.
#       (heredoc 과 파이프를 같이 쓰면 heredoc 이 stdin 을 차지해 \copy 가 SQL 줄을 데이터로 읽는다 — 09-09 실제로 겪음)
#       books 는 임시 표 → INSERT … ON CONFLICT (isbn13) DO UPDATE (재적재 가능). book_tags·top20 은 isbn13 → books.id 조인.
#       스키마는 만들지 않는다 — Flyway V1 이 적용된 DB 를 전제한다.
set -euo pipefail
DIR="${1:?load_dir 필요}"; shift || true
ONLY=""; [[ "${1:-}" == "--only" ]] && ONLY="${2:?}"
PGC="${PG_CONTAINER:-b102-postgres}"; PGU="${PG_USER:-book}"; PGD="${PG_DB:-bookdb}"
PSQL=(docker exec -i "$PGC" psql -v ON_ERROR_STOP=1 -q -U "$PGU" -d "$PGD")

say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
count() { "${PSQL[@]}" -tAc "select count(*) from $1"; }
want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }
# stream <pre_sql> <data_cmd...> — pre_sql 은 \copy … from stdin 으로 끝나야 한다. POST_SQL 변수를 뒤에 붙인다.
stream() {
  local pre="$1"; shift
  { printf '%s\n' "$pre"; "$@"; printf '\\.\n'; printf '%s\n' "$POST_SQL"; } | "${PSQL[@]}"
}

"${PSQL[@]}" -tAc "select 1" >/dev/null || { echo "PostgreSQL 컨테이너 $PGC 에 연결 실패" >&2; exit 1; }
say "대상 $PGC/$PGD · 적재 전 books=$(count books) book_tags=$(count book_tags) book_loaned_top20=$(count book_loaned_top20)"

if want books && [[ -f "$DIR/books.csv.gz" ]]; then
  say "books ← $DIR/books.csv.gz"
  POST_SQL='
insert into books (isbn13, title, author, publisher, pub_year, category_code, description, cover_url)
select isbn13, title, author, publisher, pub_year, category_code, description, cover_url from stg_books
on conflict (isbn13) do update set
  title = excluded.title, author = excluded.author, publisher = excluded.publisher, pub_year = excluded.pub_year,
  category_code = excluded.category_code, description = excluded.description, cover_url = excluded.cover_url,
  updated_at = now()
where (books.title, books.author, books.publisher, books.pub_year, books.category_code, books.description, books.cover_url)
   is distinct from (excluded.title, excluded.author, excluded.publisher, excluded.pub_year, excluded.category_code, excluded.description, excluded.cover_url);
analyze books;'
  stream 'create temp table stg_books (isbn13 char(13), title varchar(500), author varchar(300), publisher varchar(200),
  pub_year smallint, category_code varchar(10), description text, cover_url varchar(500));
\copy stg_books from stdin with (format csv, header true)' gzip -dc "$DIR/books.csv.gz"
  say "books=$(count books)"
fi

if want book_tags && [[ -f "$DIR/book_tags.csv.gz" ]]; then
  say "book_tags ← $DIR/book_tags.csv.gz"
  POST_SQL='
insert into book_tags (book_id, tag_code)
select b.id, s.tag_code from stg_bt s join books b on b.isbn13 = s.isbn13 join tags t on t.tag_code = s.tag_code
on conflict (book_id, tag_code) do nothing;'
  stream 'create temp table stg_bt (isbn13 char(13), tag_code varchar(30));
\copy stg_bt from stdin with (format csv, header true)' gzip -dc "$DIR/book_tags.csv.gz"
  say "book_tags=$(count book_tags)"
fi

if want book_loaned_top20 && [[ -f "$DIR/book_loaned_top20.csv" ]]; then
  say "book_loaned_top20 ← $DIR/book_loaned_top20.csv"
  POST_SQL='
-- ∵ API 의 ranking 은 동률이 있어 (period, gender, age_group, ranking) UNIQUE 에 걸린다 → books 조인 뒤 순번을 다시 매긴다
insert into book_loaned_top20 (book_id, gender, age_group, ranking, loan_count, period)
select book_id, gender, age_group, rn, loan_count, period from (
  select b.id book_id, s.gender, s.age_group, s.loan_count, s.period,
         row_number() over (partition by s.period, s.gender, s.age_group order by s.ranking, s.loan_count desc, s.isbn13) rn
  from stg_top s join books b on b.isbn13 = s.isbn13) x
on conflict (period, gender, age_group, ranking) do update set book_id = excluded.book_id, loan_count = excluded.loan_count;
select count(*) as "books 에 없어 건너뜀" from stg_top s left join books b on b.isbn13 = s.isbn13 where b.id is null;'
  stream 'create temp table stg_top (isbn13 char(13), gender char(1), age_group varchar(2), ranking smallint, loan_count int,
  period char(6), bookname text, cover_url text);
\copy stg_top from stdin with (format csv, header true)' tr -d '\r' < "$DIR/book_loaned_top20.csv"
  # ∵ tr -d '\r': Windows 에서 만든 CSV(CRLF) 뒤에 "\." 종료 줄(LF)이 오면 COPY 가 "unquoted newline" 으로 거부한다
  say "book_loaned_top20=$(count book_loaned_top20)"
fi
say "완료"
