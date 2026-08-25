# 도서 데이터 활용 및 추천 시스템 설계

이 문서는 `database` 폴더에 수집된 도서 API들을 우리 서비스의 도서 Master, 검색, 개인화 추천에 어떻게 사용할지 정리한 공통 설계 문서다.

현재 기준으로 국립중앙도서관을 Master Catalog로 사용하고, YES24·알라딘·카카오·정보나루를 보강 데이터로 사용한다.

## 1. 최종 데이터 흐름

```text
국립중앙도서관
  -> BOOK_EDITION Master

정보나루
  -> 국립중앙도서관 결측 필드 보강

YES24·알라딘·카카오
  -> 표지·설명·카테고리·페이지·출간일 보강

우리 서비스 DB
  -> 평점·리뷰·서재·읽기 상태·BOOK DNA

Elasticsearch
  -> 검색·후보 생성·벡터 검색

추천 후보 생성
  -> 사용자 BOOK DNA 결합
  -> Ranking
  -> 추천 이유 생성
```

---

## 2. 현재 데이터 기준 판단

| API | 현재 확인 규모 | 핵심 역할 | 주의점 |
| --- | ---: | --- | --- |
| 국립중앙도서관 | 2,047,239건 | 전체 도서 판본 Master | 설명·요약·페이지 결측이 높음 |
| YES24 | 상세 성공 19,751건 | 페이지·표지·출간일·책소개·목차 | 신상품 편향, YES24 내부 판매지수 |
| 알라딘 | 필드 조사 300건, 상세 7건 | 카테고리·표지·설명·상세 평점 | 전체 대표성이 낮은 표본 |
| 카카오 | Raw 429,399건, 중복 제거 254,640건 | 책소개·표지·ISBN 보강 | 검색어 기반 수집 편향 |
| 정보나루 | gap 978,291건 중 460건 처리 | 국립중앙도서관 결측 보강 | 현재 `loaninfoYN=N`, 대출 통계 아님 |

### 정보나루의 현재 역할

현재 정보나루 파이프라인은 `srchDtlList`에 `loaninfoYN=N`으로 요청한다. 따라서 현재 수집 데이터에는 대출량·함께 대출한 책·연령별 인기도가 없다.

현재는 다음 결측 필드를 보강하는 용도로만 사용한다.

```text
TITLE
AUTHOR
PUBLISHER
EA_ISBN
EA_ADD_CODE
KDC
BOOK_INTRODUCTION
TITLE_URL
VOL
```

460건 기준으로 `TITLE`, `AUTHOR`, `EA_ISBN`은 모두 확보됐지만, 전체 gap 대상 978,291건 중 극히 일부만 처리된 상태다. 현재 히트율 100%를 전체 데이터의 히트율로 일반화하지 않는다.

#### 인기대출·함께대출 수집 계획 (MVP 승격)

결측 보강(gap 배치)과 별개로, 다음 두 API를 W1(9/1~9/7)에 수집한다.

- 인기대출 조회(`loanItemSrch`): 세그먼트(연령×성별)별 상위 N권. 신규 사용자 콜드스타트 폴백의 데이터 소스. 세그먼트당 상위 N권 조회라 gap 배치와 달리 소규모 작업이다.
- 도서별 이용분석: 추천 풀 상위 도서 대상 함께 대출 목록. 연관 도서 섹션·후보 생성과 콘텐츠 유사도의 오프라인 검증(정답지)에 사용한다.

### 카카오의 현재 역할

카카오는 최신 수집 결과에서 책소개와 표지 데이터의 확보율이 높다.

- 정규화·중복 제거 후 254,640건
- 중복 제거 174,759건
- 유효하지 않은 ISBN 5,235건
- `contents` 결측 19.00%
- `thumbnail` 결측 6.20%
- `isbn13_normalized` 결측 2.06%

