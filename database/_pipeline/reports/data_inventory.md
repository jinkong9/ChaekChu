# 수집 데이터 인벤토리

작성 2026-08-27 · 실제 파일에서 추출한 스키마 · 채움율은 실측

저장 위치는 두 곳으로 나뉜다.

| 위치 | 대상 | Git |
| --- | --- | --- |
| `project_personal/` | 원본·Parquet·수집 산출물 (대용량) | **제외** |
| `S15P21B102/database/` | 스크립트·리포트·샘플·메타데이터 | 포함 |

<br/>

## 1. 국립중앙도서관 (SEOJI)

### 1.1 `nl_books.parquet` — 원본 39컬럼

2,047,239행 / 275.3MB / 전 컬럼 `VARCHAR` (ISBN 보호 목적)

| 컬럼 | 채움율 | 설명 |
| --- | --- | --- |
| `EA_ISBN` | 98.75% | **ISBN10/13 혼재** (ISBN10 18.22%) |
| `SET_ISBN` | 22.05% | 세트 ISBN |
| `RELATED_ISBN` | 3.29% | 관련 ISBN |
| `TITLE` | 99.98% | 서명 |
| `AUTHOR` | 98.50% | 저자 (역할어 혼입: `지음`, `저자 :`) |
| `PUBLISHER` | 100.00% | 출판사 |
| `PUBLISH_PREDATE` | 100.00% | 발행예정일 **8자리** (`20240115`) |
| `REAL_PUBLISH_DATE` | 18.04% | 실제 발행일 |
| `INPUT_DATE` / `UPDATE_DATE` | 99.98% / 91.35% | 등록·수정일 |
| `EA_ADD_CODE` | 98.08% | **부가기호 5자리** — 독자대상1+발행형태1+KDC3 |
| `SET_ADD_CODE` | 19.47% | 세트 부가기호 |
| `KDC` | **11.08%** | 십진분류 (소수점 세밀하나 결측 심각) |
| `DDC` | 6.84% | 듀이분류 |
| `SUBJECT` | 96.75% | 주제 대분류 1자리 |
| **`BOOK_INTRODUCTION`** | **6.49%** | **책소개 본문** |
| `BOOK_INTRODUCTION_URL` | 5.63% | 책소개 파일 링크 (본문과 **상호배타**) |
| `BOOK_TB_CNT` / `_URL` | 6.13% / 5.10% | 목차 본문 / 링크 |
| `BOOK_SUMMARY` / `_URL` | 2.04% / 1.31% | 요약 본문 / 링크 |
| `PRE_PRICE` | 96.13% | 정가. **`비매품/무료` 문자열 5.8% 포함** |
| `REAL_PRICE` | 2.26% | 실판매가 |
| `PAGE` / `BOOK_SIZE` | 41.79% / 33.08% | 쪽수 / 판형 |
| `FORM` / `FORM_DETAIL` | 51.71% / 48.63% | 형태 |
| `EDITION_STMT` | 9.30% | 판차 |
| `SERIES_TITLE` / `SERIES_NO` / `VOL` | 22.06% / 17.49% / 17.00% | 총서·권차 |
| `SET_EXPRESSION` | 3.14% | 세트 표현 |
| `CONTROL_NO` | 11.08% | 제어번호 |
| `CIP_YN` | 78.12% | CIP 신청 여부. **2020년 이후 빈값** (제도 종료) |
| `EBOOK_YN` / `DEPOSIT_YN` / `BIB_YN` | 100% | 전자책·납본·서지 플래그 |
| `PUBLISHER_URL` / `TITLE_URL` | 60.21% / 14.91% | 링크 |

### 1.2 `nl_books_derived.parquet` — 파생 25컬럼

2,047,239행 / 93.7MB · Phase 0 산출물

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `isbn13_norm` | VARCHAR | **정규화 ISBN13** (10→13 변환, 성공 98.68%) — **조인 키** |
| `isbn_kind` | VARCHAR | `ISBN13`/`ISBN10`/`빈값`/`체크섬오류`/`기타형식` |
| `pub_year` | INTEGER | `PUBLISH_PREDATE` 앞 4자리 |
| `add_audience` | VARCHAR | `EA_ADD_CODE[0]` 독자대상 (0교양/9전문 등) |
| `add_form` | VARCHAR | `EA_ADD_CODE[1]` 발행형태 (3단행본/5전자출판물 등) |
| **`add_kdc3`** | VARCHAR | `EA_ADD_CODE[2:5]` **복원 KDC 3자리 — 채움 98.0%** |
| `pre_price` / `publisher_nz` | VARCHAR | 빈문자→NULL 정규화본 |
| `intro_len` / `toc_len` / `summary_len` | BIGINT | 각 텍스트 길이 |
| `intro_url` / `toc_url` / `summary_url` | VARCHAR | 링크 (빈문자→NULL) |
| `has_usable_text` | BOOLEAN | 셋 중 하나가 100자 이상 (**6.95%**) |

+ `EA_ISBN`, `TITLE`, `AUTHOR`, `PUBLISHER`, `PUBLISH_PREDATE`, `EA_ADD_CODE`, `KDC`, `SUBJECT`, `CIP_YN`, `EBOOK_YN` 원본 승계

### 1.3 `nl_url_text.csv` — URL 회수 텍스트 (수집 중)

