# 알라딘 Open API 상품정보

## 1. 문서 목적

알라딘 Open API를 우리 서비스의 도서 보강 데이터와 인기도 지표 확보에 활용하기 위한 정리 문서다.

이 API는 ISBN을 중심으로 한 **판매·평점·분류·판형 정보**를 제공한다. 국립중앙도서관 API가 채우지 못하는 영역, 즉 판매지수·평점·리뷰 수·표지·세부 카테고리·쪽수·판형을 채우는 보강 소스로 사용한다. 반대로 전체 도서를 훑는 Master Catalog로는 사용할 수 없다. 알라딘은 전량 덤프를 제공하지 않고, 한 조건당 1,000건·하루 5,000회라는 두 상한이 있다.

### 프로젝트 내 역할

```text
국립중앙도서관 ISBN API
  -> ISBN13 기준 BOOK_EDITION Master Catalog

알라딘 Open API
  -> ISBN13 / itemId 기준 판매·평점·분류·판형 보강
  -> 정규화·유효성 검증
  -> BOOK_EDITION 보강 컬럼 + BOOK_POPULARITY
  -> Elasticsearch 검색 인덱스 가중치
  -> 추천 Feature (인기도·평점·세부 카테고리)
```

두 API의 관계는 다음과 같다.

| 필요한 데이터 | 국립중앙도서관 | 알라딘 |
| --- | --- | --- |
| 전체 도서 목록 | 제공 (204만건) | 제공하지 않음 |
| ISBN 기준 서지 | 제공 | 제공 |
| 세부 카테고리 | KDC 대분류만 | 5단계 분류 경로 제공 |
| 쪽수 | 결측 58.21% · 자유 형식 | `itemPage` 정수, 결측 0% |
| 표지 이미지 | 결측 다수 | 결측 0% |
| 책소개 | 결측 93.51% | 결측 45.33% (짧은 요약) |
| 판매지수·평점 | 없음 | 제공 |
| 판형·무게·크기 | 자유 문자열 | mm·g 정수 제공 |
| 목차·상세 설명 | URL만, 결측 93.87% | 기본형 키로는 제공되지 않음 |

### 표준 폴더 구조

[`database/API_DATA_STANDARD.md`](../API_DATA_STANDARD.md)의 구조를 그대로 따른다.

```text
알라딘/
├── ALADIN_OPENAPI.md   # API 설명·필드·실제 값·저장 정책
├── .gitignore          # 대용량 생성 결과물 제외
├── scripts/            # 수집·정제·검증 코드
├── raw/                # 원본 응답. Git 제외
├── processed/          # 정제·병합 결과. Git 제외
├── samples/            # Git에 포함하는 소형 샘플
├── reports/            # 품질·결측 리포트
└── metadata/           # 분야 목록·실행 계획·미해결 조건·호출 예산
```

### 저장소에 포함한 산출물

| 경로 | 내용 |
| --- | --- |
| `scripts/aladin_collector.py` | 쿼터 관리·파트 수집·재개·병합·품질 리포트 생성 코드 |
| `scripts/aladin_cli.py` | 단건 탐색용 CLI (`search` / `list` / `lookup`) |
| `scripts/analyze_fields.py` | 6개 엔드포인트 표본으로 필드 존재율·결측 패턴 집계 |
| `scripts/analyze_lookup.py` | `ItemLookUp` + `OptResult` 확장 필드 집계 |
| `samples/sample_items.jsonl` | 검색·리스트 응답 레코드 18건 |
| `samples/sample_items.pretty.json` | 동일한 샘플을 사람이 읽기 좋게 들여쓴 JSON 배열 |
| `samples/sample_lookup.jsonl` | `ItemLookUp` 응답 레코드 7건 (`subInfo` 포함) |
| `samples/sample_lookup.pretty.json` | 동일한 샘플의 들여쓴 JSON 배열 |
| `reports/data_quality_summary_field_survey.txt` | 표본 300건 필드 품질 요약 |
| `reports/missing_report_field_survey.csv` | 필드별 결측률과 실제 값 예시 (표본 300건) |
| `reports/missing_report_lookup.csv` | `subInfo` 확장 필드 결측률 (표본 7건) |
| `metadata/category_index.jsonl` | 응답에서 확인된 분야 ID·분야명·깊이 86건 |
| `metadata/category_ids.txt` | 분야 순회 입력용 ID 목록 |
| `metadata/COLLECTION_METADATA_GUIDE.md` | 메타데이터 파일 설명 |

수집 결과물(`raw/parts/`, `processed/`)은 저장소에 넣지 않는다. 조건 수에 따라 수 GB까지 늘어나고 재실행으로 다시 만들 수 있기 때문이다. `.gitignore`로 제외하고 `--output-dir`에 로컬 데이터 디렉터리를 지정한다.

`metadata/range_plan.json`, `range_count_cache.json`, `unresolved_ranges.json`은 아직 실제 수집을 돌리지 않아 저장소에 없다. 첫 수집 후 국립중앙도서관과 같이 저장소에 포함한다.

### 표준 대비 차이

[`API_DATA_STANDARD.md`](../API_DATA_STANDARD.md)의 파일명 규칙을 그대로 따르되, 알라딘 API의 성격상 다음 두 가지가 다르다.

| 표준 | 알라딘 | 이유 |
| --- | --- | --- |
| `raw/{resource}_raw_{date}.jsonl` | `raw/parts/{조건명}.jsonl` | 하루 호출 한도로 여러 날에 걸쳐 수집하므로 조건 단위 재개가 필요하다. 국립중앙도서관도 같은 이유로 `raw/parts/`를 쓴다 |
| `metadata/range_count_cache.json`은 건수 조회 캐시 | 조건별 `totalResults` 캐시 | 알라딘에는 건수 전용 조회가 없다. 대신 각 조건 1페이지 응답의 `totalResults`를 같은 목적으로 캐시한다 |

`category_index.jsonl`과 `category_ids.txt`는 표준에 없는 알라딘 전용 파일이다. 분야를 쪼개야만 1,000건 상한을 넘길 수 있어 분야 목록 자체가 수집 계획의 입력이 된다.

**TTBKey는 코드·문서·커밋에 절대 기록하지 않는다.** 환경변수 `ALADIN_TTB_KEY` 또는 `.env`로만 전달하며, `.env`는 `.gitignore`에 포함되어 있다.

### 수집기 실행 방법

```powershell
cd database/알라딘
python -m pip install requests
$env:ALADIN_TTB_KEY = "발급받은_TTBKey"

# 1) 전체(CategoryId=0) 리스트부터 훑는다
python scripts/aladin_collector.py --mode list `
  --output-dir "C:\data\aladin_output" --scope list_all

# 2) 수집 결과에서 실제 등장한 CategoryId를 뽑는다 (API 호출 없음)
python scripts/aladin_collector.py --mode categories `
  --output-dir "C:\data\aladin_output"

# 3) 그 분야 목록으로 다시 넓게 훑는다
python scripts/aladin_collector.py --mode list `
  --output-dir "C:\data\aladin_output" --scope list_category `
  --category-file "C:\data\aladin_output\metadata\category_ids.txt"

# 4) 국립중앙도서관 ISBN을 seed로 단건 상세 보강
python scripts/aladin_collector.py --mode lookup `
  --output-dir "C:\data\aladin_output" --scope lookup `
  --seed-nl "C:\data\nl_isbn_split_output\processed\books_all_years.jsonl" `
  --seed-limit 4000

# 5) 병합 + 리포트만 다시 생성 (API 호출 없음)
python scripts/aladin_collector.py --mode merge `
  --output-dir "C:\data\aladin_output" --scope all
```

TTBKey를 환경변수로 지정하지 않으면 실행 중 입력받는다. 기본 설정은 다음과 같다.

```text
API Version     20131101
output          js
호출 상한       하루 4,800회 (알라딘 기본형 키는 5,000회)
MaxResults      50 (알라딘 실제 상한)
start           1~20 (알라딘 실제 상한)
한 조건 상한    1,000건
요청 간격       0.3초
재시도 횟수     4회
중복 제거 키    itemId
```

실행 시 `--output-dir` 아래에 표준 폴더가 자동 생성된다.

