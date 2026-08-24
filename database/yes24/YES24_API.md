# YES24 Open API

## 1. 문서 목적

YES24 Open API를 국립중앙도서관 ISBN 서지정보의 외부 보강 소스로 활용하기 위한 정리 문서다.

국립중앙도서관 데이터의 유효한 ISBN-13을 기준으로 YES24 상품 상세를 조회하면 표지, 실제 판매 페이지, 책 소개, 목차, 페이지 수, 가격, 평점, 시리즈 등의 값을 추가로 확보할 수 있다. YES24 값은 기준 서지를 무조건 덮어쓰는 값이 아니라 출처가 다른 보강 데이터로 별도 보존한다.

### 프로젝트 내 역할

```text
국립중앙도서관 EA_ISBN
  -> ISBN-10/13 검증·ISBN-13 정규화
  -> YES24 itemDetail(detail=Y)
  -> 원본 응답 저장
  -> 필드별 품질 검증
  -> BOOK_EDITION 외부 출처 보강
  -> 화면 표시·검색·추천 Feature 후보
```

YES24 API만으로 국립중앙도서관의 KDC·주제 분류나 도서관 정보나루의 대출 통계를 대체하지 않는다. `salePoint`, `starScore` 역시 YES24 내부 상품 지표이므로 공공 대출량이나 전체 독서 시장의 인기도로 해석하지 않는다.

### 저장소에 포함한 산출물

| 경로 | 내용 |
| --- | --- |
| `scripts/yes24_isbn_collector.py` | ISBN 검증·상세 조회·재시도·재개 수집기 |
| `scripts/yes24_seed_collector.py` | 별도 ISBN 원본이 없을 때 YES24 신상품 목록에서 후보 ISBN을 만드는 수집기 |
| `scripts/yes24_quality_report.py` | 실제 상세 결과의 결측·중복·ISBN 일치율 리포트 및 샘플 생성기 |
| `samples/sample_yes24_books.jsonl` | 실제 수집 레코드에서 추린 소형 샘플 3건 |
| `samples/sample_yes24_books.pretty.json` | 동일한 샘플을 사람이 읽기 좋게 들여쓴 JSON 배열 |
| `reports/data_quality_summary_collected_20260824.txt` | 2026-08-24 실제 상세 요청 19,754건의 품질 요약 |
| `reports/missing_report_collected_20260824.csv` | 필드별 결측률·0 값·실제 예시 |
| `metadata/collection_run_20260824.json` | 수집 범위·호출 수·산출물·중단 상태 메타데이터 |
| `metadata/COLLECTION_METADATA_GUIDE.md` | 체크포인트와 실행 메타데이터 설명 |

샘플의 제목·저자·ISBN·가격 등은 실제 값이다. 책 소개·요약·목차의 긴 본문은 저장소 샘플에서 길이 메타데이터로 대체했으며 원문은 Git에서 제외한 `raw/` 파일에만 보존한다.

### 표준 폴더 구조

```text
yes24/
├── YES24_API.md
├── .env.example
├── .gitignore
├── scripts/
├── raw/          # API 원본·ISBN 후보. Git 제외
├── processed/    # 향후 정규화·병합 결과. Git 제외
├── samples/      # 검토 가능한 소형 샘플
├── reports/      # 품질·결측 리포트
├── metadata/     # 체크포인트·실행 메타데이터
└── tests/
```

### 현재 로컬 대용량 산출물

| 경로 | 건수 | 크기 | Git 포함 |
| --- | ---: | ---: | --- |
| `raw/yes24_seed_raw_20260824.jsonl` | 고유 ISBN 후보 20,000건 | 약 51.3MB | 제외 |
| `raw/yes24_detail_raw_20260824.jsonl` | 상세 요청 19,754건 | 약 66.2MB | 제외 |
| `raw/yes24_detail_smoke_raw_20260824.jsonl` | 초기 연동 확인 기록 6줄 | 약 5KB | 제외 |

현재 대용량 파일은 이 작업 PC의 위 상대 경로에만 있다. 팀 공유 저장소 위치는 아직 정해지지 않았으므로 파일을 재현하거나 별도 공유 스토리지로 전달해야 한다.

