# 카카오 도서 검색 API

## 1. 문서 목적

카카오 도서 검색 API를 국립중앙도서관 ISBN Master Catalog의 보강 데이터로 사용하기 위한 수집·저장 규칙이다. 국립중앙도서관의 `EA_ISBN`을 `target=isbn`으로 조회하고 `isbn13_normalized`를 기준으로 조인한다.

```text
국립중앙도서관 EA_ISBN
  -> 카카오 도서 검색
  -> raw/parts에 도서 한 권당 JSONL 한 줄
  -> 파트 완료 표시(.done.json)와 중단 재개
  -> 원본 필드 병합·중복 제거(books_merged)
  -> ISBN 검증·정규화(books_normalized)
  -> BOOK_EDITION 보강 / 검색·추천·상세 화면 데이터
```

카카오는 검색 API이므로 전체 카탈로그 덤프를 제공하지 않는다. ISBN 입력 집합에 포함된 도서를 보강하는 것이 기본이며, 제목 검색 순회는 전체 카탈로그를 보장하지 않는 보조 수집 방식이다.

### 저장소에 포함한 산출물

| 경로 | 내용 |
| --- | --- |
| `scripts/kakao_book_common.py` | 두 수집기가 공유하는 Raw·ISBN 정규화·중복 제거·상세 리포트 코드 |
| `scripts/kakao_book_collector.py` | ISBN/제목 입력 파트 수집·재개·병합 코드 |
| `scripts/kakao_book_quota_collector.py` | 제목 검색 일일 쿼터 파트 수집 코드 |
| `scripts/migrate_kakao_v1_to_v2.py` | 기존 응답 래퍼 Raw를 도서 단위 v2 파트로 무호출 변환 |
| `tests/test_kakao_book_common.py` | ISBN·Raw 단위·중복 제거·리포트 계약 테스트 |
| `samples/sample_books.jsonl` | 변환된 254,640개 고유 도서에서 추린 정규화 샘플 10건 |
| `samples/sample_books.pretty.json` | 동일 샘플의 가독성 JSON 배열 |
| `reports/missing_report_quota_crawl.csv` | 전체 변환 결과의 결측·타입·이상값·실제 값 예시 |
| `reports/data_quality_summary_quota_crawl.txt` | 기존 수집분 429,399건의 병합·중복 제거 품질 요약 |
| `metadata/range_plan.json` | v1 8개 파트의 v2 변환 계획과 파트별 건수 |
| `metadata/range_count_cache.json` | 기존 검색어 1,979개의 관측 건수·페이지 캐시 |
| `metadata/data_manifest.json` | 팀 전달용 대용량 파일명·건수·용량·SHA-256 |
| `metadata/unresolved_ranges.json` | 재시도 후에도 실패한 요청 |
| `metadata/COLLECTION_METADATA_GUIDE.md` | 메타데이터 파일 역할과 Git 포함 정책 |

## 2. 공식 정보

| 항목 | 내용 |
| --- | --- |
| API명 | Daum 검색 - 책 검색 |
| URL | `GET https://dapi.kakao.com/v3/search/book` |
| 인증 | `Authorization: KakaoAK {REST_API_KEY}` |
| 환경 변수 | `KAKAO_REST_API_KEY` |
| 공식 문서 | https://developers.kakao.com/docs/ko/daum-search/dev-guide |
| 일간 쿼터 | 책 검색 30,000건(변경 가능) |

```text
GET https://dapi.kakao.com/v3/search/book?query=9788996991342&target=isbn&page=1&size=50
Authorization: KakaoAK {KAKAO_REST_API_KEY}
```

## 3. 표준 폴더 구조

[`database/API_DATA_STANDARD.md`](../API_DATA_STANDARD.md)와 국립중앙도서관·알라딘 수집기의 파트 구조를 따른다.

```text
카카오/
├── KAKAO_BOOK_SEARCH_API.md
├── .gitignore
├── scripts/
├── tests/
├── raw/
│   └── parts/                  # Git 제외
├── processed/                  # Git 제외
├── samples/                    # Git 포함 소형 실제 샘플
├── reports/                    # Git 포함 품질 리포트
└── metadata/                   # 계획·캐시·미해결 요청
```

