# 국립중앙도서관 ISBN 서지정보 API

## 1. 문서 목적

국립중앙도서관 ISBN 서지정보 API를 우리 서비스의 도서 Master Catalog 구축에 활용하기 위한 정리 문서다.

이 API는 ISBN을 중심으로 한 도서 판본의 기본 서지정보를 제공한다. 따라서 개인화 추천의 모든 데이터를 제공하는 API라기보다, 외부 도서 API와 data4library 데이터를 연결하기 위한 기준 카탈로그로 사용한다.

### 프로젝트 내 역할

```text
국립중앙도서관 ISBN API
  -> ISBN/판본 기반 Raw 서지정보
  -> 정규화·유효성 검증·중복 처리
  -> BOOK_EDITION / BOOK_WORK
  -> Elasticsearch 검색 인덱스
  -> 외부 API·대출 통계와 ISBN 기준 JOIN
```

국립중앙도서관 API만으로는 대출량, 사용자 평점, 충분한 책 소개·요약, 협업 필터링 데이터를 만들 수 없다.

### 저장소에 포함한 산출물

| 경로 | 내용 |
| --- | --- |
| `scripts/nl_isbn_collector_adaptive_v2.py` | 날짜 자동 분할·재시도·파트 수집·병합·품질 리포트 생성 코드 |
| `samples/sample_books.jsonl` | 실제 수집 레코드에서 추린 소형 샘플 3건 |
| `samples/sample_books.pretty.json` | 동일한 샘플을 사람이 읽기 좋게 들여쓴 JSON 배열 |
| `reports/data_quality_summary_all_years.txt` | 실제 수집 결과 품질 요약 |
| `reports/missing_report_all_years.csv` | 필드별 결측률과 실제 값 예시 |
| `metadata/range_plan.json` | 날짜별 수집 구간과 건수 |
| `metadata/range_count_cache.json` | 날짜 구간별 API 건수 조회 캐시 |
| `metadata/unresolved_ranges.json` | API 오류로 미해결된 구간 |

### 표준 폴더 구조

```text
국립중앙도서관/
├── NATIONAL_LIBRARY_ISBN_API.md  # API 설명·필드·실제 값·저장 정책
├── scripts/        # 수집·정제 코드
├── raw/            # 원본 응답·대용량 JSONL
├── processed/      # 정제·병합 결과
├── samples/        # Git에 포함하는 소형 샘플
├── reports/        # 품질·결측 리포트
└── metadata/       # 수집 구간·캐시·미해결 구간
```

다른 API 담당자는 이 폴더를 복사한 뒤 API명과 데이터 리소스명만 변경하는 것을 기준으로 한다. 원본·정제 결과는 분리하고, 실제 값이 확인 가능한 작은 샘플과 품질 리포트는 저장소에 포함한다.

`books_all_years.jsonl`과 `parts/` 전체는 약 2.2GB의 생성 결과물이므로 저장소에 넣지 않는다. `.gitignore`로 재생성 결과를 제외하고, 필요할 때 외부 저장소나 로컬 데이터 디렉터리를 `--output-dir`로 지정한다.

### 수집기 실행 방법

```powershell
cd database/국립중앙도서관
python -m pip install requests
$env:NL_API_KEY = "발급받은_API_KEY"
python scripts/nl_isbn_collector_adaptive_v2.py `
  --output-dir "C:\data\nl_isbn_split_output"
```

API 키를 환경변수로 지정하지 않으면 실행 중 입력받는다. 기본 설정은 다음과 같다.

```text
수집 기간       19000101 ~ 20991231
초기 안전 구간  최대 20,000건
기본 page_size  100
납본 여부       Y
전자책 여부     ALL
요청 간격       0.5초
재시도 횟수     5회
```

실행 시 `--output-dir` 아래에 표준 폴더가 자동 생성된다.

```text
{output-dir}/
├── raw/parts/                 # 날짜 구간별 원본 JSONL과 .done.json
├── processed/books_all_years.jsonl
├── reports/
│   ├── missing_report_all_years.csv
│   └── data_quality_summary_all_years.txt
└── metadata/
    ├── range_plan.json
    ├── range_count_cache.json
    └── unresolved_ranges.json