```text
{output-dir}/
├── raw/parts/                                 # 조건별 원본 JSONL과 .done.json
├── processed/items_normalized_{date}.jsonl
├── samples/
│   ├── sample_items.jsonl
│   └── sample_items.pretty.json
├── reports/
│   ├── missing_report_{scope}.csv
│   └── data_quality_summary_{scope}.txt
└── metadata/
    ├── range_plan.json           # 조회 조건별 실행 계획과 예상 호출 수
    ├── category_ids.txt          # 다음 회차 분야 순회 입력
    ├── category_index.jsonl      # 분야 ID·명·깊이·건수
    ├── unresolved_ranges.json    # 실패한 조회 조건
    ├── isbn_not_found.jsonl      # 알라딘 미등록·절판 ISBN
    └── quota_state.json          # 날짜별 호출 사용량
```

호출 사용량은 `metadata/quota_state.json`에 **날짜 단위**로 누적된다. 한도에 걸리면 수집이 정상 종료되고, 다음 날 같은 명령을 다시 실행하면 완료된 `.done.json` 파트를 건너뛰고 이어서 수집한다.

---

## 2. 공식 정보

| 항목 | 내용 |
| --- | --- |
| 기본 URL | `https://www.aladin.co.kr/ttb/api/` |
| 제공 기관 | 알라딘 인터넷서점 |
| 인증 | `ttbkey` 필요 |
| 결과 형식 | `output=js`(JSON) 또는 `xml` |
| 최신 버전 | `Version=20131101` (기본값은 `20070901`이므로 반드시 명시) |
| 주요 식별자 | `itemId`(알라딘 내부 PK), `isbn13`, `isbn` |
| 공식 매뉴얼 | [알라딘 Open API 매뉴얼](https://docs.google.com/document/d/1mX-WxuoGs8Hy-QalhHcvuV17n50uGI2Sg_GHofgiePE/mobilebasic) |

### 엔드포인트

| 엔드포인트 | 용도 | 1회 호출 산출량 |
| --- | --- | --- |
| `ItemSearch.aspx` | 검색어·분야 기준 상품 검색 | 최대 50건 |
| `ItemList.aspx` | 베스트셀러·신간 등 리스트 조회 | 최대 50건 |
| `ItemLookUp.aspx` | ISBN·itemId 단건 상세 조회 | 1건 |
| `ItemOffStoreList.aspx` | 중고매장 재고 검색 | 프로젝트에서 사용하지 않음 |

### 이용 조건

| 항목 | 내용 |
| --- | --- |
| 개인·비영리 | 별도 조건 없이 사용 가능 |
| 법인사업자 | 도서판매·도서정보 기반 서비스 운영 시 **이용 불가** |
| 기본형 호출 한도 | 하루 5,000회 |
| 프리미엄 호출 한도 | 하루 100,000회 (1시간당 최대 10,000회) |
| 프리미엄 조건 | 기본형 선행 이용 + 출처 문구 표기 + 알라딘 단독 링크 노출 |
| 출처 문구 | `도서 DB 제공 : 알라딘 인터넷서점(www.aladin.co.kr)` |

SSAFY 관통 프로젝트는 비영리 교육 목적이므로 기본형 키로 진행한다. 다만 화면에 도서 정보를 노출할 때는 위 출처 문구를 표기하고 알라딘 상품 링크(`item.link`)를 함께 제공하는 것을 기본으로 한다. 상용 서비스로 전환할 경우 이용 가능 여부부터 다시 확인해야 한다.

### 실제 요청 예시

인증키는 코드나 문서에 직접 기록하지 않는다.

```text
https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx
  ?ttbkey={TTBKey}
  &itemIdType=ISBN13
  &ItemId=9791199489561
  &output=js
  &Version=20131101
  &Cover=Big
  &OptResult=ratingInfo,packing,categoryIdList
```

```text
https://www.aladin.co.kr/ttb/api/ItemList.aspx
  ?ttbkey={TTBKey}
  &QueryType=Bestseller
  &SearchTarget=Book
  &CategoryId=656
  &start=1
  &MaxResults=50
  &output=js
  &Version=20131101
```

### 공통 요청 파라미터

| 파라미터 | 형식 | 설명 |
| --- | --- | --- |
| `ttbkey` | String | 발급받은 인증키 (필수) |
| `output` | String | `js` 또는 `xml` |
| `Version` | String | `20131101` 권장 |
| `Cover` | String | `Big`(200px), `MidBig`(150), `Mid`(85), `Small`(75), `Mini`(65), `None` |
| `Partner` | String | 제휴 파트너 코드 |
| `InputEncoding` | String | 기본 `utf-8` |

### `ItemSearch.aspx` 파라미터

| 파라미터 | 설명 | 프로젝트 활용 |
| --- | --- | --- |
| `Query` | 검색어 (필수) | 분야 순회 보조, 사용자 검색 fallback |
| `QueryType` | `Keyword`(기본), `Title`, `Author`, `Publisher` | 저자·출판사 단위 수집 |
| `SearchTarget` | `Book`, `Foreign`, `Music`, `DVD`, `Used`, `eBook`, `All` | `Book`·`eBook`만 사용 |
| `Sort` | `Accuracy`(기본), `PublishTime`, `Title`, `SalesPoint`, `CustomerRating`, `MyReviewCount` | `SalesPoint`로 인기 도서 우선 확보 |
| `CategoryId` | 분야 제한 (기본 0) | 1,000건 상한 우회의 핵심 |
| `start` | 페이지 번호 | **1~20만 유효** |
| `MaxResults` | 페이지당 건수 | 50 |
| `outofStockfilter` | 품절·절판 제외 | 기본 0(포함). 절판 도서도 Master에 필요 |
| `RecentPublishFilter` | 출간일 제한(월 단위, 0~60) | 신간 배치에 사용 |

### `ItemList.aspx` 파라미터

| 파라미터 | 설명 |
| --- | --- |
| `QueryType` | `Bestseller`, `ItemNewAll`, `ItemNewSpecial`, `ItemEditorChoice`, `BlogBest` (필수) |
| `Year` / `Month` / `Week` | `Bestseller` 주간 지정. 과거 베스트셀러 이력 수집에 사용 |
| `CategoryId` | 분야 제한 |
| `start` / `MaxResults` | 검색 API와 동일 |

### `ItemLookUp.aspx` 파라미터

| 파라미터 | 설명 |
| --- | --- |
| `ItemId` | ISBN 또는 알라딘 `itemId` (필수) |
| `ItemIdType` | `ISBN`(기본, 10자리), `ISBN13`, `ItemId` |
| `OptResult` | 확장 필드 요청 목록 (3.4 참고) |

### 오류 처리

알라딘은 오류를 HTTP 상태코드가 아니라 **응답 본문의 `errorCode` / `errorMessage`**로 내려준다. 공식 매뉴얼에 코드 표가 없으므로 코드값을 분기 조건으로 쓰지 않고 다음 규칙으로 처리한다.

| 상황 | 판단 | 처리 |
| --- | --- | --- |
| 본문에 `errorCode` 존재 | API 오류 | 재시도하지 않고 호출자에게 전달 |
| 메시지에 key·차단 관련 문구 | 치명적 오류 | 수집 즉시 중단 |
| 그 외 `errorCode` | 대상 문제 | 해당 조건만 `metadata/unresolved_ranges.json`에 기록하고 계속 |
| HTTP 오류·타임아웃·JSON 파싱 실패 | 일시 오류 | 5·15·30·60·120초 백오프로 최대 4회 재시도 |
| `item` 배열이 빈 배열 | 오류가 아님 | 미등록·절판. `metadata/isbn_not_found.jsonl`에 기록 |

---

## 3. 응답 구조

### 3.1 응답 래퍼

`item` 배열 밖의 메타데이터다. 수집 검증에만 사용하고 도서 레코드로 저장하지 않는다.

```json
{
  "version": "20131101",
  "logo": "http://image.aladin.co.kr/img/header/2011/aladin_logo_new.gif",
  "title": "알라딘 상품정보 - 세네카, 오늘을 빼앗기고 있는 당신에게",
  "link": "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=396404956&amp;partner=openAPI",
  "pubDate": "Mon, 24 Aug 2026 05:54:13 GMT",
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "query": "isbn13=9791199489561",
  "searchCategoryId": 0,
  "searchCategoryName": "",
  "item": []
}
```

| 필드 | 자료형 | 의미 | 사용 방침 |
| --- | --- | --- | --- |
| `version` | String | API 버전 | 수집 로그 |
| `logo` | String(URL) | 알라딘 로고 | 사용하지 않음 |
| `title` | String | API 결과 제목 | 사용하지 않음 |
| `link` | String(URL) | 결과 관련 알라딘 페이지 | 사용하지 않음 |
| `pubDate` | String | **응답 생성 시각**(RFC 1123) | `item.pubDate`(출간일)와 다른 값이므로 혼동 금지 |
| `totalResults` | Integer | 총 결과 수 | 수집 검증. `ItemList`는 1000으로 고정 |
| `startIndex` | Integer | 페이지 번호 | 수집 로그 |
| `itemsPerPage` | Integer | 페이지당 건수 | 수집 로그 |
| `query` | String | 조회 쿼리 | 수집 로그 |
| `searchCategoryId` | Integer | 조회 분야 ID | 수집 로그 |
| `searchCategoryName` | String | 조회 분야명 | 수집 로그 |

### 3.2 `item` 기본 필드

표본 300건에서 **모든 엔드포인트에 100% 존재**한 필드다. 분류 기준은 국립중앙도서관 문서와 동일하다.

| 필드 | 자료형 | 의미 | 분류 | 사용 방침 |
| --- | --- | --- | --- | --- |
| `itemId` | Integer | 알라딘 내부 상품 PK | A / E | **알라딘 측 JOIN 키.** 결측·중복 없음 |
| `isbn13` | String | 13자리 ISBN | A / E | 국립중앙도서관과의 표준 JOIN 키. 5.67% 결측 |
| `isbn` | String | 알라딘 상품코드 | G | **ISBN-10이 아니다.** 전자책은 `K…`/`E…`. JOIN에 사용 금지 |
| `title` | String | 상품명 | A / C / D | 부제가 ` - `로 이어붙어 있어 분리 필요 |
| `author` | String | 저자·역할 | A / C / B | `"이름 (지은이), 이름 (옮긴이)"` 한 문자열. 파싱 필요 |
| `publisher` | String | 출판사 | A / C / D | 판본 식별 보조 |
| `pubDate` | String | 출간일 `YYYY-MM-DD` | A / B / D | 결측 0%. **실제 출간일 1순위 소스** |
| `description` | String | 짧은 상품 요약 | B / D | 45.33% 결측. 존재할 때만 텍스트 Feature |
| `cover` | String(URL) | 표지 이미지 | D | 결측 0%. **표지 1순위 소스** |
| `link` | String(URL) | 상품 페이지 | D | 출처 링크. `&amp;` 언이스케이프 필요 |
| `categoryId` | Integer | 최말단 분야 ID | B / C | 결측 0%. 세부 카테고리 Feature |
| `categoryName` | String | `>` 구분 전체 분야 경로 | B / C / D | 결측 0%. 계층 분해 후 사용 |
| `priceSales` | Integer | 판매가 | D / G | 4.67%가 `0`(판매 불가) |
| `priceStandard` | Integer | 정가 | D / G | 4.67%가 `0` |
| `mileage` | Integer | 적립금 | G | 9.33%가 `0`. 추천에 미사용 |
| `salesPoint` | Integer | 판매지수 | B | 17.00%가 `0`. **인기도 Feature 핵심** |
| `customerReviewRank` | Integer | 회원 평점 0~10 | B | 49.33%가 `0`. `0`은 무평점이며 최저점이 아님 |
| `mallType` | String | `BOOK`/`EBOOK`/`FOREIGN`/`USED`/`MUSIC`/`DVD` | A / C | 판본 타입 필터 |
| `stockStatus` | String | 재고 상태 | G | 92.33%가 빈 문자열이며, 빈 값이 곧 정상 판매 |
| `adult` | Boolean | 성인 등급 | C | 노출 필터 |

분류 기준은 다음과 같다.

- **A. BOOK MASTER 기본정보**: 도서 판본을 식별하고 저장하는 기본 속성
- **B. 추천 Feature**: 정제·검증 후 추천 점수에 사용할 수 있는 속성
- **C. 검색 Feature**: Elasticsearch 검색·필터에 사용할 속성
- **D. 화면 표시용**: 상세 페이지나 추천 이유에 표시할 속성
- **E. 외부 API JOIN용**: 다른 데이터 소스와 연결하는 키
- **F. 품질이 낮아 제외**: 결측·오류가 심해 핵심 로직에서 제외할 속성
- **G. 보조적으로만 사용**: 품질 추적·판본 보조·출처 표시용 속성

### 3.3 조건부 필드

**키 자체가 없을 수 있다.** 파서에서 반드시 기본값 처리를 해야 한다.

| 필드 | 자료형 | 표본 존재율 | 나오는 조건 |
| --- | --- | ---: | --- |
| `fixedPrice` | Boolean | 250/300 (83.33%) | 도서 정가제 대상. **외국도서에는 키 자체가 없음** |
| `seriesInfo.seriesId` | Integer | 115/300 (38.33%) | 시리즈 도서만. 외국도서는 전무 |
| `seriesInfo.seriesName` | String | 115/300 (38.33%) | 후행 공백 존재 |
| `seriesInfo.seriesLink` | String(URL) | 115/300 (38.33%) | 시리즈 목록 페이지 |
| `bestRank` | Integer | 100/300 (33.33%) | `ItemList&QueryType=Bestseller`에서만 |
| `bestDuration` | String | 33/300 (11.00%) | 장기 랭커만. 예: `"종합 1위 3주"` |
| `categoryIdList[]` | Array | `ItemLookUp` 7/7 | `OptResult=categoryIdList`. **`item` 최상위**에 위치 |
| `subInfo.paperBookList[]` | Array | 100/300 (33.33%) | `SearchTarget=eBook` 조회 시 종이책 연결 |

### 3.4 확장 필드 `subInfo` — `ItemLookUp` 전용

`ItemSearch`·`ItemList`에서 `subInfo`는 **빈 객체 `{}`**로 온다. `OptResult`를 붙여도 검색·리스트에서 채워지는 것은 `ebookList`, `usedList`, `subBarcode` 세 개뿐이다. 나머지는 `ItemLookUp`으로만 얻는다.

표본 7건 기준 결과다. 전체 집계는 [`reports/missing_report_lookup.csv`](reports/missing_report_lookup.csv)에 있다.

| 필드 | 자료형 | 결측 | 비고 |
| --- | --- | ---: | --- |
| `subInfo.itemPage` | Integer | 0/7 | 쪽수. **국립중앙도서관 `PAGE`(결측 58.21%) 대체** |
| `subInfo.packing.styleDesc` | String | 0/7 | `반양장본` 등 제책 형태 |
| `subInfo.packing.sizeWidth` | Integer | 0/7 | mm 단위 |
| `subInfo.packing.sizeHeight` | Integer | 0/7 | mm 단위 |
| `subInfo.packing.sizeDepth` | Integer | 0/7 | mm 단위 |
| `subInfo.packing.weight` | Integer | 0/7 | g 단위 |
| `subInfo.ratingInfo.ratingScore` | Float | 1/7이 `0` | 0~10. `customerReviewRank`보다 정밀 |
| `subInfo.ratingInfo.ratingCount` | Integer | 1/7이 `0` | 별점 참여 수 |
| `subInfo.ratingInfo.commentReviewCount` | Integer | 1/7이 `0` | 100자평 수 |
| `subInfo.ratingInfo.myReviewCount` | Integer | 1/7이 `0` | 마이리뷰 수 |
| `subInfo.bestSellerRank` | String | 1/7 키 없음 | `"종합 주간 1위"`. 파싱 필요 |
| `subInfo.subTitle` | String | 5/7 빈 문자열 | 부제 |
| `subInfo.originalTitle` | String | 6/7 빈 문자열 | 원서명. 번역서만 |
| `subInfo.subBarcode` | String | 1/7 키 없음 | **ISBN 부가기호 5자리.** `03190` 등 |
| `subInfo.ebookList[]` | Array | 1/7 빈 배열 | 전자책 판본 (`itemId`/`isbn`/`isbn13`/`priceSales`/`link`) |
| `subInfo.usedList.aladinUsed.itemCount` | Integer | 4/7이 `0` | 알라딘 직배송 중고 재고 |
| `subInfo.usedList.aladinUsed.minPrice` | Integer | 4/7이 `0` | 중고 최저가 |
| `subInfo.usedList.userUsed.*` | Object | 3/7이 `0` | 회원 직배송 중고 |
| `subInfo.usedList.spaceUsed.*` | Object | 3/7이 `0` | 광활한 우주점 중고 |
| `subInfo.c2bsales` | Integer | 1/7이 `0` | 중고 매입 가능 여부 (1: 가능) |
| `subInfo.c2bsales_price.{AA,A,B,C}` | Integer | 2~4/7이 `0` | 등급별 매입가 |
| `subInfo.cardReviewImgList[]` | Array | 4/7 키 없음 | 카드리뷰 이미지 URL |

#### `OptResult` 무응답 항목

기본형 TTBKey로 요청했을 때 **응답에 나타나지 않은** 항목이다.

```text
Toc  Story  fulldescription  fulldescription2  authors
reviewList  phraseList  mdrecommend  eventList
previewImgList  b2bSupply
```

즉 **목차·상세 책소개·저자 정규화 데이터·리뷰 본문은 이 키로 받을 수 없다.** 프리미엄 키 승인 시 재확인 대상이며, 그때까지 임베딩 소스 계획에서 제외한다. `scripts/analyze_lookup.py`를 다시 실행하면 이 목록을 재검증할 수 있다.

---

## 4. 실제 응답 값의 형태

전체 샘플은 [`samples/sample_items.pretty.json`](samples/sample_items.pretty.json), [`samples/sample_lookup.pretty.json`](samples/sample_lookup.pretty.json)에서 확인할 수 있다.

### 4.1 실제 레코드 예시

`ItemList&QueryType=Bestseller&SearchTarget=Book` 응답의 1위 레코드다.

```json
{
  "title": "세네카, 오늘을 빼앗기고 있는 당신에게",
  "author": "루키우스 안나이우스 세네카 (지은이), 하와이 대저택 (편역)",
  "pubDate": "2026-07-01",
  "isbn": "K872130175",
  "isbn13": "9791199489561",
  "itemId": 396404956,
  "priceSales": 16200,
  "priceStandard": 18000,
  "mallType": "BOOK",
  "stockStatus": "",
  "mileage": 900,
  "cover": "https://image.aladin.co.kr/product/39640/49/cover200/k872130175_1.jpg",
  "categoryId": 51462,
  "categoryName": "국내도서>인문학>서양철학>고대철학>고대철학 일반",
  "publisher": "논픽션",
  "salesPoint": 236490,
  "adult": false,
  "fixedPrice": true,
  "customerReviewRank": 10,
  "bestRank": 1,
  "bestDuration": "종합 1위 3주",
  "subInfo": {}
}
```

같은 ISBN을 `ItemLookUp`으로 조회하면 `subInfo`가 채워지고 `categoryIdList`가 추가된다.

```json
{
  "categoryIdList": [
    { "categoryId": 656,   "categoryName": "국내도서>인문학" },
    { "categoryId": 51390, "categoryName": "국내도서>인문학>서양철학" },
    { "categoryId": 51442, "categoryName": "국내도서>인문학>서양철학>고대철학" },
    { "categoryId": 51462, "categoryName": "국내도서>인문학>서양철학>고대철학>고대철학 일반" }
  ],
  "subInfo": {
    "subTitle": "",
    "originalTitle": "",
    "itemPage": 236,
    "ratingInfo": {
      "ratingScore": 9.8,
      "ratingCount": 17,
      "commentReviewCount": 8,
      "myReviewCount": 9
    },
    "bestSellerRank": "종합 주간 1위",
    "packing": {
      "styleDesc": "반양장본",
      "weight": 236,
      "sizeDepth": 14,
      "sizeHeight": 190,
      "sizeWidth": 122
    },
    "c2bsales": 1,
    "c2bsales_price": { "AA": 8700, "A": 7800, "B": 6900, "C": 0 },
    "subBarcode": "03190",
    "ebookList": [],
    "usedList": {
      "aladinUsed": { "itemCount": 0, "minPrice": 0, "link": "https://..." },
      "userUsed":   { "itemCount": 0, "minPrice": 0, "link": "https://..." },
      "spaceUsed":  { "itemCount": 0, "minPrice": 0, "link": "https://..." }
    }
  }
}
```

전자책·외국도서는 스키마가 다르다.

```json
{
  "title": "[세트] 피를 마시는 새 오디오북 (총8권)",
  "author": "이영도 (지은이)",
  "isbn": "E372639387",
  "isbn13": "9791170528227",
  "mallType": "EBOOK",
  "categoryName": "전자책>오디오북>판타지/무협",
  "priceSales": 200000,
  "subInfo": { "paperBookList": [] }
}
```

```json
{
  "title": "Learn Quantum Computing with Python and IBM Quantum - Second Edition: ... (Paperback, 2)",
  "author": "Robert Loredo (지은이)",
  "isbn": "1803244801",
  "isbn13": "9781803244808",
  "mallType": "FOREIGN",
  "categoryName": "외국도서>컴퓨터>시스템 구조>분산 시스템/컴퓨팅",
  "publisher": "Packt Publishing",
  "salesPoint": 225,
  "customerReviewRank": 0
}
```

외국도서에는 `fixedPrice` 키가 없다는 점에 주의한다.

### 4.2 필드별 실제 값 예시

| 필드 | 실제로 확인된 값 예시 | 값의 특징 |
| --- | --- | --- |
| `itemId` | `396404956`, `400877667`, `114199374` | 정수. 결측·중복 없음 |
| `title` | `세네카, 오늘을 빼앗기고 있는 당신에게`, `Do it! 점프 투 파이썬 - 중학생도 첫날부터 실습하는 초고속 입문서, 전면 개정 2판` | 부제가 ` - ` 뒤에 붙음 |
| `author` | `박응용 (지은이)`, `루키우스 안나이우스 세네카 (지은이), 하와이 대저택 (편역)`, `강형구, 전성민, 정연승 (지은이)` | 역할이 괄호로, 인물은 쉼표로 구분 |
| `isbn` | `K872130175`, `E152431572`, `897218876X`, `1803244801` | 국내 신간은 `K…`, 전자책은 `E…`, 외서는 실제 ISBN-10 |
| `isbn13` | `9791199489561`, `9788972188766`, 빈 문자열 | 전자책·외서 일부 누락 |
| `pubDate` | `2026-07-01`, `2023-06-15`, `2026-08-31` | `YYYY-MM-DD`. 미래 출간 예정일 존재 |
| `categoryId` | `51462`, `3140`, `6734`, `40778`, `105005` | 최말단 분야 ID |
| `categoryName` | `국내도서>인문학>서양철학>고대철학>고대철학 일반`, `전자책>컴퓨터/모바일>프로그래밍 언어>파이썬` | 최상위가 몰 구분 |
| `publisher` | `논픽션`, `이지스퍼블리싱`, `Packt Publishing` | 한글·영문 출판사명 혼재 |
| `salesPoint` | `236490`, `18765`, `225`, `0` | 절대 규모 차이가 커서 로그 스케일 필요 |
| `customerReviewRank` | `10`, `9`, `0` | 0~10 정수. `0`은 무평점 |
| `mallType` | `BOOK`, `EBOOK`, `FOREIGN` | 몰 구분 |
| `stockStatus` | 빈 문자열, `예약판매`, `판매중지` | 빈 값이 정상 판매 |
| `cover` | `https://image.aladin.co.kr/product/39640/49/cover200/k872130175_1.jpg` | `Cover=Big`이면 `cover200` 경로 |
| `link` | `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=396404956&amp;partner=openAPI` | `&amp;` 언이스케이프 필요 |
| `bestDuration` | `종합 1위 3주` | 자유 문자열. 파싱 필요 |
| `seriesInfo.seriesName` | `Do it! 시리즈 (이지스퍼블리싱) `, `민음사 세계문학전집 44` | 후행 공백 존재. trim 필요 |
| `subInfo.bestSellerRank` | `종합 주간 1위`, `종합 주간 2위` | 자유 문자열 |
| `subInfo.subBarcode` | `03190`, `03810` | **앞자리 0이 있으므로 숫자 변환 금지** |
| `subInfo.packing.styleDesc` | `반양장본` | 제책 형태 |
| `subInfo.itemPage` | `236`, `220` | 정수 |

### 4.3 결측이 `null`이 아니다

표본 300건에서 **`null`은 단 한 건도 없었다.** 결측은 다음 두 형태로 온다.

```json
{
  "description": "",
  "stockStatus": "",
  "isbn13": "",
  "salesPoint": 0,
  "customerReviewRank": 0,
  "priceSales": 0
}
```

따라서 정제 단계에서 다음 규칙을 적용한다.

```text
""                -> NULL
"   "             -> NULL
빈 배열 []        -> NULL
빈 객체 {}        -> NULL (subInfo 미제공을 의미)
```

숫자 `0`은 자동 변환하지 않는다. 필드마다 의미가 다르다.

| 필드 | `0`의 의미 | 처리 |
| --- | --- | --- |
| `priceSales`, `priceStandard` | 판매 불가(품절·절판·미정) | `NULL` + `is_purchasable = false` |
| `salesPoint` | 판매 실적 없음 | `NULL`. 인기도 Feature에서 제외 |
| `customerReviewRank` | 무평점 | `NULL`. **최저점으로 해석 금지** |
| `subInfo.ratingInfo.ratingScore` | 평점 없음 | `NULL` |
| `subInfo.ratingInfo.ratingCount` | 참여자 없음 | 실제 `0`으로 저장 |
| `mileage` | 적립 없음 | 실제 `0`으로 저장 |
| `subInfo.usedList.*.itemCount` | 중고 재고 없음 | 실제 `0`으로 저장 |
| `subInfo.c2bsales_price.*` | 해당 등급 매입 불가 | 실제 `0`으로 저장 |

원본 재처리와 출처 검증을 위해 Raw 영역에는 원래 값을 그대로 보존한다.

### 4.4 값이 있다고 정상값은 아님

- `pubDate`가 `2026-08-31`처럼 **미래 날짜**인 신간 예정 도서가 존재한다. 국립중앙도서관 `PUBLISH_PREDATE`와 같은 검증을 거친다.
- 응답 문자열에 **HTML 엔티티가 그대로 남아 있다.** `link` 안의 `&amp;`는 언이스케이프해야 실제 URL이 된다.
- `title`에 `[세트]`, `(Paperback, 2)`, `전면 개정 2판` 같은 판본·형태 정보가 섞여 있다.
- 응답 JSON에 **이스케이프되지 않은 제어문자**가 섞여 온다. `json.loads(..., strict=False)`가 필요하다.

---

## 5. 현재 보유 데이터 분석

분석 대상은 `reports/`와 `samples/`의 산출물이다.

### 표본 규모

| 항목 | 값 |
| --- | ---: |
| 기본 필드 검증 표본 | 300건 (엔드포인트 6종 × 50건) |
| `ItemLookUp` 확장 필드 표본 | 8 ISBN 요청 / 7건 성공 |
| 검증한 엔드포인트 | `ItemList`(Book·eBook), `ItemSearch`(Book·eBook·Foreign) |
| 확인된 기본 필드 수 | 21개 (100% 존재) |
| 확인된 조건부·확장 필드 수 | 41개 |
| 확인된 분야 ID | 86개 |

이 표본은 **필드 스키마와 결측 패턴을 확정하기 위한 것**이며, 서비스에 적재할 수집 결과가 아니다. 실제 수집 규모와 최종 결측률은 `aladin_collector.py` 실행 후 생성되는 `reports/data_quality_summary_{scope}.txt`, `reports/missing_report_{scope}.csv`로 갱신한다.

### 필드별 품질 (표본 300건)

| 필드 | 결측 또는 `0` 비율 | 판단 |
| --- | ---: | --- |
| `itemId` | 0.00% | 알라딘 측 JOIN 키로 확정 |
| `title`, `author`, `publisher`, `pubDate` | 0.00% | 보강 기준값 |
| `categoryId`, `categoryName` | 0.00% | **세부 카테고리 Feature 확정** |
| `cover`, `link`, `mallType`, `adult` | 0.00% | 표시용 확정 |
| `priceSales`, `priceStandard` | 4.67%가 `0` | 표시용. `0`은 판매 불가 |
| `isbn13` | 5.67% 빈 문자열 | 표준 JOIN 키이나 `itemId` 보조 필요 |
| `mileage` | 9.33%가 `0` | 추천에 미사용 |
| `salesPoint` | 17.00%가 `0` | 인기도 Feature 핵심 |
| `description` | 45.33% 빈 문자열 | 짧은 요약. 단독 임베딩 소스로 부적합 |
| `customerReviewRank` | 49.33%가 `0` | 평점 Feature. `0` 제외 후 사용 |
| `seriesInfo.*` | 61.67% 키 없음 | 시리즈 표시용 보조 |
| `bestRank` | 66.67% 키 없음 | `Bestseller` 조회에서만 |
| `bestDuration` | 89.00% 키 없음 | 장기 랭커 표시용 |
| `stockStatus` | 92.33% 빈 문자열 | 빈 값이 정상이므로 결측이 아님 |

### 확장 필드 품질 (`ItemLookUp` 표본 7건)

| 필드 | 결측 | 판단 |
| --- | ---: | --- |
| `subInfo.itemPage` | 0/7 | **쪽수 Feature 확정.** 국립중앙도서관 `PAGE` 대체 |
| `subInfo.packing.*` | 0/7 | 판형·무게·크기 확정 |
| `subInfo.ratingInfo.*` | 1/7이 `0` | 정밀 평점 Feature |
| `subInfo.subBarcode` | 1/7 키 없음 | 부가기호. 국립중앙도서관 `EA_ADD_CODE`와 교차 검증 |
| `subInfo.bestSellerRank` | 1/7 키 없음 | 인기도 보조 |
| `subInfo.subTitle` | 5/7 빈 문자열 | 부제 표시용 |
| `subInfo.originalTitle` | 6/7 빈 문자열 | 원서명. 번역서 식별 보조 |
| `Toc`, `Story`, `fulldescription`, `authors` | 7/7 미제공 | **기본형 키로 수집 불가** |

### 확인된 데이터 주의점

1. **`null`이 없다.** 문자열 결측은 `""`, 숫자 결측은 `0`이다. pandas로 그대로 읽으면 `NaN`이 하나도 없고 `salesPoint` 평균이 왜곡된다.
2. **`0`이 실제 0인지 결측인지 필드마다 다르다.** 4.3의 표를 기준으로 필드별로 분기한다.
3. **`isbn` 필드를 ISBN으로 신뢰할 수 없다.** 전자책은 `K…`/`E…` 내부 코드다. 도서 식별은 `isbn13`, 알라딘 측 식별은 `itemId`를 쓴다.
4. **`isbn13`이 5.67% 결측이다.** 국립중앙도서관과 JOIN되지 않는 알라딘 레코드가 존재하므로, `itemId`만 있는 레코드도 저장할 수 있는 구조가 필요하다.
5. **`start > 20`은 오류 없이 1페이지를 되돌려준다.** 중복 검사 없는 수집 루프는 같은 데이터만 쌓는다.
6. **`title`에 부제·판본·세트 정보가 섞여 있다.** 원문을 보존하고 표시용·검색용을 분리한다.
7. **`author`는 역할이 포함된 단일 문자열이다.** `authors` OptResult를 받을 수 없으므로 문자열 파싱이 유일한 방법이다.
8. **`categoryName`의 최상위가 몰 구분이다.** `국내도서`/`전자책`/`외국도서`가 1단계이므로, 주제 분류를 쓸 때는 2단계부터 사용한다.
9. **`link`에 `&amp;`가 남아 있다.** 언이스케이프 없이 저장하면 클릭 시 동작하지 않는다.
10. **응답 래퍼의 `pubDate`와 `item.pubDate`는 다른 값이다.** 래퍼의 것은 응답 생성 시각이다.

---

## 6. 실측으로 확인된 API 제약

이 절의 내용은 공식 매뉴얼에 없거나 매뉴얼과 다르다. 수집 설계에 직접 영향을 주므로 별도로 정리한다.

### 6.1 `start`는 20까지만 유효하다

`MaxResults=50` 기준으로 `start=21` 이상을 요청하면 **오류 없이 1페이지가 다시 돌아온다.**

```text
totalResults = 1000
start = 21  ->  bestRank 1~50 (1페이지와 동일)
```

에러가 아니므로 수집 루프가 이를 감지하지 못하면 중복만 무한히 쌓인다. `aladin_collector.py`는 두 가지로 이를 막는다.

1. `start`를 20에서 강제 종료한다.
2. 파트 안에서 `itemId`를 추적해, 한 페이지가 전부 기존 항목이면 `중복 페이지 감지`로 종료하고 그 사유를 `.done.json`에 남긴다.

### 6.2 한 조건으로 접근 가능한 것은 1,000건까지다

표본에서 관측한 `totalResults`는 다음과 같다.

| 조회 조건 | `totalResults` | 실제 접근 가능 |
| --- | ---: | ---: |
| `ItemList` Bestseller / Book | 1,000 | 1,000 |
| `ItemList` ItemNewAll / Book | 1,000 | 1,000 |
| `ItemList` Bestseller / eBook | 1,000 | 1,000 |
| `ItemSearch` `파이썬` / Book | 1,365 | 1,000 |
| `ItemSearch` `파이썬` / eBook | 731 | 731 |
| `ItemSearch` `python` / Foreign | 11,240 | 1,000 |

`ItemList`의 `totalResults`는 실제 건수가 아니라 1,000으로 고정된 상한값이다. `ItemSearch`는 실제 건수를 보여주지만 접근은 앞의 1,000건뿐이다.

따라서 넓게 모으려면 **조건을 쪼개는 것이 유일한 방법**이다.

```text
CategoryId 분할        분야별로 각각 1,000건
QueryType 분할         Bestseller / ItemNewAll / ItemNewSpecial / ItemEditorChoice / BlogBest
Year·Month·Week 분할   과거 주간 베스트셀러 이력
SearchTarget 분할      Book / eBook / Foreign
Sort 분할              SalesPoint / PublishTime / CustomerRating
```

`--mode categories`는 이미 수집한 응답의 `categoryId`와 `categoryIdList`에서 실제 존재하는 분야를 뽑아 다음 회차의 입력 파일로 만든다. 알라딘 분야 엑셀 문서를 따로 구하지 않아도 분할 축을 확보할 수 있다. 절차는 [`metadata/COLLECTION_METADATA_GUIDE.md`](metadata/COLLECTION_METADATA_GUIDE.md)에 있다.

### 6.3 호출 예산

| 항목 | 값 |
| --- | ---: |
| 하루 호출 한도 (기본형) | 5,000회 |
| 수집기 기본 상한 | 4,800회 |
| 한 조건 완주 비용 | 20회 (50건 × 20페이지) |
| 하루 완주 가능 조건 수 | 240개 |
| 하루 최대 수집 행 수 (중복 포함) | 240,000행 |
| `lookup` 하루 처리량 | 4,800 ISBN |

여기서 나오는 결론이 수집 전략을 결정한다.

```text
국립중앙도서관 ISBN 204만건을 전부 lookup 하면
  2,047,239 / 4,800 = 약 427일
```

**전량 상세 보강은 불가능하다.** 따라서 다음 순서로 우선순위를 둔다.

1. `list` / `search`로 넓게 모아 기본 21개 필드를 확보한다 (1호출 = 50건).
2. 그중 `salesPoint`가 높거나 우리 서비스에서 실제로 조회·서재 등록된 도서만 `lookup`으로 깊이 보강한다 (1호출 = 1건).
3. 나머지 도서는 국립중앙도서관 서지만으로 서비스한다.

### 6.4 그 외

| 항목 | 내용 |
| --- | --- |
| 절판 도서 조회 | 오류가 아니라 빈 `item` 배열. 표본에서 `9788966262038`(클린 코드)이 이 경우였다 |
| `Version` 기본값 | 명시하지 않으면 `20070901`이 적용되어 필드가 줄어든다. 항상 `20131101`을 보낸다 |
| 응답 인코딩 | `utf-8`이지만 제어문자가 섞여 `strict=False` 파싱이 필요하다 |
| `subInfo` 위치 | `ItemSearch`·`ItemList`에서는 항상 `{}`. 확장 필드는 `ItemLookUp`에서만 |
| `categoryIdList` 위치 | 매뉴얼은 `subInfo` 아래로 적었으나 실제 응답은 `item` 최상위다 |

---

## 7. 정규화 및 검증 규칙

### 7.1 공통 문자열

```text
앞뒤 공백 제거 (seriesName 등에 후행 공백 존재)
HTML 엔티티 언이스케이프 (&amp; &lt; &gt; &quot; &#39;)
빈 문자열 -> NULL
원문(raw value)은 별도 보존
```

### 7.2 식별자

```text
itemId          -> aladin_item_id       (정수, 알라딘 측 PK)
isbn13          -> isbn13               (13자리 숫자만 유효)
isbn            -> aladin_item_code     (ISBN으로 사용 금지)
```

1. `isbn13`이 13자리 숫자이고 체크섬을 통과하면 표준 JOIN 키로 사용한다.
2. 검증 실패 또는 빈 값이면 `isbn13 = NULL`, `aladin_item_id`만으로 저장한다.
3. `isbn` 값이 `K`·`E`로 시작하면 알라딘 내부 코드이므로 ISBN 컬럼에 넣지 않는다.
4. 외국도서의 `isbn`은 실제 ISBN-10일 수 있으나, 신뢰하지 않고 `isbn13`에서 역산한다.

권장 속성:

```text
aladin_item_id
aladin_item_code
isbn13
isbn13_valid
```

### 7.3 분류

`categoryName`은 `>` 구분 계층이며 최상위가 몰 구분이다.

```text
"국내도서>인문학>서양철학>고대철학>고대철학 일반"
  -> mall_segment   = "국내도서"
  -> category_depth = 5
  -> category_path  = ["인문학", "서양철학", "고대철학", "고대철학 일반"]
  -> category_top   = "인문학"
  -> category_leaf  = "고대철학 일반"
```

`categoryIdList`가 있으면 각 단계의 `categoryId`를 함께 저장한다. 없으면 `categoryId`(최말단)만 저장하고 상위 단계는 `categoryName` 문자열에서 파생한다.

국립중앙도서관 `SUBJECT`(KDC 대분류)와는 **덮어쓰지 않고 병행 저장**한다. 두 분류 체계는 매핑이 1:1이 아니다.

### 7.4 날짜

```text
pubDate -> publication_date  (YYYY-MM-DD)
```

`YYYY-MM-DD` 형식과 실제 달력 날짜를 모두 검증한다. 미래 날짜는 삭제하지 않고 `is_forthcoming = true`로 표시한다. 알라딘 `pubDate`는 국립중앙도서관 `PUBLISH_PREDATE`(출판예정일)보다 실제 출간일에 가까우므로 **`publication_date`의 1순위 소스**로 쓴다.

### 7.5 숫자

| 원본 | 처리 |
| --- | --- |
| `salesPoint` | `0` → `NULL`. 사용 시 `log1p` 변환 |
| `customerReviewRank` | `0` → `NULL`. 1~10만 유효 |
| `subInfo.ratingInfo.ratingScore` | `0` → `NULL`. float 0~10 |
| `priceSales`, `priceStandard` | `0` → `NULL` + `is_purchasable = false` |
| `subInfo.itemPage` | 그대로 정수 저장. `0`이면 `NULL` |
| `subInfo.packing.*` | mm·g 정수 그대로 저장 |
| `subInfo.subBarcode` | **문자열 유지.** 앞자리 0 보존 |

### 7.6 자유 문자열 파싱

| 원본 | 예시 | 처리 |
| --- | --- | --- |
| `title` | `Do it! 점프 투 파이썬 - 중학생도 ..., 전면 개정 2판` | ` - ` 첫 등장 기준 분리. `title_display` / `subtitle_parsed` 저장, 원문 보존 |
| `author` | `루키우스 안나이우스 세네카 (지은이), 하와이 대저택 (편역)` | `,`로 분할 → `(역할)` 추출. `author_raw` 보존 |
| `bestDuration` | `종합 1위 3주` | 정규식으로 순위·주차 추출. 실패 시 원문만 보존 |
| `subInfo.bestSellerRank` | `종합 주간 1위` | 정규식으로 순위 추출. 실패 시 원문만 보존 |

파싱 실패는 오류가 아니다. 원문을 보존하고 파생 필드만 `NULL`로 둔다.

## 8. 도서 Entity 및 중복 처리

알라딘은 `itemId`(상품 단위)와 `isbn13`(도서 판본 단위)이라는 두 식별자를 준다. 둘의 역할이 달라 분리해서 다룬다.

```text
aladin_item_id
  - 알라딘 상품 단위. 결측·중복이 없어 수집 측 PK로 사용

isbn13
  - 도서 판본 단위. 5.67% 결측이므로 단독 PK로 쓸 수 없음
  - 국립중앙도서관 BOOK_EDITION 과의 표준 JOIN 키
```

### 식별 우선순위

```text
1순위  isbn13 (양쪽 모두 유효한 13자리)
2순위  국립중앙도서관 EA_ISBN(ISBN-10) -> ISBN-13 변환 후 매칭
3순위  매칭 실패 시 알라딘 레코드를 itemId 기준 독립 판본으로 저장
```

제목·저자만으로 두 소스를 합치지 않는다. 알라딘 `title`에는 부제·판본 정보가 섞여 있어 오매칭 위험이 크다.

### 판본 관계

| 사례 | 처리 |
| --- | --- |
| 같은 상품이 여러 조회 조건에 등장 | `itemId` 기준 중복 제거. 첫 레코드 채택 |
| 상위·하위 분야 순회로 인한 중복 | 위와 동일. 리포트에 중복 건수 기록 |
| 같은 `isbn13`에 `itemId`가 여럿 | 별도 판본으로 저장하고 `isbn13`으로 묶어 관계 표시 |
| 종이책·전자책 | `mallType`과 `subInfo.ebookList`로 관계 저장. 합치지 않음 |
| `isbn13`이 빈 값 | `itemId`만으로 저장. 국립중앙도서관과 연결하지 않음 |
| 세트 상품 | `title`의 `[세트]` 표기는 파싱 보조일 뿐, 낱권과 자동으로 묶지 않는다 |

`itemId`가 다르면 기본적으로 별도 상품으로 저장한다. 합치는 판단은 `isbn13`이 같을 때만 하고, 그때도 하나로 병합하지 않고 관계로 표시한다.

### 국립중앙도서관 매칭 실패의 원인

| 원인 | 처리 |
| --- | --- |
| 알라딘 `isbn13` 결측 (5.67%) | `itemId` 기준 저장. 국립중앙도서관과 연결하지 않음 |
| 알라딘 미등록·절판 도서 | `metadata/isbn_not_found.jsonl`에 기록. 국립중앙도서관 서지만으로 서비스 |
| 국립중앙도서관 `EA_ISBN` 결측 (1.25%) | 보강 대상에서 제외 |
| 국립중앙도서관 ISBN-10만 존재 | ISBN-13 변환 후 재시도 |
| 전자책 판본 | 알라딘 `subInfo.ebookList`로 종이책–전자책 관계 저장 |

`--seed-nl` 옵션은 국립중앙도서관 JSONL에서 13자리 `EA_ISBN`만 추출한다. ISBN-10은 알라딘 `ItemIdType=ISBN13` 조회에 쓸 수 없으므로, ISBN-13 변환은 정제 파이프라인에서 먼저 수행하고 그 결과를 `--seed-txt`로 넘기는 것을 권장한다.

---

## 9. 우리 서비스의 Source Priority

알라딘 값을 무조건 모든 필드의 최우선으로 사용하지 않는다. 필드별로 출처 우선순위를 둔다.

| 필드 | 1순위 | 2순위 | 비고 |
| --- | --- | --- | --- |
| ISBN13 | 국립중앙도서관 (검증 통과) | 알라딘 | Master·JOIN 기준 |
| 제목 | 국립중앙도서관 | 알라딘 | 알라딘 값은 부제 포함이므로 표시용으로 분리 |
| 저자 | 국립중앙도서관 원문 | 알라딘 `author` | 양쪽 원문 모두 보존 |
| 출판사 | 국립중앙도서관 | 알라딘 | |
| 실제 출간일 | **알라딘 `pubDate`** | 국립중앙도서관 `REAL_PUBLISH_DATE` | 국립중앙도서관은 결측 81.96% |
| 쪽수 | **알라딘 `subInfo.itemPage`** | 파싱 성공한 `PAGE` | 국립중앙도서관은 결측 58.21% |
| 표지 | **알라딘 `cover`** | `TITLE_URL` | 알라딘 결측 0% |
| 세부 카테고리 | **알라딘 `categoryId` / `categoryIdList`** | `EA_ADD_CODE` 내용분류 | |
| 주제 대분류 | 국립중앙도서관 `SUBJECT` (KDC) | 알라딘 `categoryName` 2단계 | 병행 저장 |
| 부가기호 | 국립중앙도서관 `EA_ADD_CODE` | 알라딘 `subInfo.subBarcode` | 교차 검증에 사용 |
| 책소개 | 알라딘 `description` | `BOOK_INTRODUCTION` | 양쪽 모두 결측이 큼 |
| 판형·무게·크기 | **알라딘 `subInfo.packing`** | `BOOK_SIZE` | 알라딘만 정수 제공 |
| 시리즈 | 알라딘 `seriesInfo` | `SERIES_TITLE` / `SERIES_NO` | |
| 가격 | 알라딘 `priceStandard` | `PRE_PRICE` | 표시용 |
| 판매지수·평점 | **알라딘 전용** | 없음 | 국립중앙도서관에 없음 |
| 목차·상세 설명 | 없음 | 없음 | 양쪽 모두 확보 불가 |
| 대출량 | data4library | 없음 | 별도 소스 |

모든 병합 필드는 다음 메타데이터를 함께 관리한다.

```text
field_source
field_source_updated_at
field_confidence
```

알라딘 값이 있다고 국립중앙도서관 값을 덮어쓰지 않는다. Raw와 정규화 값을 출처별로 분리 저장한다.

---

## 10. 저장 구조

### 10.1 관계형 DB

알라딘 데이터는 `book_edition`을 덮어쓰지 않고 별도 테이블로 붙인다. 출처가 다른 값을 한 컬럼에 섞으면 되돌릴 수 없다.

#### `book_aladin_item`

```text
id
book_edition_id          -- isbn13 매칭 성공 시 연결, 실패 시 NULL
aladin_item_id           -- 알라딘 PK, UNIQUE
isbn13
aladin_item_code         -- 원본 isbn 필드
mall_type                -- BOOK / EBOOK / FOREIGN / USED
title_raw
title_display
subtitle_parsed
author_raw
publisher
publication_date
is_forthcoming
description
cover_url
product_url
category_id
category_name
mall_segment
category_top
category_leaf
category_depth
price_sales
price_standard
is_purchasable
is_fixed_price            -- 키 부재 시 NULL
is_adult
stock_status
series_id
series_name
item_page                 -- subInfo.itemPage
style_desc                -- subInfo.packing.styleDesc
size_width_mm
size_height_mm
size_depth_mm
weight_g
sub_barcode               -- 문자열
original_title
lookup_completed_at       -- ItemLookUp 보강 시각. NULL이면 기본 필드만 보유
collected_at
updated_at
```

#### `book_popularity_snapshot`

판매지수·평점·순위는 시간에 따라 바뀌는 값이다. 최신값으로 덮어쓰면 추세를 잃는다.

```text
id
aladin_item_id
snapshot_date
sales_point
customer_review_rank
rating_score              -- subInfo.ratingInfo.ratingScore
rating_count
comment_review_count
my_review_count
best_rank                 -- ItemList Bestseller 조회 시
best_duration_raw
best_seller_rank_raw      -- subInfo.bestSellerRank
UNIQUE (aladin_item_id, snapshot_date)
```

#### `book_aladin_category`

```text
aladin_item_id
category_id
category_name
depth
```

#### `book_aladin_ebook_link`

```text
paper_item_id
ebook_item_id
ebook_isbn13
ebook_price_sales
```

#### 출처·Raw 데이터

```text
book_source_record
  - book_edition_id
  - source_name         = 'ALADIN'
  - source_key          = aladin_item_id
  - raw_payload
  - collected_at
  - source_updated_at
```

### 10.2 Elasticsearch

알라딘 값 중 검색·추천 후보 생성에 필요한 것만 도서 인덱스에 추가한다.

```text
aladin_item_id
category_path            -- 계층 배열
category_leaf
sales_point_log          -- log1p(sales_point)
rating_score
rating_count
publication_date
item_page
cover_url
mall_type
is_purchasable
description
```

`sales_point`는 원값 편차가 커서 정렬·가중치에 그대로 쓰지 않고 `log1p` 변환값을 색인한다. 평점·리뷰 수는 스냅샷 최신값만 색인하고, 추세는 관계형 DB에서 조회한다.

---

## 11. 수집·정제 파이프라인

```text
CategoryId·QueryType 조합 생성 -> metadata/range_plan.json
  -> ItemList / ItemSearch 페이지 순회 (start<=20, itemId 중복 검사)
  -> raw/parts/ 에 원문 JSONL + .done.json 저장
  -> 쿼터 소진 시 정상 종료, 다음 날 이어서 수집
  -> categories 모드로 분야 목록 확장
  -> 우선순위 ISBN 선별
  -> ItemLookUp 상세 보강
  -> 파트 병합 + itemId 중복 제거 -> processed/items_normalized_{date}.jsonl
  -> reports/ 품질·결측 리포트 생성
  -> HTML 엔티티·문자열·숫자·분류·날짜 정규화
  -> isbn13 기준 국립중앙도서관 매칭
  -> book_aladin_item upsert / book_popularity_snapshot insert
  -> Elasticsearch 색인 갱신
```

### 초기 전체 수집

- `CategoryId=0`으로 시작해 `categories` 모드로 분야를 넓혀가는 2단계 방식을 쓴다.
- 한 조건은 20회 호출로 완주하므로, 하루 예산 4,800회를 조건 240개로 나눠 계획한다.
- `Bestseller`는 `--bestseller-year-from`으로 과거 주간까지 순회해 인기도 이력을 확보한다.
- 파트별 `.done.json`에 `stop_reason`을 남겨, 상한 도달과 실제 데이터 소진을 구분한다.
- 수집 완료 후 `itemId` 중복, `isbn13` 결측, 미래 `pubDate`, `0` 값 분포를 품질 리포트로 생성한다.

### 정기 갱신

| 대상 | 주기 | 방법 |
| --- | --- | --- |
| 판매지수·평점·순위 | 주 1회 | `Bestseller` 리스트 + 서비스 내 인기 도서 `lookup`. 스냅샷으로 append |
| 신간 | 주 1회 | `ItemNewAll` / `ItemNewSpecial` 분야별 순회 |
| 사용자 서재 등록 도서 | 등록 시 큐 적재 후 배치 | `lookup`으로 상세 보강 |
| 가격·재고 | 필요 시 | 표시용이므로 우선순위 낮음 |

레코드 삭제 여부가 API에서 명확하지 않으므로 기존 데이터를 즉시 삭제하지 않는다. 절판은 `priceSales = 0` 또는 조회 결과 0건으로 나타나므로 `is_purchasable = false`로 표시하고 이력을 남긴다.

### 배치와 사용자 요청 분리

| 구분 | 수집 대상 |
| --- | --- |
| 배치 필수 | `itemId`, `isbn13`, 제목, 저자, 출판사, 출간일, 분류, 표지, 판매지수, 평점 |
| 배치 보강 | 쪽수, 판형, 부가기호, 부제, 원서명, 전자책 연결, 중고 정보 |
| 사용자 요청 시 | Master에 없는 ISBN의 단건 `lookup` (쿼터 여유분 내에서, 결과는 즉시 캐시) |
| 우리 DB에서 즉시 조회 | 서재, 평점, 리뷰, 독서 상태, BOOK DNA |

**사용자 화면 요청마다 알라딘 API를 호출하지 않는다.** 하루 5,000회는 사용자 트래픽을 감당할 수 없는 규모다. 기본은 배치 적재 데이터로 응답하고, 실시간 호출은 캐시 미스에 한해 예산을 따로 떼어 관리한다.

---

## 12. 추천 시스템에서의 사용 범위

### 직접 사용할 Feature

| Feature | 입력 | 계산 예시 |
| --- | --- | --- |
| 인기도 | `salesPoint` | `log1p(sales_point)`를 0~1로 정규화 |
| 평점 품질 | `ratingInfo.ratingScore`, `ratingCount` | 참여 수를 신뢰도로 쓴 베이지안 평균 |
| 세부 카테고리 유사도 | `categoryIdList`, `category_path` | 사용자 선호 분야 분포와 후보 분야 경로의 계층 가중 일치도 |
| 분야 다양성 | `category_top` | 추천 결과 내 대분류 분산 제어 |
| 쪽수 적합도 | `subInfo.itemPage` | 사용자 선호 쪽수 구간과의 거리 점수 |
| 신간 선호도 | `pubDate` | 시간 감쇠 점수 |
| 판형 선호도 | `packing.styleDesc` | 양장·반양장 선호 일치율 |
| 시리즈 연결 | `seriesInfo.seriesId` | 읽은 책의 시리즈 내 다음 권 추천 |
| 전자책 선호 | `mallType`, `subInfo.ebookList` | 종이책·전자책 선호 일치 |
| 트렌드 | `book_popularity_snapshot` 추세 | 최근 순위 상승 폭 |

### 직접 사용하지 않는 값

- `mileage`, `priceSales`, `priceStandard`: 사용자 가격 민감도 데이터가 없으면 추천 점수에 넣지 않는다. 표시용이다.
- `stockStatus`, `is_purchasable`: 취향이 아니라 노출 필터다.
- `c2bsales`, `c2bsales_price`, `usedList`: 중고 정보는 표시용이다.
- `customerReviewRank`: `ratingScore`가 있으면 그쪽을 쓴다. 정수 반올림값이라 정보량이 적다.
- `bestRank`, `bestDuration`: 인기도는 `salesPoint`로 이미 반영된다. 추천 이유 문구 생성에만 쓴다.
- `description`: 45.33% 결측이므로 단독 임베딩 소스로 쓰지 않는다.

### 결측 처리

`salesPoint = 0`, `ratingScore = 0`을 0점으로 넣으면 신간과 무평점 도서가 구조적으로 불리해진다. 국립중앙도서관 문서와 같은 재정규화를 적용한다.

```text
normalized_score
  = sum(weight_i * feature_i * available_i)
    / sum(weight_i * available_i)
```

`salesPoint`가 없는 신간에는 `pubDate` 기반 신간 가중치를 별도로 부여해, 인기도 결측이 곧 배제가 되지 않게 한다.

---

## 13. MVP 우선순위

### MVP에 필수

1. `itemId` 기준 알라딘 레코드 저장 및 `isbn13` 기준 국립중앙도서관 매칭
2. `list` 모드 분야 순회로 기본 21개 필드 확보
3. 쿼터 관리·파트 재개 수집 (하루 한도 안에서 며칠에 걸친 수집)
4. `""` / `0` 결측 정규화 및 필드별 `0` 의미 분기
5. `categoryName` 계층 분해 및 검색 필터 연동
6. `salesPoint`·`ratingScore` 기반 인기도·평점 Feature
7. `cover` 표지 및 `pubDate` 출간일을 국립중앙도서관 값보다 우선 적용
8. `start > 20` 되돌이 방지 및 `itemId` 중복 제거

### 있으면 좋음

1. `lookup` 모드로 우선순위 도서 상세 보강 (쪽수·판형·부가기호)
2. `book_popularity_snapshot` 주간 적재 및 트렌드 Feature
3. `title` 부제 분리, `author` 역할 파싱
4. `seriesInfo` 기반 시리즈 다음 권 추천
5. `subBarcode`와 국립중앙도서관 `EA_ADD_CODE` 교차 검증
6. `subInfo.ebookList` 기반 종이책–전자책 판본 연결
7. 필드별 출처·신뢰도 관리

### 시간 남으면 구현

1. 프리미엄 키 신청 후 목차·상세 설명 확보 및 임베딩
2. 과거 주간 베스트셀러 전량 수집으로 장기 인기도 시계열 구축
3. `bestSellerRank`·`bestDuration` 파싱 기반 추천 이유 문구 생성
4. 중고 가격 정보 표시
5. 외국도서 스키마 차이(`fixedPrice` 부재 등) 전용 처리

---

## 14. 결론

알라딘 Open API는 다음 용도로 사용한다.

- 국립중앙도서관 Master Catalog의 **보강 소스**: 표지·출간일·쪽수·판형·세부 카테고리
- **인기도·평점 Feature의 유일한 소스**: `salesPoint`, `ratingInfo`
- 시리즈·전자책 판본 관계 확보
- 검색 결과 정렬 가중치 제공

반대로 다음 용도에는 사용하지 않는다.

- 전체 도서 Master Catalog 구축 — 전량 덤프가 없고 한 조건당 1,000건 상한이 있다
- 사용자 화면 요청마다의 실시간 조회 — 하루 5,000회로는 트래픽을 감당할 수 없다
- 목차·상세 설명 기반 임베딩 — 기본형 키로는 해당 필드를 받을 수 없다
- ISBN의 단일 기준 — `isbn13`이 5.67% 결측이고 `isbn`은 ISBN이 아니다

따라서 도서 판본의 기준 서지는 국립중앙도서관에 두고, 알라딘 데이터는 `book_aladin_item`과 `book_popularity_snapshot`으로 분리 저장해 `isbn13`으로 연결한다. 상용 서비스 전환 시에는 법인사업자 이용 제한 조항부터 재검토해야 한다.

### 참고 링크

- [알라딘 Open API 매뉴얼](https://docs.google.com/document/d/1mX-WxuoGs8Hy-QalhHcvuV17n50uGI2Sg_GHofgiePE/mobilebasic)
- [알라딘 OpenAPI 이용 안내](https://blog.aladin.co.kr/openapi/popup/5353304)
- [알라딘 상품 API 안내](https://blog.aladin.co.kr/openapi/popup/5353294)
- [알라딘 OpenAPI 블로그](https://blog.aladin.co.kr/openapi)
- [외부 API 데이터 저장 표준](../API_DATA_STANDARD.md)
- [국립중앙도서관 ISBN 서지정보 API](../국립중앙도서관/NATIONAL_LIBRARY_ISBN_API.md)