전체 Raw·Processed 결과는 크고 재생성할 수 있으므로 Git에 올리지 않는다. `raw/README.md`, `processed/README.md`, 소형 샘플, 품질 리포트와 재현에 필요한 메타데이터만 저장소에 포함한다.

## 4. Raw 저장 계약

`raw/parts/*.jsonl`은 **도서 한 권당 한 줄**이다. `meta`·`documents` 응답 래퍼 전체를 한 줄로 저장하지 않는다. API의 도서 필드는 그대로 보존하고 수집 추적 필드만 `_` 접두사로 추가한다.

```json
{
  "title": "미움받을 용기",
  "isbn": "8996991341 9788996991342",
  "authors": ["기시미 이치로", "고가 후미타케"],
  "publisher": "인플루엔셜",
  "_source_query": "9788996991342",
  "_source_target": "isbn",
  "_source_page": 1,
  "_http_status": 200,
  "_collected_at": "2026-08-24T08:20:24.202959+00:00"
}
```

ISBN 입력은 기본 500개, 제목 쿼터 수집은 HTTP 요청 1,000회 단위로 파트를 만든다.

```text
raw/parts/
├── isbn_000001.jsonl
├── isbn_000001.done.json
├── query_000001.jsonl
├── query_000001.done.json
├── title_000001.jsonl
└── title_000001.done.json
```

수집 중에는 `.part`에 쓰고 파트가 끝난 뒤 `.jsonl`로 바꾼 다음 `.done.json`을 기록한다. `.done.json`이 함께 있는 파트는 재실행 시 건너뛴다. 실패 요청은 `metadata/unresolved_ranges.json`에 남긴다.

```json
{
  "name": "isbn_000001",
  "scope": "isbn",
  "status": "completed",
  "input_count": 500,
  "request_count": 500,
  "document_count": 463,
  "unresolved_request_count": 0,
  "completed_at": "2026-08-25T00:00:00+00:00",
  "stop_reason": "completed"
}
```

## 5. 병합·정규화 계약

완료된 파트만 병합하며 결과를 두 단계로 분리한다.

| 파일 | 처리 |
| --- | --- |
| `processed/books_merged_{date}.jsonl` | Raw 파트를 병합하고 중복만 제거한다. API 원본 필드와 `_source_*` 수집 메타데이터를 그대로 유지한다 |
| `processed/books_normalized_{date}.jsonl` | 병합 결과에 ISBN 검증·변환과 결측 타입 통일을 적용한다 |

제목 쿼터 수집은 파일명에 `_quota_`가 추가된다. 두 수집기는 `kakao_book_common.py`의 같은 병합·정규화 함수를 사용한다. 정규화 결과에는 다음 조인·검증 필드를 추가한다.

| 필드 | 형식 | 결측 표현 | 사용 |
| --- | --- | --- | --- |
| `title` | String | `""` | 기본 정보·검색·표시 |
| `contents` | String | `""` | 소개·텍스트 추천 Feature |
| `url` | String | `""` | 출처 링크 |
| `isbn` | String | `""` | API 원본 JOIN 값 |
| `isbn_raw` | String | `""` | 정규화 전 ISBN 보존 |
| `isbn10_normalized` | String/null | `null` | 유효한 ISBN-10 |
| `isbn13_normalized` | String/null | `null` | 유효한 ISBN-13 또는 ISBN-10 변환값 |
| `isbn_valid` | Boolean | `false` | ISBN 체크섬 검증 결과 |
| `isbn_type` | String | `MISSING` | `BOTH/ISBN13/ISBN10/INVALID/MISSING` |
| `datetime` | ISO-8601 String | `""` | 출간일 후보 |
| `authors` | String[] | `[]` | 저자·검색·추천 Feature |
| `publisher` | String | `""` | 출판사·검색 |
| `translators` | String[] | `[]` | 화면 표시 |
| `price` | Integer/null | `null` | 정가 표시 |
| `sale_price` | Integer/null | `null` | 판매가 표시 |
| `thumbnail` | String | `""` | 표지 후보 |
| `status` | String | `""` | 판매 상태 표시 |
| `source_query` | String | `""` | 수집에 사용한 ISBN·검색어 |
| `source_target` | String/null | `null` | `isbn/title` 등 검색 대상 |
| `source_page` | Integer | `1` | 원본 검색 페이지 |
| `collected_at` | ISO-8601 String | 없음 | 수집 시각 |