따라서 카카오는 Master가 아니라 설명·표지·ISBN 보조 소스로 사용한다. `source_query`, `source_target`, `collected_at`을 함께 저장해 검색어 편향과 수집 시점을 추적한다.

---

## 3. API별 저장 위치와 사용처

### 3.1 관계형 DB

#### `book_work`

동일 작품의 여러 판본을 묶는 단위다.

```text
id
canonical_title
canonical_author
work_group_confidence
created_at
updated_at
```

#### `book_edition`

ISBN 단위의 실제 판본이다. 종이책·전자책·개정판·세트 낱권을 합치지 않는다.

```text
id
work_id
isbn13
isbn10
isbn_raw
isbn_valid
title
author_raw
publisher
publication_date
planned_publication_date
page_count
page_raw
ebook_yn
subject_code
kdc
audience_code
publication_form_code
content_code
cover_url
description
data_quality
created_at
updated_at
```

#### `book_source_snapshot`

외부 API의 원본과 출처를 보존한다.

```text
book_edition_id
source_name
external_id
raw_payload
collected_at
source_updated_at
```

#### `book_metric_snapshot`

가격·판매지수·대출량·평점처럼 시점에 따라 변하는 값이다.

```text
book_edition_id
source_name
metric_name
metric_value
collected_at
```

가격과 판매지수는 `book_edition`에 직접 저장하지 않는다.

### 3.2 Elasticsearch

검색과 추천 후보 생성에 필요한 정제 필드만 색인한다.

```text
book_id
isbn13
title
title_search
author
author_search
publisher
subject_code
kdc
category_path
audience_code
publication_form_code
content_code
ebook_yn
publication_date
page_count
description
description_vector
cover_url
series_title
```

사용자 평점·리뷰·읽기 상태·독서 날짜는 도서 인덱스에 중복 저장하지 않고 관계형 DB에서 관리한다.

---

## 4. 필드별 Source Priority

외부 API가 값을 제공하더라도 국립중앙도서관 값을 무조건 덮어쓰지 않는다. 원본값과 정제값, 출처를 함께 보존한다.

| 필드 | 우선 출처 | 사용 방법 |
| --- | --- | --- |
| ISBN-13 | 국립중앙도서관 | Master·JOIN 기준 |
| ISBN 보조 검증 | YES24·알라딘·카카오 | ISBN-13 일치 여부 확인 |
| 제목·저자·출판사 | 국립중앙도서관 | 기준값. 외부 값은 결측·오류 보강용 |
| 실제 출간일 | 유효한 알라딘 `pubDate` 또는 YES24 `publishDate` | 날짜 검증 후 후보값으로 사용 |
| 출판예정일 | 국립중앙도서관 `PUBLISH_PREDATE` | 실제 출간일과 별도 저장 |
| 표지 | 알라딘 → YES24 → 카카오 → 정보나루 → 국립중앙도서관 | 접근 가능한 정상 URL 선택 |
| 책소개 | 카카오 `contents` → 알라딘 `description` → YES24 `bookIntroduction` → 정보나루 `description` | 텍스트 정규화 후 임베딩 |
| 목차 | YES24 → 알라딘 상세 | 검색·임베딩 보조 |
| 페이지 | YES24 `pages` → 알라딘 `subInfo.itemPage` → 국립중앙도서관 `PAGE` | 숫자 파싱 성공한 값만 사용 |
| 대분류 | 국립중앙도서관 `SUBJECT`, `EA_ADD_CODE` | BOOK DNA 핵심 Feature |
| 세부 카테고리 | 알라딘 `categoryName` | 계층 경로로 저장 |
| 보조 카테고리 | YES24 `goodsSortNm` | 검색·필터 보조 |
| 가격 | YES24·알라딘·카카오 | 화면 표시용 Snapshot |
| 평점 | 알라딘 상세 `ratingScore` + `ratingCount` | 표본·시점 보조 정보 |
| 판매지수 | 알라딘 `salesPoint`, YES24 `salePoint` | 출처별 보조 지표. 전체 인기도로 해석하지 않음 |
| 대출량·함께 대출 | 정보나루 대출 API 추가 후 | 추천 Ranking에 추가 |

