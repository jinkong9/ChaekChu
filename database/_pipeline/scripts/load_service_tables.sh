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
  # 컬럼 집합은 DB 에 실제로 있는 것에 맞춘다 — V6(vol·set_isbn) > V2(description_source·description_kakao·text_hash) > V1(8컬럼).
  if "${PSQL[@]}" -tAc "select 1 from information_schema.columns where table_name='books' and column_name='vol'" | grep -q 1; then
    POST_SQL='
insert into books (isbn13, title, author, publisher, pub_year, category_code, description, cover_url, description_source, description_kakao, text_hash, vol, set_isbn)
select isbn13, title, author, publisher, pub_year, category_code, description, cover_url, description_source, description_kakao, text_hash, vol, set_isbn from stg_books
on conflict (isbn13) do update set
  title = excluded.title, author = excluded.author, publisher = excluded.publisher, pub_year = excluded.pub_year,
  category_code = excluded.category_code, description = excluded.description, cover_url = excluded.cover_url,
  description_source = excluded.description_source, description_kakao = excluded.description_kakao, text_hash = excluded.text_hash,
  vol = excluded.vol, set_isbn = excluded.set_isbn,
  updated_at = now()
where (books.title, books.author, books.publisher, books.pub_year, books.category_code, books.description, books.cover_url, books.description_source, books.description_kakao, books.text_hash, books.vol, books.set_isbn)
   is distinct from (excluded.title, excluded.author, excluded.publisher, excluded.pub_year, excluded.category_code, excluded.description, excluded.cover_url, excluded.description_source, excluded.description_kakao, excluded.text_hash, excluded.vol, excluded.set_isbn);
analyze books;'
  elif "${PSQL[@]}" -tAc "select 1 from information_schema.columns where table_name='books' and column_name='text_hash'" | grep -q 1; then
    POST_SQL='
insert into books (isbn13, title, author, publisher, pub_year, category_code, description, cover_url, description_source, description_kakao, text_hash)
select isbn13, title, author, publisher, pub_year, category_code, description, cover_url, description_source, description_kakao, text_hash from stg_books
on conflict (isbn13) do update set
  title = excluded.title, author = excluded.author, publisher = excluded.publisher, pub_year = excluded.pub_year,
  category_code = excluded.category_code, description = excluded.description, cover_url = excluded.cover_url,
  description_source = excluded.description_source, description_kakao = excluded.description_kakao, text_hash = excluded.text_hash,
  updated_at = now()
where (books.title, books.author, books.publisher, books.pub_year, books.category_code, books.description, books.cover_url, books.description_source, books.description_kakao, books.text_hash)
   is distinct from (excluded.title, excluded.author, excluded.publisher, excluded.pub_year, excluded.category_code, excluded.description, excluded.cover_url, excluded.description_source, excluded.description_kakao, excluded.text_hash);
analyze books;'
  else
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
  fi
  # stg 는 CSV 헤더와 같은 컬럼 순서여야 한다(build_service_tables.py 의 copy 문). 옛 DB 면 뒤 두 칸은 그냥 안 쓰인다.
  stream 'create temp table stg_books (isbn13 char(13), title varchar(500), author varchar(300), publisher varchar(200),
  pub_year smallint, category_code varchar(10), description text, cover_url varchar(500),
  description_source varchar(20), description_kakao text, text_hash char(64), vol varchar(20), set_isbn varchar(13));
\copy stg_books from stdin with (format csv, header true)' gzip -dc "$DIR/books.csv.gz"
  say "books=$(count books)"
fi

if want book_tags && [[ -f "$DIR/book_tags.csv.gz" ]]; then
  say "book_tags ← $DIR/book_tags.csv.gz"
  # ∵ book_tags 는 KDC 규칙으로 통째로 파생되는 표 — 규칙이 바뀌면 옛 태그가 남지 않게 비우고 다시 넣는다 (사용자 데이터 없음)
  POST_SQL='
truncate book_tags;
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

# ── V2 (표가 있을 때만) ────────────────────────────────────────────────
has_table() { "${PSQL[@]}" -tAc "select 1 from information_schema.tables where table_name='$1'" | grep -q 1; }

if want kdc_codes && [[ -f "$DIR/kdc_codes.csv" ]] && has_table kdc_codes; then
  say "kdc_codes ← $DIR/kdc_codes.csv"
  POST_SQL='
insert into kdc_codes (code, label, parent_code, depth)
select code, label, parent_code, depth from stg_kdc order by depth
on conflict (code) do update set label = excluded.label, parent_code = excluded.parent_code, depth = excluded.depth;'
  stream 'create temp table stg_kdc (code varchar(10), label varchar(200), parent_code varchar(10), depth smallint);
\copy stg_kdc from stdin with (format csv, header true)' tr -d '\r' < "$DIR/kdc_codes.csv"
  say "kdc_codes=$(count kdc_codes)"
fi

if want book_keywords && [[ -f "$DIR/book_keywords.csv.gz" ]] && has_table book_keywords; then
  say "book_keywords ← $DIR/book_keywords.csv.gz (비우고 다시)"
  POST_SQL='