```

완료된 `.done.json` 파트는 재사용하고, API 오류가 발생한 날짜 구간은 자동으로 더 작은 범위로 분할한다. 날짜 단위와 `page_size=1`까지 실패한 구간은 `metadata/unresolved_ranges.json`에 기록한다.

---

## 2. 공식 정보

| 항목 | 내용 |
| --- | --- |
| API명 | ISBN 서지정보 API |
| 기본 URL | `https://www.nl.go.kr/seoji/SearchApi.do` |
| 제공 기관 | 국립중앙도서관 |
| 인증 | `cert_key` 필요 |
| 결과 형식 | JSON 또는 XML |
| 조회 단위 | 페이지 단위 목록 조회 |
| 날짜 검색 | `PUBLISH_PREDATE` 기준 시작일·종료일 조회 |
| 주요 식별자 | `EA_ISBN`, `SET_ISBN`, `CONTROL_NO` |
| 공식 안내 | [ISBN 서지정보 Open API 활용방법](https://www.nl.go.kr/NL/contents/N31101030500.do) |

공식 샘플 요청 형식은 다음과 같다. 인증키는 코드나 문서에 직접 기록하지 않는다.

```text
https://www.nl.go.kr/seoji/SearchApi.do
  ?cert_key={API_KEY}
  &result_style=json
  &page_no=1
  &page_size=10
  &start_publish_date=20220509
  &end_publish_date=20220509
```

### 필수 요청 파라미터

| 파라미터 | 형식 | 설명 |
| --- | --- | --- |
| `cert_key` | String | 발급받은 인증키 |
| `result_style` | String | `json` 또는 `xml` |
| `page_no` | Integer | 1부터 시작하는 페이지 번호 |
| `page_size` | Integer | 페이지당 출력 건수 |

### 검색·정렬 파라미터

| 파라미터 | 설명 | 프로젝트 활용 |
| --- | --- | --- |
| `isbn` | ISBN 검색 | 개별 도서 보강 조회 |
| `set_isbn` | 세트 ISBN 검색 | 세트·낱권 관계 확인 |
| `ebook_yn` | 전자책 여부 `Y/N` | 전자책 판본 필터 |
| `title` | 본표제 검색 | ISBN이 없는 보조 검색. 최종 JOIN 키로 사용하지 않음 |
| `start_publish_date` | 발행예정일 시작일, `yyyymmdd` | 초기 전체 수집 및 기간별 배치 |
| `end_publish_date` | 발행예정일 종료일, `yyyymmdd` | 초기 전체 수집 및 기간별 배치 |
| `cip_yn` | CIP 신청 여부 `Y/N` | 서지 품질 보조 정보 |
| `deposit_yn` | 납본 여부 `Y/N` | 납본 상태 필터 |
| `series_title` | 총서명 | 시리즈 검색·표시 |
| `publisher` | 발행처명 | 발행처 검색 |
| `author` | 저자 | 저자 검색 |
| `form` | 발행제본형태 | 종이책·전자책·오디오북 등의 필터 |
| `sort` | `PUBLISH_PREDATE`, `INPUT_DATE`, `INDEX_TITLE`, `INDEX_PUBLISHER` | 수집 순서 제어 |
| `order_by` | `ASC` 또는 `DESC` | 수집 순서 제어 |

### 오류 코드

| 코드 | 의미 | 처리 |
| --- | --- | --- |
| `000` | 시스템 오류 | 지수 백오프 후 재시도, 반복 실패 구간 기록 |
| `010` | 인증키 누락 | 환경변수·요청 생성부 확인 |
| `011` | 인증키 유효하지 않음 | 키 상태 확인 후 수집 중단 |
| `012` | 필수 파라미터 누락 | 요청 검증 후 재요청 |

---

## 3. 응답 구조

응답에는 페이지 정보와 전체 건수가 포함되고, 그 뒤에 도서별 서지 레코드가 반환된다. 서비스별로 제공 필드가 제한될 수 있으므로 실제 수집 응답을 기준으로 파서를 검증해야 한다.

| 필드 | 공식 의미 | 프로젝트 분류 | 사용 방침 |
| --- | --- | --- | --- |
| `PAGE_NO` | 현재 쪽번호 | 수집 메타데이터 | Raw 수집 로그에만 저장 |
| `TOTAL_COUNT` | 전체 출력 건수 | 수집 메타데이터 | 날짜 구간별 수집 검증 |
| `EA_ISBN` | ISBN | A / E | 핵심 JOIN 키. ISBN-10·13 정규화 |
| `SET_ISBN` | 세트 ISBN | A / E | 세트와 낱권 관계에 사용 |
| `TITLE` | 표제 | A / C / D | Master·검색·화면 표시 |
| `VOL` | 권차 | A / D | 다권본 표시와 판본 구분 |
| `SERIES_TITLE` | 총서명 | A / C / D | 시리즈 검색·표시 |
| `SERIES_NO` | 총서편차 | A / D | 시리즈 내 순서 표시 |
| `AUTHOR` | 저자 | A / C / B | 원문 보존 후 저자명 정규화 |
| `PUBLISHER` | 발행처 | A / C / D | 발행처 검색·표시 |
| `EDITION_STMT` | 판사항 | A / G | 개정판·중쇄·판본 구분 보조 |
| `EA_ADD_CODE` | ISBN 부가기호 | B / C | 독자대상·발행형태·내용분류 Feature 후보 |
| `SET_ADD_CODE` | 세트 부가기호 | G | 세트 검증 보조 |
| `SET_EXPRESSION` | 세트 표현 | D / G | `전2권`, `세트` 등 화면 표시 |
| `PRE_PRICE` | 예정가격 | D / G | 가격 표시. 추천 점수에는 기본적으로 미사용 |
| `REAL_PRICE` | 실제 가격 | D / G | 결측률이 높아 보조 가격 정보로만 사용 |
| `KDC` | 한국십진분류 | B / C | 결측률이 높으므로 존재할 때만 보조 사용 |
| `DDC` | 듀이십진분류 | B / C | 결측률이 높으므로 존재할 때만 보조 사용 |
| `PAGE` | 페이지 | B / D | 숫자형 `page_count`로 파싱 후 페이지 선호도에 사용 |
| `BOOK_SIZE` | 책 크기 | D / G | 화면 표시·판본 보조 |
| `FORM` | 발행제본형태 | A / B / C | 종이책·전자책·오디오북 필터 |
| `FORM_DETAIL` | 형태 상세 | D / G | 제본 형태 화면 표시 |
| `PUBLISH_PREDATE` | 출판예정일 | A / C / D | 예정일로 저장. 실제 출간일로 단정하지 않음 |
| `REAL_PUBLISH_DATE` | 실제 출판일 | A / B / D | 유효한 값만 실제 출간일 후보로 사용 |
| `SUBJECT` | 주제, KDC 대분류 | B / C | 코드→분류명 매핑 후 대분류 Feature |
| `EBOOK_YN` | 전자책 여부 | A / B / C | 판본 타입 및 필터 |
| `CIP_YN` | CIP 신청 여부 | G | 품질 보조 정보. 추천에는 미사용 |
| `CONTROL_NO` | CIP 제어번호 | E / G | ISBN 보조 식별자·변경 추적 |
| `TITLE_URL` | 표지 이미지 URL | D / G | 표지 후보. 외부 API 표지를 우선 검토 |
| `BOOK_TB_CNT_URL` | 목차 URL | B / D | 접근 가능하고 내용이 유효한 경우 텍스트 Feature 후보 |
| `BOOK_INTRODUCTION_URL` | 책소개 URL | B / D | 설명·임베딩 후보이나 결측률이 높음 |
| `BOOK_SUMMARY_URL` | 책요약 URL | B / D | 설명·임베딩 후보이나 결측률이 높음 |
| `PUBLISHER_URL` | 출판사 홈페이지 | D | 화면 표시·출처 링크 |
| `INPUT_DATE` | 등록일 | G | 데이터 이력·신규 수집 판단 |
| `UPDATE_DATE` | 수정일 | G | 변경 감지·재수집 판단 |

분류 기준은 다음과 같다.

- **A. BOOK MASTER 기본정보**: 도서 판본을 식별하고 저장하는 기본 속성
- **B. 추천 Feature**: 정제·검증 후 추천 점수에 사용할 수 있는 속성
- **C. 검색 Feature**: Elasticsearch 검색·필터에 사용할 속성
- **D. 화면 표시용**: 상세 페이지나 추천 이유에 표시할 속성
- **E. 외부 API JOIN용**: 다른 데이터 소스와 연결하는 키
- **F. 품질이 낮아 제외**: 결측·오류가 심해 핵심 로직에서 제외할 속성
- **G. 보조적으로만 사용**: 품질 추적·판본 보조·출처 표시용 속성

---

## 4. 실제 응답 값의 형태

현재 보유한 JSONL은 API 응답의 도서 레코드 부분을 한 줄에 하나씩 저장한 형태다. `PAGE_NO`, `TOTAL_COUNT` 같은 API 응답 래퍼는 현재 JSONL에 저장되어 있지 않으므로, 아래 예시는 실제로 수집된 도서 레코드의 필드값을 기준으로 정리한다.

### 4.1 실제 레코드 예시

아래는 원본에서 확인한 값을 일부 필드만 추려 표현한 것이다. 실제 레코드에는 앞서 정의한 필드들이 함께 존재한다.

```json
{
  "TITLE": "교회행정학",
  "AUTHOR": "저자: 김동일",
  "PUBLISHER": "영성네트워크",
  "EA_ISBN": "9791186150306",
  "EA_ADD_CODE": "03230",
  "SUBJECT": "2",
  "PUBLISH_PREDATE": "20170312",
  "REAL_PUBLISH_DATE": "20170312",
  "PRE_PRICE": "19,000",
  "PAGE": "375 p.",
  "BOOK_SIZE": "신국판",
  "FORM": "",
  "FORM_DETAIL": "",
  "EBOOK_YN": "N",
  "KDC": "",
  "DDC": "",
  "TITLE_URL": "",
  "BOOK_INTRODUCTION": "",
  "BOOK_SUMMARY": ""
}
```

다른 실제 레코드에서는 다음과 같은 값도 확인됐다.

```json
{
  "TITLE": "10시간 만에 영어가 들린다",
  "AUTHOR": "오자키 테츠오 지음 ; 성윤아 옮김",
  "PUBLISHER": "세경멀티뱅크",
  "EA_ISBN": "8985502654",
  "EA_ADD_CODE": "13740",
  "SUBJECT": "7",
  "PUBLISH_PREDATE": "19151015",
  "REAL_PUBLISH_DATE": "",
  "PRE_PRICE": "6000",
  "PAGE": "",
  "EBOOK_YN": "N"
}
```

### 4.2 필드별 실제 값 예시

| 필드 | 실제로 확인된 값 예시 | 값의 특징 |
| --- | --- | --- |
| `TITLE` | `교회행정학`, `(The) Unveiled East`, `외국어 이렇게 하면 잘 할 수 있다` | 제목 원문 보존. 영문 괄호·한자·기호가 포함될 수 있음 |
| `AUTHOR` | `저자: 김동일`, `오자키 테츠오 지음 ; 성윤아 옮김`, `국립산림과학원 [편]` | 저자명과 역할이 한 문자열에 섞임 |
| `PUBLISHER` | `영성네트워크`, `세경멀티뱅크`, `Kessinger Publishing` | 한글·영문 출판사명이 모두 존재 |
| `EA_ISBN` | `8985502654`, `9791186150306`, `0548035784` | ISBN-10·ISBN-13 혼재. 문자열로 처리 |
| `EA_ADD_CODE` | `03230`, `13740`, `93520`, 빈 문자열 | 앞자리 0이 있으므로 숫자 변환 금지 |
| `SUBJECT` | `2`, `4`, `5`, `7`, 빈 문자열 | KDC 대분류 코드가 문자열 숫자로 저장됨 |
| `PUBLISH_PREDATE` | `19070101`, `19151015`, `20170312`, `20500515` | 8자리 문자열. 미래·비정상 값 검증 필요 |
| `REAL_PUBLISH_DATE` | `20170312`, 빈 문자열 | 존재율이 낮음 |
| `PRE_PRICE` | `6000`, `19,000`, `15000`, 빈 문자열 | 쉼표 포함 여부가 일정하지 않음 |
| `PAGE` | `375 p.`, `230 p.`, `약200페이지 내외`, `1161, 187 p.`, 빈 문자열 | 자유 형식. 숫자 파싱 신뢰도 필요 |
| `BOOK_SIZE` | `신국판`, `a4`, `152*225`, 빈 문자열 | 단위와 표기 방식이 일정하지 않음 |
| `FORM` | `종이책`, `전자책`, `단행본`, 빈 문자열 | 한 레코드에서 복합 의미가 나타날 수 있으므로 코드화 전 검증 |
| `FORM_DETAIL` | `무선제본`, `PDF`, `양장본`, 빈 문자열 | 제본·전자 형식이 혼재 |
| `EBOOK_YN` | `Y`, `N` | 전체 레코드에 존재하는 이진 플래그 |
| `KDC` | `227.53`, `811.62`, `228.74`, 빈 문자열 | 값이 있을 때도 문자열로 보존 |
| `DDC` | `294.343`, `895.714`, `294.3927`, 빈 문자열 | 결측률이 높음 |
| `TITLE_URL` | `http://www.nl.go.kr/...jpg`, 빈 문자열 | 표지 이미지 URL 후보. HTTP·HTTPS가 혼재할 수 있음 |
| `BOOK_INTRODUCTION` | 실제 소개 문장, 빈 문자열 | 결측률이 높고 문장 길이가 다양함 |
| `BOOK_SUMMARY` | 실제 요약 문장, 빈 문자열 | 결측률이 매우 높음 |
| `BOOK_INTRODUCTION_URL` | `https://www.nl.go.kr/seoji/fu/ecip/dbfiles/...jpg`, 빈 문자열 | 소개 원문이 이미지·텍스트 URL로 제공될 수 있음 |
| `BOOK_TB_CNT_URL` | `https://www.nl.go.kr/seoji/fu/ecip/dbfiles/...txt`, 빈 문자열 | 목차 원문 URL 후보 |
| `SERIES_TITLE` | `Kessinger Publishing's rare reprints`, `硏究資料`, 빈 문자열 | 총서명이 여러 언어로 존재 |
| `VOL` | `1`, `23`, `1輯`, 빈 문자열 | 숫자와 문자 단위가 섞임 |
| `SERIES_NO` | `23`, `74`, `79`, 빈 문자열 | 권차와 별개인 총서 순번 |
| `SET_EXPRESSION` | `전32권`, `全13卷`, `全14卷`, 빈 문자열 | 세트 정보가 자유 문자열 |
| `RELATED_ISBN` | `9791130309835`, `9791138369855`, 빈 문자열 | 관련 ISBN이 여러 개일 수 있으므로 분리 파싱 필요 |

### 4.3 결측값은 `null`이 아니라 빈 문자열

현재 JSONL에서 결측은 대부분 다음과 같이 온다.

```json
{
  "BOOK_SUMMARY": "",
  "PAGE": "",
  "KDC": "",
  "TITLE_URL": "",
  "REAL_PUBLISH_DATE": ""
}
```

따라서 Java DTO에서 빈 문자열을 그대로 저장하지 말고 정제 단계에서 다음 규칙을 적용한다.

```text
null              -> NULL
""                -> NULL
"   "             -> NULL
앞뒤 공백만 있는 값 -> NULL
```

다만 원본 재처리와 출처 검증을 위해 `raw_payload` 또는 Raw 테이블에는 원래의 빈 문자열을 그대로 보존할 수 있다.

### 4.4 값이 있다고 바로 정상값은 아님

예를 들어 `PUBLISH_PREDATE`는 결측률이 0%지만 다음과 같은 값이 존재한다.

```text
INPUT_DATE       = 20050712
PUBLISH_PREDATE  = 20500515
```

이 값은 파일 분할 구간에 포함되어 실제 샘플에서 확인된 값이다. 그러므로 `PUBLISH_PREDATE`는 다음 검증을 거친 뒤 사용한다.

```text
8자리 숫자인가?
실제 달력 날짜인가?
수집일·INPUT_DATE와 비교했을 때 비정상적으로 먼 미래인가?
REAL_PUBLISH_DATE 또는 외부 API와 충돌하는가?
```

검증에 실패하면 값을 삭제하지 않고 `date_quality = LOW`로 표시하며, 추천의 출간일 Feature에서는 제외한다.

---

## 5. 현재 보유 데이터 분석

분석 대상은 `books_all_years.jsonl`, `missing_report_all_years.csv`, `data_quality_summary_all_years.txt`, `unresolved_ranges.json`, `parts/`, `sample_books.jsonl`이다. 저장소에는 이 중 소형 샘플과 리포트·메타데이터만 포함한다.

### 수집 규모

| 항목 | 값 |
| --- | ---: |
| 날짜 조건 없는 API 전체 건수 | 2,083,201건 |
| 날짜 검색으로 확인한 계획 건수 | 2,044,827건 |
| 실제 수집·병합 건수 | 2,047,239건 |
| 날짜 검색 미포함 추정 건수 | 38,374건 |
| API 전체 대비 최종 커버리지 | 98.2737% |
| 미해결 구간 | 20041130, 454건 |

원본 `books_all_years.jsonl`은 실제 2,047,239줄이며, 원본 `sample_books.jsonl`은 전체 파일의 앞 5,000줄과 동일하다. 저장소의 `samples/sample_books.jsonl`은 문서 검토용으로 추린 실제 레코드 3건이다.

### 필드별 품질

| 필드 | 유효값 또는 결측률 | 판단 |
| --- | ---: | --- |
| `TITLE` | 결측 0.02% | Master·검색 핵심 |
| `PUBLISHER` | 결측 약 0.00% | Master·검색 핵심 |
| `PUBLISH_PREDATE` | 결측 0.00% | 단, 미래·이상 날짜 검증 필요 |
| `EA_ISBN` | 결측 1.25% | ISBN 정규화·체크섬 검증 후 핵심 키 |
| `AUTHOR` | 결측 1.50% | 원문 보존 후 저자명 파싱 |
| `EA_ADD_CODE` | 결측 1.92% | 5자리 문자열로 보존 후 Feature 후보 |
| `SUBJECT` | 결측 3.25% | KDC 대분류 코드 매핑 필요 |
| `PRE_PRICE` | 결측 3.87% | 표시용. 숫자 파싱 필요 |
| `PAGE` | 결측 58.21% | 파싱 성공한 값만 페이지 Feature |
| `REAL_PUBLISH_DATE` | 결측 81.96% | 존재할 때만 실제 출간일 후보 |
| `KDC` | 결측 88.92% | 보조 Feature |
| `DDC` | 결측 93.16% | 보조 Feature |
| `BOOK_INTRODUCTION` | 결측 93.51% | 단독 설명·임베딩 소스로 부적합 |
| `BOOK_TB_CNT` | 결측 93.87% | 단독 설명·임베딩 소스로 부적합 |
| `BOOK_SUMMARY` | 결측 97.96% | 단독 설명·임베딩 소스로 부적합 |
| `REAL_PRICE` | 결측 97.74% | 핵심 가격 필드로 부적합 |

### 확인된 데이터 주의점

1. 대부분의 값은 JSON `null`이 아니라 빈 문자열이다. 정제 단계에서 빈 문자열, 공백, 의미 없는 placeholder를 `NULL`로 통일한다.
2. `EA_ISBN`에는 ISBN-10과 ISBN-13이 섞여 있다. `ISBN10`, `ISBN13`, `isbn13_normalized`를 구분해 저장한다.
3. `EA_ADD_CODE`는 `03230`처럼 앞자리 0이 존재하므로 숫자 타입으로 변환하면 안 된다.
4. `PAGE`는 `375 p.`, `230 p.`, `약200페이지 내외`, `1161, 187 p.`처럼 자유 형식이다. 파싱 성공 여부와 원문을 함께 보존한다.
5. `AUTHOR`는 `지음`, `옮김`, `편`, `...[등]` 등의 역할 정보가 포함된 원문이다. 화면용 저자명과 검색용 저자 토큰을 분리한다.
6. `PUBLISH_PREDATE`는 모든 레코드에 존재하지만, `2050...`과 같은 미래 날짜가 확인됐다. 날짜 형식·달력 유효성·수집일과의 관계를 검사한 뒤 사용한다.
7. `BOOK_INTRODUCTION`, `BOOK_SUMMARY`, `BOOK_TB_CNT`는 값이 있는 레코드도 전체의 일부이므로, 설명이 없다고 해서 도서를 제외하지 않는다.
8. `parts/`의 기간 분할명은 수집을 위한 구간 정보이지, 레코드의 실제 출간일을 보증하지 않는다.

---

## 6. `EA_ADD_CODE` 활용

국립중앙도서관의 부가기호는 5자리다. 공식 구조는 다음과 같다.

```text
EA_ADD_CODE = [독자대상기호 1자리][발행형태기호 1자리][내용분류기호 3자리]
```

예를 들어 `13740`은 다음처럼 분해할 수 있다.

```text
audience_code = 1
publication_form_code = 3
content_code = 740
```

단, 이 코드를 곧바로 자연어 취향으로 해석하지 않는다. 공식 코드표와 실제 레코드의 분포를 확인한 뒤 다음 단계로 사용한다.

```text
EA_ADD_CODE
  -> 5자리 숫자 여부 검증
  -> audience_code / form_code / content_code 분리
  -> 공식 코드표와 JOIN
  -> 검색 필터 및 BOOK DNA Feature 생성
```

추천 Feature 예시는 다음과 같다.

| Feature | 산출 방식 |
| --- | --- |
| `audience_affinity` | 사용자가 높은 평점을 준 책의 독자대상 코드 분포 |
| `publication_form_affinity` | 종이책·전자책·오디오북 등 발행형태 선호도 |
| `content_code_affinity` | 사용자의 선호 내용분류 코드 분포 |
| `audience_match_score` | 사용자 선호 코드와 후보 도서 코드의 일치 점수 |

분류 코드가 없거나 5자리가 아닌 값은 해당 Feature 계산에서 제외하고, 다른 Feature의 가중치를 재정규화한다.

---

## 7. 정규화 및 검증 규칙

### 6.1 공통 문자열

```text
앞뒤 공백 제거
빈 문자열·공백·placeholder -> NULL
원문(raw value)은 별도 보존
```

한글·영문·괄호·부호가 포함된 제목은 원문을 보존한다. 검색용 필드만 별도로 공백·기호 정규화를 적용한다.

### 6.2 ISBN

1. `ISBN`, 하이픈, 공백을 제거한다.
2. 숫자 10자리 또는 13자리인지 확인한다. ISBN-10의 마지막 `X`는 허용한다.
3. 체크섬을 검증한다.
4. ISBN-10은 ISBN-13으로 변환한다.
5. ISBN-13을 외부 API JOIN의 표준 키로 사용한다.
6. 검증 실패 값은 삭제하지 않고 `isbn_valid = false`와 함께 Raw 영역에 보존한다.

권장 속성:

```text
isbn_raw
isbn10
isbn13
isbn_valid
isbn_type
```

### 6.3 날짜

`yyyymmdd` 8자리 형식과 실제 달력 날짜를 모두 검증한다.

```text
PUBLISH_PREDATE      -> publication_planned_date
REAL_PUBLISH_DATE    -> publication_date_candidate
INPUT_DATE           -> source_input_date
UPDATE_DATE          -> source_update_date
```

`PUBLISH_PREDATE`는 출판예정일이므로 `publication_date`로 바로 덮어쓰지 않는다. 미래 날짜, `00000000`, 비정상 월·일, 수집일과의 관계가 이상한 값은 `date_quality = LOW`로 표시한다.

### 6.4 페이지

`PAGE` 원문은 보존하고, 숫자 파싱이 확실한 값만 `page_count`로 저장한다.

| 원문 예시 | 처리 |
| --- | --- |
| `375 p.` | `page_count = 375` |
| `230 p.` | `page_count = 230` |
| `약200페이지 내외` | `page_count = 200`, `confidence = LOW` |
| `1161, 187 p.` | 단일 페이지로 확정하지 않고 원문만 보존 |

추천에서 페이지 Feature를 사용할 때는 `page_count`가 없는 후보를 탈락시키지 않는다.

```text
page_feature가 존재하면 점수에 반영
page_feature가 없으면 해당 가중치를 분모에서 제외하고 나머지 가중치 재정규화
```

### 6.5 가격

`PRE_PRICE`와 `REAL_PRICE`는 쉼표·공백을 제거한 뒤 음수가 아닌 정수로 파싱한다. 가격은 사용자 취향 추천의 핵심 Feature가 아니라 화면 표시용 보조 정보로 사용한다.

---

## 8. 도서 Entity 및 중복 처리

ISBN은 판본 식별자에 가깝기 때문에 작품과 판본을 분리한다.

```text
BOOK_WORK
  - 작품 단위. 같은 작품의 여러 판본을 묶음

BOOK_EDITION
  - ISBN 단위. 종이책·전자책·개정판·세트 낱권을 구분
```

### 식별 우선순위

1. 유효한 ISBN-13
2. ISBN-10을 ISBN-13으로 변환한 값
3. `CONTROL_NO` 보조 식별자
4. ISBN이 없을 때만 제목·저자·출판사·출간일 조합을 후보 키로 사용

제목과 저자가 같다는 이유만으로 ISBN이 다른 판본을 하나의 판본으로 합치지 않는다. 제목·저자 정규화 기반의 작품 그룹핑은 별도의 `work_group_confidence`를 갖는 후보 관계로 처리한다.

### 판본 관계

| 사례 | 처리 |
| --- | --- |
| 개정판 | 별도 `BOOK_EDITION`, 같은 작품이면 `BOOK_WORK` 연결 |
| 종이책·전자책 | ISBN과 `EBOOK_YN` 기준으로 별도 판본 |
| 세트 | 세트 ISBN을 가진 별도 레코드 + 낱권과 관계 연결 |
| ISBN-10·13 | 동일 ISBN의 표현 차이로 정규화하여 하나의 판본 키로 관리 |
| 동일 제목 다른 출판사 | 기본적으로 별도 판본 |
| 다권본 | `VOL`, `SERIES_NO`, `SET_ISBN`을 이용해 관계 저장 |

---

## 9. 우리 서비스의 Source Priority

국립중앙도서관 값을 무조건 모든 필드의 최우선으로 사용하지 않는다. 필드별로 출처 우선순위를 둔다.

| 필드 | 1순위 | 2순위 | 국립중앙도서관 값의 역할 |
| --- | --- | --- | --- |
| ISBN | ISBN 검증을 통과한 국립중앙도서관 | 추가 API | Master·JOIN 기준 |
| 제목 | 국립중앙도서관 또는 ISBN에 연결된 공식 서지 | 추가 API | 기준값. 외부 값은 대체하지 말고 출처별 보존 |
| 저자 | 국립중앙도서관 원문 | 추가 API | 원문·역할 정보를 보존한 기준값 |
| 출판사 | 국립중앙도서관 | 추가 API | 판본 식별 보조 |
| 주제 | 코드 매핑된 국립중앙도서관 `SUBJECT` | KDC·외부 카테고리 | 대분류 기준 |
| 세부 카테고리 | 외부 도서 API 또는 공식 분류 | `EA_ADD_CODE` 내용분류 | 보조 Feature |
| 실제 출간일 | 정확한 출간일을 제공하는 외부 API | 유효한 `REAL_PUBLISH_DATE` | `PUBLISH_PREDATE`는 예정일로 분리 |
| 표지 | 표지 품질·접근성이 좋은 추가 API | `TITLE_URL` | 후보 URL 및 fallback |
| 설명·요약 | 신뢰 가능한 추가 API | `BOOK_INTRODUCTION`, `BOOK_SUMMARY` | 값이 있을 때만 보강 |
| 페이지 | 숫자로 검증된 추가 API | 파싱 성공한 `PAGE` | 페이지 선호도 Feature 후보 |
| 대출량·인기도 | data4library | 없음 | 국립중앙도서관 API에는 없음 |

모든 병합 필드는 다음 메타데이터를 함께 관리하는 것을 권장한다.

```text
field_source
field_source_updated_at
field_confidence
```

외부 API가 값을 제공하더라도 기존 값을 덮어쓰지 않고 Raw와 정규화 값을 별도로 저장한다.

---

## 10. 저장 구조

### 관계형 DB

도서 판본의 정합성, 사용자 서재, 외부 API 출처 관계는 관계형 DB에서 관리한다.

#### `book_work`

```text
id
canonical_title
canonical_author
work_group_confidence
created_at
updated_at
```

#### `book_edition`

```text
id
work_id
isbn13              -- 표준 JOIN 키
isbn10
isbn_raw
isbn_valid
title
author_raw
publisher
series_title
series_no
volume
edition_statement
set_isbn13
set_expression
subject_code
subject_name
audience_code
publication_form_code
content_code
ebook_yn
planned_publication_date
publication_date
page_count
page_raw
price
book_size
cover_url
description
source_input_date
source_update_date
data_quality
created_at
updated_at
```

#### 출처·Raw 데이터

서비스 DB에 원문을 전부 넣기 어렵다면 별도 적재 영역 또는 오브젝트 스토리지에 보관한다.

```text
book_source_record
  - book_edition_id
  - source_name
  - source_key
  - raw_payload
  - collected_at
  - source_updated_at
```

### Elasticsearch

Elasticsearch에는 검색과 추천 후보 생성에 필요한 정제 필드만 저장한다.

```text
book_id
isbn13
title
title_search
author
author_search
publisher
subject_code
subject_name
audience_code
publication_form_code
content_code
ebook_yn
publication_date
page_count
description
description_vector       -- 실제 임베딩 도입 시
cover_url
series_title
is_set
```

사용자 평점, 리뷰, 읽기 상태, 읽기 날짜는 도서 인덱스에 중복 저장하지 않고 관계형 DB에서 관리한다. 추천 계산에 필요한 사용자 BOOK DNA는 별도 집계 테이블 또는 캐시로 관리한다.

---

## 11. 수집·정제 파이프라인

```text
날짜 구간 생성
  -> API 페이지 순회
  -> 원문 응답 저장
  -> 오류·미수집 구간 기록
  -> JSON 필드 추출
  -> 문자열/ISBN/날짜/페이지 정규화
  -> ISBN 기준 중복 제거
  -> BOOK_EDITION upsert
  -> BOOK_WORK 관계 보강
  -> Elasticsearch 색인
```

### 초기 전체 수집

- 날짜 구간을 너무 크게 잡지 않고 기간별로 나눈다.
- `TOTAL_COUNT`와 실제 수집 건수를 구간별로 비교한다.
- 페이지 응답이 비어 있거나 API 오류가 발생하면 해당 날짜 구간을 재시도 목록에 넣는다.
- 한 날짜의 실패가 전체 수집 실패로 이어지지 않도록 `unresolved_ranges`를 별도로 관리한다.
- 수집 완료 후 ISBN-13 중복, ISBN 체크섬 실패, 비정상 날짜, 빈 제목을 품질 리포트로 생성한다.

### 정기 갱신

- `PUBLISH_PREDATE` 또는 `INPUT_DATE` 기준 최근 구간을 주기적으로 재수집한다.
- `UPDATE_DATE`가 변경된 레코드는 Raw를 새로 저장하고 정규화 결과를 upsert한다.
- 레코드 삭제 여부가 API에서 명확하지 않으므로 기존 데이터를 즉시 삭제하지 않는다.
- `EBOOK_YN`, `FORM`, `EDITION_STMT` 변경은 판본 분류에 영향을 줄 수 있으므로 변경 이력을 남긴다.

### 배치와 사용자 요청 분리

| 구분 | 수집 대상 |
| --- | --- |
| 배치 필수 | ISBN, 제목, 저자, 출판사, 주제, 부가기호, 형태, 출판예정일, 표지 URL, 등록·수정일 |
| 배치 보강 | 페이지, 가격, KDC/DDC, 책소개·요약·목차 URL |
| 사용자 요청 시 | 이미 Master에 없는 ISBN의 보조 조회 또는 최신 외부 API 보강 |
| 우리 DB에서 즉시 조회 | 서재, 평점, 리뷰, 독서 상태, BOOK DNA |

사용자 화면 요청마다 국립중앙도서관 API를 호출하지 않는다. API 지연·쿼터·장애가 사용자 서비스로 전파될 수 있으므로 기본은 배치 적재 데이터로 응답한다.

---

## 12. 추천 시스템에서의 사용 범위

### 직접 사용할 Feature

| Feature | 입력 | 계산 예시 |
| --- | --- | --- |
| 주제 유사도 | `SUBJECT`, 매핑된 KDC 대분류 | 사용자 선호 주제 분포와 후보 주제의 내적 |
| 독자대상 적합도 | `EA_ADD_CODE` 첫 자리 | 사용자 선호 독자대상 코드 일치율 |
| 발행형태 적합도 | `EA_ADD_CODE` 둘째 자리, `FORM`, `EBOOK_YN` | 전자책·종이책 선호 일치 점수 |
| 내용분류 유사도 | `EA_ADD_CODE` 뒤 3자리 | 사용자 선호 내용분류와 유사도 |
| 작가 선호도 | `AUTHOR` | 정규화된 저자 ID별 평점 가중 평균 |
| 페이지 적합도 | 파싱된 `page_count` | 사용자의 선호 페이지 구간과 거리 점수 |
| 출간일 선호도 | 검증된 `publication_date` | 신간 선호 시 시간 감쇠 점수 |

### 직접 사용하지 않는 값

- `CIP_YN`, `BIB_YN`, `DEPOSIT_YN`: 데이터 상태이지 취향 Feature가 아님
- `PRE_PRICE`, `REAL_PRICE`: 사용자의 실제 가격 민감도 데이터가 없으면 추천 점수에 넣지 않음
- `TITLE_URL`, `PUBLISHER_URL`: 표시·외부 링크용
- 결측이 심한 `BOOK_SUMMARY`, `BOOK_INTRODUCTION`: 존재할 때만 텍스트 임베딩 후보

추천 점수에 결측 Feature를 0점으로 넣으면 결측이 많은 도서가 불리해진다. 다음처럼 유효한 Feature만으로 가중치를 재정규화한다.

```text
normalized_score
  = sum(weight_i * feature_i * available_i)
    / sum(weight_i * available_i)
```

---

## 13. MVP 우선순위

### MVP에 필수

1. ISBN-10·13 정규화 및 체크섬 검증
2. `BOOK_EDITION` 중심 Master Catalog 저장
3. 제목·저자·출판사·ISBN 검색
4. `SUBJECT`와 `EA_ADD_CODE` 원문 및 분해값 저장
5. 기간별 API 수집·재시도·미해결 구간 기록
6. Elasticsearch 기본 색인
7. 빈 문자열·비정상 날짜·페이지 값 품질 처리

### 있으면 좋음

1. `BOOK_WORK` 작품 그룹핑
2. 표지·책소개 외부 API 보강
3. 페이지 수 정교한 파싱
4. `EA_ADD_CODE` 공식 코드표 기반 자연어 라벨링
5. 필드별 출처·신뢰도 관리
6. 설명 가능한 추천 문구 생성

### 시간 남으면 구현

1. 책소개·목차·요약 임베딩
2. 작품 단위와 판본 단위의 다중 인덱스
3. 세트·총서·개정판 관계 시각화
4. 필드별 변경 이력 화면
5. ISBN이 없는 도서의 제목·저자 후보 매칭

---

## 14. 결론

국립중앙도서관 ISBN API는 다음 용도로 사용한다.

- ISBN 기반 도서 판본 Master Catalog 구축
- 다른 도서 API와의 표준 JOIN 기준 제공
- 제목·저자·출판사·주제·판형·전자책 여부의 기본값 제공
- `EA_ADD_CODE`와 `SUBJECT` 기반의 초기 콘텐츠 Feature 제공
- Elasticsearch 검색 후보의 전체 도서 풀 구성

반대로 다음 용도에는 단독 사용하지 않는다.

- 대출량·인기도 산출
- 사용자 취향 추론
- 충분한 책 설명·요약 기반 임베딩
- 정확한 실제 출간일·페이지·표지의 단일 기준

따라서 이 API의 데이터는 `BOOK_EDITION`의 기준 서지로 저장하고, 설명·표지·대출량·추천 통계는 별도 API와 우리 서비스 행동 데이터로 보강한다.

### 참고 링크

- [국립중앙도서관 ISBN 서지정보 API 활용방법](https://www.nl.go.kr/NL/contents/N31101030500.do)
- [국립중앙도서관 ISBN·ISSN·UCI·납본 시스템](https://www.nl.go.kr/seoji/contents/S20101050000.do)
- [ISBN 구조 및 부가기호 안내 PDF](https://www.nl.go.kr/seoji/resource/manual/user_isbn_manual.pdf)