### JOIN 규칙

```text
1. 유효한 ISBN-13
2. ISBN-10을 ISBN-13으로 변환
3. ISBN이 없을 때만 제목·저자·출판사 후보 매칭
```

카카오의 `isbn`처럼 ISBN-10과 ISBN-13이 한 문자열에 함께 들어오는 값은 분리·체크섬 검증 후 사용한다. 알라딘의 `isbn`은 ISBN-10이 아니라 `K...`, `E...` 형태의 상품 코드일 수 있으므로 JOIN에 사용하지 않는다.

---

## 5. 추천 시스템 설계

### 5.1 사용자 BOOK DNA

사용자가 읽고 높은 평점을 준 도서를 기준으로 다음을 집계한다.

```text
subject_distribution
kdc_distribution
aladin_category_distribution
ea_add_code_distribution
author_affinity
page_preference
ebook_preference
publication_recency_preference
description_embedding_profile
```

외부 API는 사용자 취향을 직접 제공하지 않는다. 사용자 평점·서재·독서 이력이 BOOK DNA의 기준이다.

### 5.2 Candidate Generation

1. 사용자의 높은 평점 도서와 같은 작가
2. 같은 `SUBJECT`·KDC·알라딘 카테고리
3. 책소개·목차·카카오 `contents`의 텍스트/벡터 유사 도서
4. 같은 독자대상·발행형태·내용분류
5. 함께 대출한 도서 (W1 수집분부터 사용)

후보 생성 단계에서 다음 도서는 제거한다.

- 이미 읽은 책
- 현재 서재에 있는 책
- 같은 작품의 중복 판본
- ISBN 검증 실패 도서
- 성인 제한 등 서비스 정책에 걸린 도서

### 신규 사용자 콜드스타트

행동이 없는 사용자는 위 후보 생성이 동작하지 않으므로 다음 계단으로 폴백한다.

```text
0. 가입 정보만 있음   -> 세그먼트(연령×성별) 인기대출 상위
1. 관심 분야 선택     -> 분야 × 세그먼트 인기 상위
2. 읽은 책 1권 이상   -> 해당 도서의 텍스트 유사 + 함께 대출 후보부터 개인화 시작
3. 행동 축적          -> BOOK DNA 기반 개인화
```

행동이 쌓일수록 개인화 후보의 비중을 서서히 늘리고, 하드 스위치로 전환하지 않는다.

### 5.3 현재 MVP Ranking

MVP Ranking은 콘텐츠 기반으로 시작한다. 대출 Feature의 Ranking 결합은 5.4에서 확장한다.

```text
score_mvp =
    0.35 * text_similarity
  + 0.25 * subject_category_similarity
  + 0.15 * author_affinity
  + 0.10 * page_fit
  + 0.10 * audience_form_fit
  + 0.05 * freshness
```

결측 Feature는 0점으로 넣지 않고, 사용 가능한 Feature만으로 가중치를 재정규화한다.

```text
normalized_score
  = sum(weight_i * feature_i * available_i)
    / sum(weight_i * available_i)
```

### 5.4 정보나루 대출 API 추가 후

대출량·함께 대출 데이터가 실제로 확보되면 다음 Feature를 추가한다.

```text
popularity_score
co_loan_score
age_group_popularity
gender_popularity
regional_popularity
trend_score
```

확장 Ranking 예시는 다음과 같다.

```text
score_extended =
    0.25 * text_similarity
  + 0.20 * subject_category_similarity
  + 0.15 * author_affinity
  + 0.15 * co_loan_score
  + 0.10 * popularity_score
  + 0.10 * page_fit
  + 0.05 * freshness
```