| 컬럼 | 설명 |
| --- | --- |
| `isbn13` | 정규화 ISBN13 |
| `field` | `intro` / `toc` / `summary` |
| `url` | 원본 `.txt` 링크 |
| `chars` | 텍스트 길이 (무결성 검증용) |
| `text` | **회수한 본문** |

대상 207,022건 (`.txt`만. `.jpg` 39,001건은 OCR 필요라 제외)

<br/>

## 2. 정보나루 (도서관 정보나루)

원본은 관별 CSV 샤드 → Parquet 3종으로 빌드.
원천 CSV 컬럼: `번호, 도서명, 저자, 출판사, 발행년도, ISBN, 세트 ISBN, 부가기호, 권, 주제분류번호, 도서권수, 대출건수, 등록일자`

### 2.1 `holdings.parquet` — 보유 원장

**121,135,896행** / 672.8MB · 1,660개관 최신월 기준

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `lib_id` | INTEGER | 도서관 내부 id |
| `isbn13` | VARCHAR | 정규화 ISBN13 (체크숫자 폴백 적용) |
| `loans` | INTEGER | **누적 대출건수** (~2014년 기산 다년 누적) |
| `copies` | INTEGER | 도서권수(복본 수) |

### 2.2 `libraries.parquet` — 도서관 마스터

1,660행 / 0.1MB

| 컬럼 | 설명 |
| --- | --- |
| `lib_id` | 사이트 내부 id (수집용) |
| `api_libcode` | **정보나루 API용 libCode** (내부 id와 다름) |
| `lib_name` / `lib_type` | 이름 / `공공`·`작은` |
| `latest_month` | 수집한 파일의 기준월 |
| `unique_isbn` | 그 관의 고유 ISBN 수 |
| `address` / `lat` / `lon` / `tel` / `homepage` | 참여도서관 XLSX 조인 (성공 95.6%) |

### 2.3 `loans_by_isbn.parquet` — ISBN 합산 (파생)

2,791,309행 / 24.9MB

| 컬럼 | 설명 |
| --- | --- |
| `isbn13` | 정규화 ISBN13 |
| `loans` | 전국 누적 대출 합계 |
| `copies` | 전국 복본 합계 |
| `holder_libs` | **보유 도서관 수** (희소성 신호) |

### 2.4 `lib_index.jsonl` — 수집 인덱스

1,660행 · `lib_id, name, lib_type, latest_month, unique_isbn`

<br/>

## 3. 파일럿 산출물

### 3.1 `kakao_pilot_raw.jsonl` — 카카오 보강 측정 (750건)

`stratum, label, pop, isbn13, loans, pub_year, nl_title, matched, contents_len,
kakao_title, kakao_publisher, kakao_datetime, has_thumbnail, price, status, api_error, contents`

층: A(~2006) / B(2007-14) / C(2015+) / D(정보나루 전용) / E(대출 상위)

### 3.2 `d4l_pilot_parallel.jsonl` — 정보나루 보강 측정 (582건)

`stratum, isbn13, loans, pub_year, kakao_len, kakao_matched, d4l_matched,
d4l_desc_len, d4l_bookname, kw_count, kw_top, description`

**주의**: A층 102건만 유효. B 일부 오염, C·D·E는 쿼터 소진(1일 500건)으로 측정 실패.

<br/>

## 4. Google Books (평가 완료 · 제외)

`database/google_books/` — 스펙 문서, 수집기, 리포트, 샘플 보존.
원본 raw(13,702 volume)는 Git 제외.

<br/>

## 5. 핵심 조인 키

```
모든 소스의 결합축 = isbn13 (정규화 ISBN13, 문자열)

nl_books_derived.isbn13_norm
  ├─ loans_by_isbn.isbn13        (수요·필터·랭킹)
  ├─ holdings.isbn13             (보유 원장, lib_id 로 libraries 연결)
  ├─ nl_url_text.isbn13          (회수 텍스트)
  └─ 파일럿 jsonl.isbn13         (보강 측정)
```

**주의사항**

- ISBN은 반드시 **문자열**로 다룬다. 정수 변환 시 `979` 접두·선행 0이 파괴된다.
- 변환은 **10→13 단방향만** 필요하다 (240건 짝비교로 검증, 불일치 0).
- 도서관 데이터에 체크숫자 오류 0.26% 존재 → 앞 12자리 재계산 폴백으로 회수.
- `loans`는 다년 누적 스톡이다. "최근 N년"은 두 시점 스냅샷의 **차분**으로 만든다.
- 관마다 누적 창 길이가 다르다(60~120개월) → 누적 절대값의 관 간 비교 금지.

<br/>

## 6. 규모 요약

| 파일 | 행 | 크기 |
| --- | --- | --- |
| `nl_books.parquet` | 2,047,239 | 275.3 MB |
| `nl_books_derived.parquet` | 2,047,239 | 93.7 MB |
| `nl_url_text.csv` | 수집 중 (~17만 예상) | ~500 MB |
| `holdings.parquet` | **121,135,896** | 672.8 MB |
| `loans_by_isbn.parquet` | 2,791,309 | 24.9 MB |
| `libraries.parquet` | 1,660 | 0.1 MB |
| 파일럿 jsonl 2종 | 1,332 | 0.8 MB |

합계 약 **1.6 GB** (전부 `project_personal/`, Git 제외)
