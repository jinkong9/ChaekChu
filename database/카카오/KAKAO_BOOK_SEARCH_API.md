# 카카오 도서 검색 API

## 1. 프로젝트 내 역할

카카오 도서 검색 API는 책 소개, 저자, 번역자, 표지, 가격, 판매 상태를 보강하는 데이터 소스다.
국립중앙도서관 ISBN 서지정보의 `EA_ISBN`을 입력으로 조회하고, `isbn13_normalized`를 기준으로 조인한다.

```text
국립중앙도서관 EA_ISBN
  -> 카카오 도서 검색 (target=isbn)
  -> raw 응답 보존
  -> ISBN-10/13 정규화·중복 제거
  -> BOOK_EDITION 보강 / 검색·추천·상세 화면 데이터
```

카카오는 검색 API이므로 전체 카탈로그 덤프를 제공하지 않는다. 따라서 입력 ISBN 집합에 포함된 도서만 조회 가능하며, 검색 결과의 `is_end`까지 페이지를 순회한다.

## 2. 공식 정보

| 항목 | 내용 |
| --- | --- |
| API명 | Daum 검색 - 책 검색 |
| URL | `GET https://dapi.kakao.com/v3/search/book` |
| 인증 | `Authorization: KakaoAK {REST_API_KEY}` |
| 환경 변수 | `KAKAO_REST_API_KEY` |
| 공식 문서 | https://developers.kakao.com/docs/ko/daum-search/dev-guide |
| 일간 쿼터 | 책 검색 30,000건(변경 가능) |

실제 요청 예시(키는 절대 기록하지 않음):

```text
GET https://dapi.kakao.com/v3/search/book?query=9788996991342&target=isbn&page=1&size=50
Authorization: KakaoAK {KAKAO_REST_API_KEY}
```

## 3. 응답 및 필드 저장 정책

응답 래퍼는 `meta`와 `documents`로 구성된다. `raw/books_raw_YYYYMMDD.jsonl`의 한 줄은 요청값, 수집 시각, HTTP 상태, API 원본 `response` 전체를 보존한다.

`processed/books_normalized_YYYYMMDD.jsonl`은 API 문서의 도서 필드를 빠짐없이 보존하면서 다음 조인용 필드를 더한다.

| 필드 | 형식 | 결측 표현 | 사용 |
| --- | --- | --- | --- |
| `title` | String | `""` | 기본 정보·검색·표시 |
| `contents` | String | `""` | 소개·텍스트 추천 Feature |
| `url` | String | `""` | 출처 링크 |
| `isbn` | String | `""` | 원본 JOIN 키 보존 |
| `isbn10_normalized` | String/null | `null` | 보조 JOIN 키 |
| `isbn13_normalized` | String/null | `null` | 핵심 JOIN 키 |
| `datetime` | ISO-8601 String | `""` | 출간일 후보 |
| `authors` | String[] | `[]` | 저자·검색·추천 Feature |
| `publisher` | String | `""` | 출판사·검색 |
| `translators` | String[] | `[]` | 화면 표시 |
| `price` | Integer | `-1` | 정가 표시 |
| `sale_price` | Integer | `-1` | 판매가 표시 |
| `thumbnail` | String | `""` | 표지 후보 |
| `status` | String | `""` | 판매 상태 표시(분류/점수화 금지) |

`isbn`에 ISBN-10과 ISBN-13이 함께 있으면 공백으로 구분될 수 있으므로 숫자와 `X`만 남긴 후 각각 분리한다. ISBN-13을 우선 중복 키로 사용하고, 없으면 ISBN-10, 그마저 없으면 제목·저자·출판사 조합으로 중복을 제거한다.

## 4. 저장 구조와 대용량 정책

```text
카카오/
├── KAKAO_BOOK_SEARCH_API.md
├── scripts/kakao_book_collector.py
├── raw/                 # 원본 API 응답, Git 제외
├── processed/           # 정제 결과, Git 제외
├── samples/             # 검토 가능한 소형 실제 응답 샘플
├── reports/             # 건수·결측·중복 요약
└── metadata/            # 입력 계획·실패 요청 기록
```

전체 ISBN 수집 결과는 커질 수 있어 Git에 커밋하지 않는다. 실행 시 `--output-dir`로 외부 대용량 저장소를 지정할 수 있다.

## 5. 수집 실행

파이썬 표준 라이브러리만 사용하며, 프로젝트 루트의 `.env` 또는 운영체제 환경 변수에서 키를 읽는다.

```powershell
cd database/카카오

# 제목 검색: 지정한 검색어의 모든 페이지(최대 50페이지)를 조회
python scripts/kakao_book_collector.py --query "미움받을 용기"

# 국립중앙도서관 JSONL의 EA_ISBN으로 카카오 정보를 보강
python scripts/kakao_book_collector.py `
  --input-jsonl "C:\data\books_all_years.jsonl" `
  --isbn-field EA_ISBN `
  --limit 30000 `
  --output-dir "C:\data\kakao_books"
```

HTTP 오류와 재시도 초과 요청은 `metadata/unresolved_ranges.json`에 기록한다. 실행 후 생성되는 품질 요약, 필드별 결측 리포트, 입력 계획도 같은 출력 경로에 함께 저장된다.

### 일일 쿼터 배치 수집

국립중앙도서관 전체 원본 JSONL이 로컬에 없을 때 사용할 보조 수집기다. 카카오가 전체 목록 덤프를 제공하지 않으므로, 한글 제목 검색어를 넓게 생성해 `size=50`과 페이지 순회로 수집한다. Raw는 1,000요청 단위 파트로 나누며, 중간 종료 후 같은 명령을 다시 실행하면 미완료 페이지부터 이어서 수집한다.

```powershell
python scripts/kakao_book_quota_collector.py --max-requests 29999
```

이 프로젝트에서 실제 응답 검증 1회가 먼저 실행된 경우, 위 29,999회와 합쳐 일일 쿼터 30,000회를 넘지 않도록 한다. `429` 응답을 받으면 즉시 중단하고 `metadata/unresolved_ranges.json`에 남긴다.