판매지수와 대출량은 서로 다른 모집단이므로 하나의 값으로 바로 합치지 않는다. 각각 출처별로 정규화한 후 보조 지표로 결합한다.

### 5.5 추천 이유

Ranking Feature의 근거를 함께 저장하면 설명 가능한 추천을 만들 수 있다.

```text
reason_type: SUBJECT_MATCH
reason_value: 한국문학
reason_score: 0.87
source_book_id: ...
```

화면에는 다음처럼 표시한다.

```text
당신이 높은 평점을 준 책과 같은 한국문학 분야입니다.
평소 선호하는 300페이지 이하의 책입니다.
최근 읽은 책과 책소개 내용이 유사합니다.
```

---

## 6. 수집 전략

| 데이터 | 수집 방식 |
| --- | --- |
| 국립중앙도서관 Master | 대량 Batch |
| 정보나루 서지 보강 | 국립중앙도서관 결측 ISBN만 Batch |
| YES24 상세 | 필요한 ISBN만 Queue/Batch |
| 알라딘 상세 | 검색·추천 후보 중심 |
| 카카오 | 대량 보강 결과는 저장하되 ISBN 검증 후 사용 |
| 사용자 평점·리뷰 | 서비스 이용 시 즉시 저장 |
| 임베딩 | 설명·목차 확보 후 Batch |
| 대출·함께 대출 | W1부터 수집. 인기대출은 세그먼트별 상위 N권, 함께 대출은 추천 풀 상위 도서 대상 주기 Batch |

사용자 화면에서 외부 API를 직접 호출하지 않는다. 기본 응답은 DB·Elasticsearch에서 제공하고, 외부 API 호출은 배치 또는 별도 보강 Queue에서 처리한다.

---

## 7. 구현 우선순위

### MVP 필수

1. ISBN-10·13 정규화와 체크섬 검증
2. 국립중앙도서관 기반 `BOOK_EDITION` 구축
3. 정보나루 결측 보강 결과 병합
4. YES24·알라딘·카카오의 표지·설명·카테고리 보강
5. 출처별 Raw·정제값·수집일 저장
6. Elasticsearch 검색 색인
7. 사용자 평점 기반 BOOK DNA
8. 콘텐츠 기반 후보 생성·Ranking
9. 정보나루 인기대출·함께대출 수집과 세그먼트 콜드스타트 폴백

### 이후 구현

1. 책소개·목차·카카오 `contents` 임베딩
2. `BOOK_WORK` 작품 그룹핑
3. 대출 데이터 커버리지 확대(도서 단위 대출량·지역별 통계 등)
4. 인기도·트렌드 Feature 추가
5. 추천 이유와 Feature 근거 저장
6. 설명 가능한 추천 문구 생성

## 8. 최종 결론

현재 가장 현실적인 구조는 다음과 같다.

```text
국립중앙도서관 = 도서 판본의 기준
정보나루       = 국립중앙도서관 결측 보강 + 인기대출·함께대출
YES24          = 상세 상품 정보 보강
알라딘         = 카테고리·상세 평점·설명 보강
카카오         = 책소개·표지·ISBN fallback
우리 서비스 DB  = 사용자 취향과 행동
Elasticsearch  = 검색·추천 후보 생성
```

콘텐츠 기반 추천을 먼저 구현하되, 인기대출·함께대출은 W1에 수집해 신규 사용자 콜드스타트 폴백과 연관 도서 섹션에 먼저 사용한다. 인기도·함께대출 Feature의 Ranking 결합(5.4)은 이후 확장으로 진행한다.

### 세부 문서

- [국립중앙도서관](./국립중앙도서관/NATIONAL_LIBRARY_ISBN_API.md)
- [YES24](./yes24/YES24_API.md)
- [알라딘](./알라딘/ALADIN_OPENAPI.md)
- [카카오](./카카오/KAKAO_BOOK_SEARCH_API.md)
- [정보나루](./정보나루/DATA4LIBRARY_API.md)