ISBN-10·13은 체크섬을 검증한다. ISBN-10만 유효하면 ISBN-13으로 변환한다. 중복 제거 키 우선순위는 `ISBN-13 → ISBN-10 → 제목+저자+출판사+출간일`이다. 가격 결측은 숫자 `-1`이 아니라 JSON `null`로 저장한다.

## 6. 품질 리포트

`missing_report_{scope}.csv`는 국립중앙도서관·알라딘과 같이 결측 건수뿐 아니라 키 존재, 자료형, 유효·이상값 예시를 함께 기록한다.

```text
field,total_count,key_present_count,key_missing_count,null_count,blank_count,
empty_array_count,invalid_count,effective_missing_count,
effective_missing_rate_percent,zero_count,zero_rate_percent,types,
example_valid_values,example_invalid_values
```

요약 리포트에는 완료 파트, Raw·고유·중복 도서, 잘못된 JSON, 유효하지 않은 ISBN, 미해결 요청 수와 결측률 상위 필드를 기록한다.

## 7. 수집 실행

파이썬 표준 라이브러리만 사용하며 프로젝트 루트 `.env` 또는 운영체제 환경 변수에서 키를 읽는다.

```powershell
cd database/카카오
$env:KAKAO_REST_API_KEY = "발급받은_REST_API_KEY"

# 제목 검색
python scripts/kakao_book_collector.py --query "미움받을 용기"

# 국립중앙도서관 EA_ISBN 보강
python scripts/kakao_book_collector.py `
  --input-jsonl "C:\data\books_all_years.jsonl" `
  --isbn-field EA_ISBN `
  --output-dir "C:\data\kakao_books"

# API 호출 없이 ISBN 완료 파트 병합·리포트 재생성
python scripts/kakao_book_collector.py `
  --merge-only --merge-scope isbn `
  --output-dir "C:\data\kakao_books"
```

### 일일 쿼터 제목 수집

국립중앙도서관 ISBN 원본이 없을 때 사용하는 보조 방식이다. 실행별 요청 한도와 전체 수집 위치를 분리해 관리하므로 다음 날 같은 명령으로 이어갈 수 있다.

```powershell
python scripts/kakao_book_quota_collector.py `
  --max-requests 29999 `
  --output-dir "C:\data\kakao_title_v2"
```

제목 검색 순회는 검색 노출 범위만 수집하며 전체 카탈로그 커버리지를 의미하지 않는다. HTTP 재시도를 포함한 실제 요청 시도 수를 쿼터로 계산하고 `429`를 받으면 상태를 보존한 채 종료한다.

기존 `books_raw_part_*.jsonl`은 v1 응답 래퍼 형식이다. v2는 `isbn_`, `query_`, `title_` 접두사를 사용해 기존 파일과 섞이지 않는다. 기존 대용량 Raw를 Git에 추가하거나 덮어쓰지 않는다.

### 기존 v1 데이터 변환

API를 다시 호출하지 않고 기존 응답의 `response.documents`를 펼쳐 v2 파트와 전체 병합·정규화 결과를 만든다.

```powershell
python scripts/migrate_kakao_v1_to_v2.py `
  --output-dir "C:\data\kakao_books" `
  --stamp 20260824
```

현재 로컬 변환 결과는 다음과 같다.

```text
v1 물리 요청 행                  10,665
v2 도서 단위 Raw                429,399
병합·중복 제거 고유 도서         254,640
유효하지 않은 ISBN                5,235
재개 위치                         query_index=1978, page=3, title_000009
```

v1 8번 파트의 유효 레코드 11,599건도 `title_000008.jsonl`로 닫아 병합 대상에 포함했다. 이후 제목 수집은 같은 검색 커서에서 `title_000009.part`로 이어진다. v1 원본 파일은 검증·롤백용으로 그대로 보존한다.

대용량 Raw·Processed는 Git에 포함되지 않는다. 다른 팀원에게는 `processed/books_normalized_quota_20260824.jsonl`을 공유 저장소로 전달하고, Git에 포함된 `metadata/data_manifest.json`의 파일 크기와 SHA-256으로 동일 파일인지 검증한다.