truncate book_keywords;
insert into book_keywords (book_id, keyword, weight, rank)
select b.id, s.keyword, s.weight, s.rank from stg_kw s join books b on b.isbn13 = s.isbn13
on conflict (book_id, keyword) do nothing;
analyze book_keywords;'
  stream 'create temp table stg_kw (isbn13 char(13), keyword varchar(100), weight numeric(8,2), rank smallint);
\copy stg_kw from stdin with (format csv, header true)' gzip -dc "$DIR/book_keywords.csv.gz"
  say "book_keywords=$(count book_keywords)"
fi

if want book_relations && [[ -f "$DIR/book_relations.csv.gz" ]] && has_table book_relations; then
  say "book_relations ← $DIR/book_relations.csv.gz (비우고 다시)"
  POST_SQL='
truncate book_relations;
insert into book_relations (source_book_id, target_book_id, target_isbn13, relation_type, rank, collected_at)
select s.id, t.id, r.target_isbn13, r.relation_type, r.rank, current_date
from stg_rel r join books s on s.isbn13 = r.isbn13 left join books t on t.isbn13 = r.target_isbn13
on conflict (source_book_id, relation_type, target_isbn13) do nothing;
analyze book_relations;
select relation_type, count(*) as rows, count(target_book_id) as linked from book_relations group by 1 order by 1;'
  stream 'create temp table stg_rel (isbn13 char(13), target_isbn13 char(13), relation_type varchar(12), rank smallint);
\copy stg_rel from stdin with (format csv, header true)' gzip -dc "$DIR/book_relations.csv.gz"
  say "book_relations=$(count book_relations)"
fi

if want book_demand_features && [[ -f "$DIR/book_demand_features.csv.gz" ]] && has_table book_demand_features; then
  say "book_demand_features ← $DIR/book_demand_features.csv.gz"
  POST_SQL='
insert into book_demand_features (book_id, as_of_month, loan_cum, loan_3m, loan_12m, holder_libs, feature_version)
select b.id, s.as_of_month, s.loan_cum, s.loan_3m, s.loan_12m, s.holder_libs, s.feature_version from stg_dem s join books b on b.isbn13 = s.isbn13
on conflict (book_id, as_of_month) do update set loan_cum = excluded.loan_cum, loan_3m = excluded.loan_3m, loan_12m = excluded.loan_12m,
  holder_libs = excluded.holder_libs, feature_version = excluded.feature_version;
analyze book_demand_features;'
  stream 'create temp table stg_dem (isbn13 char(13), as_of_month char(7), loan_cum bigint, loan_3m integer, loan_12m integer, holder_libs integer, feature_version varchar(20));
\copy stg_dem from stdin with (format csv, header true)' gzip -dc "$DIR/book_demand_features.csv.gz"
  say "book_demand_features=$(count book_demand_features)"
fi
# ── V5 후보 층 (build_candidates.py 의 candidates.csv · 컬럼이 있을 때만) ───────────────
has_column() { "${PSQL[@]}" -tAc "select 1 from information_schema.columns where table_name='$1' and column_name='$2'" | grep -q 1; }

if want candidates && [[ -f "$DIR/candidates.csv" ]] && has_column books is_searchable; then
  say "candidates ← $DIR/candidates.csv (books.catalog_layer · is_searchable[검색 노출] · is_candidate[추천 후보] · candidate_exclusion 전체 다시 계산)"
  # ∵ 층·노출·후보는 임계·규칙으로 통째로 파생되는 값 — 먼저 전부 비우고(L0 만 = NULL/false) L1 만 다시 채운다. 빠진 책이 남지 않게.
  POST_SQL='
update books set catalog_layer = null, is_searchable = false, is_candidate = false, candidate_exclusion = null
 where catalog_layer is not null or is_searchable or is_candidate or candidate_exclusion is not null;
update books b set catalog_layer = s.layer, is_searchable = s.searchable, is_candidate = s.include,
       candidate_exclusion = nullif(s.exclude_reason, '"''"')
  from stg_cand s where b.isbn13 = s.isbn13;
analyze books;
select catalog_layer, is_searchable, is_candidate, coalesce(candidate_exclusion, '"'-'"') exclusion, count(*)
  from books where catalog_layer is not null group by 1, 2, 3, 4 order by 1, 2 desc, 3 desc, 4;'
  stream 'create temp table stg_cand (isbn13 char(13), layer char(4), loan_cum bigint, holder_libs integer, pub_year varchar(10),
  searchable boolean, include boolean, exclude_reason varchar(12),
  has_desc boolean, has_cover boolean, has_keywords boolean, has_relations boolean);
\copy stg_cand from stdin with (format csv, header true)' tr -d '\r' < "$DIR/candidates.csv"
  say "검색 노출(is_searchable)=$("${PSQL[@]}" -tAc "select count(*) from books where is_searchable") · 추천 후보(is_candidate)=$("${PSQL[@]}" -tAc "select count(*) from books where is_candidate")"
fi
say "완료"