---

## 2. 공식 정보

| 항목 | 내용 |
| --- | --- |
| API명 | YES24 Open API |
| 기본 URL | `https://apis.yes24.com` |
| 제공 기관 | YES24 |
| 인증 | 요청 헤더 `X-Api-Key` |
| 결과 형식 | JSON |
| 목록 조회 | `GET /v1/category/newproduct` |
| 상세 조회 | `GET /v1/goods/itemDetail` |
| 주요 식별자 | `isbn13`, `itemId` |
| 공식 안내 | [YES24 Developers](https://developers.yes24.com/) |

API 키는 쿼리스트링이나 코드에 넣지 않고 서버 측 환경변수 또는 `.env`에서 읽는다.

```http
X-Api-Key: {YES24_API_KEY}
Accept: application/json
```

프런트엔드에 API 키를 포함하지 않는다. 서비스에서 실시간 조회가 필요하더라도 `브라우저 -> 백엔드 -> YES24 API` 구조를 사용한다.

---

## 3. 요청 방식

### 3.1 ISBN13 상품 상세 조회

공식 문서: [상품 상세 조회](https://developers.yes24.com/api-doc/goods-item-detail)

```text
GET https://apis.yes24.com/v1/goods/itemDetail
  ?searchType=ISBN13
  &query=9788966260959
  &detail=Y
```

| 파라미터 | 필수 | 형식 | 프로젝트 사용 |
| --- | --- | --- | --- |
| `searchType` | 필수 | `ISBN13` 또는 `ItemId` | 국립중앙도서관과 JOIN할 때 `ISBN13` 사용 |
| `query` | 필수 | ISBN-13 또는 상품 번호 | 체크섬 검증을 통과한 ISBN-13 |
| `detail` | 선택 | `Y` 또는 `N` | 페이지·평점·시리즈 등을 위해 `Y` 사용 |

`detail=Y`를 지정해야 `subTitle`, `pages`, `starScore`, `series`, 규격 등의 확장 필드가 제공된다.

### 3.2 신상품 목록에서 ISBN 후보 생성

국립중앙도서관 전체 JSONL이 로컬에 없었던 2026-08-24 실행에서는 YES24 목록 API로 상세 조회 후보를 먼저 만들었다.

공식 문서: [신상품 조회](https://developers.yes24.com/api-doc/category-newproduct)

```text
GET https://apis.yes24.com/v1/category/newproduct
  ?categoryId=001
  &sort=RegDate
  &page=1
  &pageSize=100
  &detail=N
```

| 파라미터 | 프로젝트 값 | 설명 |
| --- | --- | --- |
| `categoryId` | `001`, `002`, `017` | 국내도서, 외국도서, eBook 후보 순회 |
| `sort` | `RegDate` | 등록일 기준 신상품 |
| `page` | 1부터 증가 | 체크포인트로 다음 페이지 저장 |
| `pageSize` | 100 | 공식 최대 페이지 크기 |
| `detail` | `N` | 후보 단계에서는 ISBN과 기본 정보만 확보 |

국립중앙도서관 전체 JSONL을 사용할 수 있을 때는 이 후보 생성 단계를 생략하고 `EA_ISBN`을 직접 상세 수집기에 입력한다.

### 3.3 호출 한도와 오류 처리

호출량은 배치 실행 전에 [YES24 Open API FAQ](https://developers.yes24.com/support/faq)와 이용 현황에서 다시 확인한다. 2026-08-24 기준 공식 안내의 Basic 한도는 일 20,000회, 초당 10회이며 정책은 변경될 수 있다.

| HTTP | 오류 코드 | 의미 | 수집기 처리 |
| ---: | --- | --- | --- |
| 401 | `AUTH_001` | API 키 헤더 누락 | 즉시 중단 |
| 401 | `AUTH_002` | 유효하지 않은 API 키 | 즉시 중단 |
| 429 | `RATE_001` | 초당 호출량 초과 | `Retry-After` 또는 지수 백오프 후 재시도 |
| 429 | `RATE_002` | 일일 호출량 초과 | 현재 결과를 보존하고 즉시 정상 중단 |
| 400 | `PARAM_004` | ISBN13 또는 ItemId 형식 오류 | 입력 검증 실패로 기록 |
| 404 | `GOODS_002` | ISBN13 상품 없음 | `not_found`로 기록 |
| 500/503 | `INTERNAL_ERROR`, `UPSTREAM_UNAVAILABLE` | 서버·연동 일시 장애 | 지수 백오프 후 재시도 |

---

## 4. 응답 구조

모든 API는 공통 래퍼를 사용한다.

```json
{
  "success": true,
  "message": "성공",
  "errorCode": null,
  "data": {
    "meta": {
      "apiTitle": "상품 상세 조회",
      "apiLink": "...",
      "pubDate": "...",
      "version": "v1"
    },
    "items": [],
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1
  }
}
```

현재 수집기는 한 ISBN 요청의 추적 정보를 공통 래퍼와 함께 JSONL 한 줄로 저장한다.

```json
{
  "source": "YES24",
  "collectedAt": "2026-08-24T00:00:00+00:00",
  "request": {
    "rawIsbn": "9791162574317",
    "isbn13": "9791162574317",
    "detail": "Y"
  },
  "status": "success",
  "response": {
    "success": true,
    "message": "성공",
    "errorCode": null,
    "data": {
      "items": []
    }
  }
}
```

### 상품 필드

| 필드 | 실제 자료형 | 프로젝트 분류 | 사용 방침 |
| --- | --- | --- | --- |
| `itemId` | Integer | E / G | YES24 내부 상품 식별자. 출처 추적·재조회 키 |
| `title` | String | A / C / D | 기준 서지와 충돌 여부 확인 후 표시·검색 보강 |
| `subTitle` | String | A / C / D | 빈 문자열 허용. 부제 보강 |
| `author` | String | A / C / D | 원문 보존 후 저자명·역할 정규화 |
| `goodsType` | String | A / C | 도서 여부 검증 |
| `goodsSortNm` | String | B / C / D | YES24 세부 상품 분류. KDC를 대체하지 않음 |
| `adultYn` | String | B / C | 성인물 필터 |
| `publisher` | String | A / C / D | 판본 일치 검증·표시 보강 |
| `isbn10` | String/null | E / G | 존재할 때 검증 후 보조 식별자 |
| `isbn13` | String | A / E | 국립중앙도서관과의 기본 JOIN 키 |
| `shopPrice` | Number | D / G | 정가 표시 후보 |
| `salePrice` | Number | D / G | 수집 시점 판매가. 변경 가능한 스냅샷 |
| `publishDate` | String | A / B / D | `yyyyMMdd` 검증 후 실제 출간일 후보 |
| `itemStatus` | String | D / G | 판매 상태 스냅샷 |
| `yesPoint` | Integer | G | YES 포인트. 추천 핵심 Feature로 사용하지 않음 |
| `salePoint` | Integer | B / G | YES24 판매지수. 출처·수집 시각과 함께 보조 인기도로만 사용 |
| `fixedBookPriceYn` | String | G | 도서정가제 여부 |
| `pages` | Integer | B / D | 0보다 큰 값만 페이지 수 후보로 사용 |
| `weight`, `width`, `length`, `height` | Integer/null | D / G | 0보다 큰 값만 규격 정보로 사용 |
| `itemFormat` | String/null | D / G | 판형·제본 보조 정보 |
| `starScore` | Number | B / D | 리뷰 수가 없으므로 0은 미평가 가능성이 있어 결측 취급 권장 |
| `cover` | String | D | 표지 이미지 후보 |
| `link`, `mobileLink` | String | D / G | YES24 원본 상품 페이지 |
| `addOnLink` | String | G | 애드온 미신청 시 빈 문자열 |
| `eBookLink`, `ebookId` | String/Integer/null | A / D / G | 연결 eBook 판본 후보 |
| `contentDetail.bookIntroduction` | String/null | B / C / D | 설명·임베딩 후보 |
| `contentDetail.bookSummary` | String/null | B / C / D | 줄거리 후보. 실제 결측률이 매우 높음 |
| `contentDetail.tableOfContents` | String/null | B / C / D | 검색·임베딩 보조 후보 |
| `series` | Array | A / C / D | 시리즈 ID·이름 보강 |

분류 기준은 국립중앙도서관 문서와 동일하다.

- **A. BOOK MASTER 기본정보**
- **B. 추천 Feature 후보**
- **C. 검색 Feature 후보**
- **D. 화면 표시용**
- **E. 외부 API JOIN용**
- **F. 품질이 낮아 제외**
- **G. 출처·시점 의존 보조 정보**

---

## 5. 실제 응답 값의 형태

### 5.1 실제 레코드 예시

2026-08-24 수집분에서 확인한 일부 필드다. 긴 소개·목차는 저장소 샘플에서 본문 대신 길이만 표시한다.

```json
{
  "itemId": 195285696,
  "title": "ROS2 로봇제작 1472",
  "author": "이제원,허윤경,김자경 공저",
  "goodsType": "도서",
  "goodsSortNm": "국내도서-대학교재",
  "publisher": "구미서관",
  "isbn10": "1162574313",
  "isbn13": "9791162574317",
  "shopPrice": 27000.0,
  "salePrice": 27000.0,
  "publishDate": "20260923",
  "pages": 396,
  "starScore": 0,
  "contentDetail": {
    "bookIntroduction": "<omitted from repository sample; length=373>",
    "bookSummary": null,
    "tableOfContents": "<omitted from repository sample; length=205>"
  },
  "series": []
}
```

### 5.2 필드별 실제 값 특징

| 필드 | 실제 값 예시 | 주의점 |
| --- | --- | --- |
| `title` | `ROS2 로봇제작 1472`, `죽은 자를 위한 축제`, `고독서정` | 제목 원문 보존 |
| `author` | `이제원,허윤경,김자경 공저`, `한성규 저` | 이름·역할·구분자가 한 문자열에 혼재 |
| `goodsSortNm` | `국내도서-대학교재`, `국내도서-소설/시/희곡`, `국내도서-인문` | YES24 분류 체계이며 KDC와 별도 보존 |
| `shopPrice` | `27000.0`, `14000.0` | JSON Number. 정수 여부 확인 후 저장 가능 |
| `publishDate` | `20260923`, `20260820`, `20260910` | 수집일보다 미래인 값이 있어 실제 출간 완료일로 단정 금지 |
| `pages` | `396`, `156`, `224`, `0` | 0은 페이지 수 미제공으로 처리 |
| `starScore` | `0` | 리뷰 수 필드가 없어 0점과 미평가 구분 불가 |
| `series` | `[]`, 시리즈 객체 배열 | 빈 배열은 시리즈 없음 또는 미제공 |

### 5.3 결측 표현

YES24 응답은 한 가지 결측 표현만 사용하지 않는다.

```text
null       -> 연결 상품·규격·본문 등이 없음
""         -> 부제·원제·addOnLink 등이 없음
[]         -> 시리즈가 없거나 미제공
0          -> 페이지·평점·판매지수 등에서 미제공 가능성 존재
필드 없음   -> API 버전·detail 값에 따라 방어적으로 처리
```

Raw에는 원문 표현을 유지한다. 정규화 단계에서는 필드 의미에 따라 `null`, 빈 문자열, 빈 배열, 의미 없는 0을 `NULL` 또는 `available=false`로 변환한다.

---

## 6. 현재 보유 데이터 분석

분석 대상은 `raw/yes24_detail_raw_20260824.jsonl`의 실제 상세 요청 결과 19,754건이다. 필드 결측률은 상품 응답이 존재한 성공 19,751건을 분모로 계산한다.

### 6.1 수집 규모와 정합성

| 항목 | 값 |
| --- | ---: |
| ISBN 후보 | 20,000건 |
| 상세 요청 결과 | 19,754건 |
| 성공 | 19,751건 |
| 미검색 | 3건 |
| API 오류·요청 오류 | 0건 |
| 고유 요청 ISBN-13 | 19,754건 |
| 고유 응답 ISBN-13 | 19,751건 |
| 고유 YES24 `itemId` | 19,751건 |
| 성공 응답의 요청·응답 ISBN 정확 일치 | 19,751건, 100% |
| 중복 ISBN·상품 번호 | 0건 |

초기 실행은 사용자가 수동 중단했고, 이후 20분 제한으로 6,868건을 추가한 다음 다시 재개해 일일 한도까지 수집했다. 목록 후보 호출 242회, 상세 본수집 결과 19,754회, 초기 smoke 성공 3회를 합치면 로컬 기록으로 확인되는 종결 응답은 19,999회다. 그 다음 요청에서 `RATE_002`가 반환되어 일일 한도 소진을 확인했다. 계정 전체의 정확한 사용량은 YES24 이용 현황을 기준으로 한다.

### 6.2 주요 필드 결측률

| 필드 | 결측률 | 추가 판단 |
| --- | ---: | --- |
| `title`, `publisher`, `isbn13` | 0.0000% | Master·JOIN 보강에 사용 가능 |
| `author` | 4.5871% | 외국도서·eBook 범위에서 결측 증가 |
| `publishDate` | 0.0000% | 미래 날짜 검증 필요 |
| `cover` | 0.0000% | 표지 후보로 사용 가능 |
| `isbn10` | 38.0841% | ISBN-13을 기본 키로 사용 |
| `subTitle` | 66.6447% | 선택 표시 필드 |
| `pages` | JSON 결측 19.9686%, 추가로 0 값 2,684건 | 0은 미제공으로 처리 |
| `weight` | 48.5191% | 규격 보조 정보 |
| `itemFormat` | 95.2509% | 핵심 판형 기준으로 부적합 |
| `contentDetail.bookIntroduction` | 45.5724% | 확보율 54.4276%. 임베딩을 전체 도서에 강제하지 않음 |
| `contentDetail.bookSummary` | 99.0735% | 단독 줄거리 소스로 부적합 |
| `contentDetail.tableOfContents` | 33.8717% | 검색·텍스트 보강 후보 |
| `series` | 88.6942% | 값이 있을 때만 시리즈 관계 보강 |
| `addOnLink`, `upDown` | 100.0000% | 현재 수집 범위에서는 사용하지 않음 |

전체 필드는 `reports/missing_report_collected_20260824.csv`를 기준으로 한다.

### 6.3 대표성 제한

이번 후보는 무작위 표본이 아니다.

```text
국내도서 신상품(001)
  -> 외국도서 신상품(002)
  -> eBook 신상품(017)
  -> 고유 ISBN 20,000건 확보
  -> 입력 순서 앞 19,754건 상세 조회
  -> 남은 후보 246건은 일일 한도 소진으로 미조회
```

상세 결과에는 국내도서·외국도서·eBook 신상품이 포함됐지만 무작위 표본이 아니며 최근 등록 상품에 강하게 편향되어 있다. 위 결측률을 YES24 전체 도서의 확정 비율로 일반화하지 않는다. 국립중앙도서관 전체 ISBN에서 시간·주제·출판연도별 층화 표본을 만들고 다시 측정해야 전체 보강 효과를 판단할 수 있다.

---

## 7. 정규화 및 검증 규칙

### 7.1 ISBN

1. 하이픈과 공백을 제거한다.
2. ISBN-10·13 체크섬을 검증한다.
3. 유효한 ISBN-10은 ISBN-13으로 변환한다.
4. `request.isbn13 == response.data.items[].isbn13`인지 확인한다.
5. ISBN-13을 국립중앙도서관 `EA_ISBN`과의 표준 JOIN 키로 사용한다.
6. 불일치는 버리지 않고 별도 검토 대상으로 기록한다.

### 7.2 문자열과 본문

```text
null / "" / 공백 문자열 -> 정규화 NULL
title / author / publisher 원문 보존
검색용 정규화 필드는 별도 생성
책 소개·요약·목차의 HTML·제어문자 여부 검증
긴 원문은 Raw 또는 별도 텍스트 저장소에 보관
```

### 7.3 날짜

`publishDate`는 `yyyyMMdd` 8자리와 실제 달력 날짜를 검증한다. 수집일보다 미래인 값이 실제 확인됐으므로 판매 예정일 또는 예약 상품 날짜일 수 있다. 국립중앙도서관 `REAL_PUBLISH_DATE`, 수집 시각, 상품 상태와 비교해 `publication_date_candidate`와 품질 플래그를 저장한다.

### 7.4 숫자

| 필드 | 처리 |
| --- | --- |
| `shopPrice`, `salePrice` | 음수가 아니고 정수값이면 정수형 가격으로 변환. 수집 시각 필수 |
| `pages` | 0보다 큰 정수만 `page_count` 후보 |
| `weight`, `width`, `length`, `height` | 0보다 큰 값만 규격으로 사용 |
| `starScore` | 0은 미평가 가능성이 있어 리뷰 수 없이 실제 0점으로 단정하지 않음 |
| `salePoint` | YES24 내부 스냅샷으로만 저장. 출처·수집 시각 필수 |

---

## 8. Source Priority와 병합 정책

| 필드 | 1순위 | YES24 역할 |
| --- | --- | --- |
| ISBN | 검증된 국립중앙도서관 ISBN | 일치 확인·YES24 상품 연결 |
| 제목·저자·출판사 | 국립중앙도서관 기준 서지 | 화면 표시 보강·충돌 탐지. 원본을 즉시 덮어쓰지 않음 |
| 주제·KDC | 국립중앙도서관·공식 분류 | `goodsSortNm`은 YES24 별도 분류로 보존 |
| 출간일 | 출처별 검증값 | 정확한 날짜 후보. 미래값 품질 검증 |
| 표지 | 접근성과 품질이 검증된 외부 표지 | `cover`를 우선 후보로 검토 |
| 설명·목차 | YES24 등 실제 텍스트 제공 API | 존재하는 값만 보강 |
| 페이지 | 유효한 YES24 `pages` | 국립중앙도서관 자유형식 `PAGE` 보완 |
| 가격·판매상태 | YES24 | 수집 시점 스냅샷. 기준 서지 아님 |
| 대출량 | 도서관 정보나루 | YES24 지표로 대체하지 않음 |

권장 출처 메타데이터:

```text
source_name = YES24
source_key = itemId
source_isbn13
source_collected_at
raw_payload_location
field_source
field_confidence
```

---

## 9. 저장 구조

### Raw

한 요청의 상태와 YES24 공통 응답을 그대로 보존한다.

```text
raw/yes24_detail_raw_{date}.jsonl
```

### Processed

향후 정규화 결과는 원본과 분리한다.

```text
processed/yes24_books_normalized_{date}.jsonl
```

권장 정제 필드:

```text
yes24_item_id
isbn13
isbn10
title_raw
subtitle_raw
author_raw
publisher_raw
goods_type
goods_category_raw
adult_yn
publication_date_candidate
publication_date_quality
page_count
list_price
sale_price
price_collected_at
item_status
cover_url
description
summary
table_of_contents
series
star_score
sale_point
source_collected_at
```

---

## 10. 수집 코드 실행 방법

외부 패키지는 필요하지 않으며 Python 3.10 이상을 사용한다.

```powershell
cd database/yes24
Copy-Item .env.example .env
```

`.env`에 실제 키를 입력한다.

```dotenv
YES24_API_KEY=발급받은_API_KEY
```

### 국립중앙도서관 JSONL에서 상세 조회

```powershell
python scripts/yes24_isbn_collector.py `
  --input "../국립중앙도서관/raw/books_all_years.jsonl" `
  --isbn-field "EA_ISBN" `
  --limit 1000
```

### YES24 목록에서 후보 생성 후 상세 조회

```powershell
python scripts/yes24_seed_collector.py --target 20000

python scripts/yes24_isbn_collector.py `
  --input "raw/yes24_seed_raw_YYYYMMDD.jsonl" `
  --isbn-field "isbn13" `
  --limit 0
```

실행 시간을 제한해 이어서 수집할 수도 있다.

```powershell
python scripts/yes24_isbn_collector.py `
  --input "raw/yes24_seed_raw_20260824.jsonl" `
  --isbn-field "isbn13" `
  --output "raw/yes24_detail_raw_20260824.jsonl" `
  --limit 0 `
  --max-runtime-minutes 20
```

동일한 상세 결과 파일이 있으면 `success`, `not_found`, `invalid_isbn` 상태의 ISBN은 건너뛴다. `request_error`와 `api_error`는 다음 실행에서 재시도한다. `RATE_002`에서는 결과를 보존하고 종료하므로 다음 날 같은 명령으로 이어갈 수 있다.

### 품질 리포트와 샘플 재생성

```powershell
python scripts/yes24_quality_report.py `
  --input "raw/yes24_detail_raw_20260824.jsonl" `
  --scope "collected_20260824"
```

---

## 11. 추천 시스템에서의 사용 범위

### 직접 또는 보조적으로 사용할 수 있는 값

| Feature | 입력 | 사용 조건 |
| --- | --- | --- |
| 작가 선호 | `author` | 정규화된 저자 ID로 연결 |
| 세부 상품 분류 | `goodsSortNm` | YES24 분류 체계임을 유지 |
| 페이지 선호 | `pages` | 0보다 큰 값만 사용 |
| 신간 선호 | 검증된 `publishDate` | 미래값과 예약 상품 구분 |
| 설명·목차 유사도 | `bookIntroduction`, `tableOfContents` | 유효 본문만 임베딩 인덱스에 포함 |
| 시리즈 선호 | `series` | 시리즈 객체가 있는 경우만 사용 |
| 보조 인기도 | `salePoint`, `starScore` | 수집 시각·출처를 명시하고 대출 지표와 분리 |

결측 Feature를 0점으로 간주해 도서를 불리하게 만들지 않는다. 사용 가능한 Feature만으로 가중치를 재정규화한다.

### 직접 사용하지 않는 값

- `yesPoint`, `fixedBookPriceYn`: 사용자 취향의 직접 근거가 아님
- `addOnLink`, `upDown`: 현재 수집에서 전부 결측
- `starScore=0`: 리뷰 수가 없어 실제 최저 평점으로 해석 불가
- `salePrice`: 가격 민감도 데이터가 없으면 추천 핵심 점수에 넣지 않음

---

## 12. 결론

YES24 API는 다음 용도로 활용한다.

- 국립중앙도서관 ISBN-13의 외부 상품 일치 검증
- 표지, 실제 상품 링크, 가격, 판매 상태 보강
- 페이지 수, 책 소개, 목차, 시리즈 보강
- 검색·추천용 텍스트 및 보조 상품 분류 확보
- YES24 출처의 판매지수·평점 스냅샷 저장

반대로 다음 용도로 단독 사용하지 않는다.

- 도서 Master 전체의 기준 서지
- KDC·주제 분류의 대체
- 공공 대출량이나 전체 시장 인기도의 대체
- 개인 사용자 취향 또는 협업 필터링 데이터
- 대표성 검증 없는 전체 도서 결측률 추정

2026-08-24 수집분은 성공 19,751건의 ISBN이 모두 정확히 일치했으며 책 소개 확보율은 54.4276%였다. 다만 신상품 중심의 편향된 범위이므로 다음 검증은 국립중앙도서관 전체 ISBN에서 출판연도·주제별 층화 표본을 구성해 YES24 매칭률과 텍스트 확보율을 다시 측정하는 것이다.

### 참고 링크

- [YES24 Developers](https://developers.yes24.com/)
- [상품 상세 조회](https://developers.yes24.com/api-doc/goods-item-detail)
- [신상품 조회](https://developers.yes24.com/api-doc/category-newproduct)
- [오류 코드](https://developers.yes24.com/docs/error-codes)
- [FAQ](https://developers.yes24.com/support/faq)
