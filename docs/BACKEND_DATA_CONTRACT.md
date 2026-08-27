# 백엔드 공통 데이터 계약

> Jira: `S15P21B102-14`
>
> 이 문서는 외부 도서 데이터, PostgreSQL 원천 모델, Elasticsearch 읽기 모델,
> Spring Boot API가 공유하는 필드명과 값 규칙을 정의한다.

## 1. 계약의 범위

### 포함

- 도서 판본 중심의 `Book` 모델과 작품 그룹(`BookWork`) 관계
- 외부 API 원본과 표준 도서 데이터의 필드 매핑
- 회원·서재·평점·추천·이벤트의 공통 필드명과 타입
- ISBN, 문자열, 날짜, 결측값, 출처, 상태값 규칙
- 검색·추천·화면 응답에서 사용할 필드

### 제외

- 실제 Flyway DDL과 JPA Entity 구현
- Elasticsearch mapping JSON
- API별 수집기와 ISBN 변환 코드
- 추천 점수 계산 로직

위 구현은 각각 `S15P21B102-18` 이후 작업에서 이 계약을 기준으로 진행한다.

## 2. 공통 타입과 식별자

| 구분 | 계약 | 비고 |
| --- | --- | --- |
| 내부 식별자 | `string` 형태의 opaque `bookId`/`userId`/`recommendationId` | DB PK의 구체 타입은 Database Model 작업에서 결정. API는 구현 타입에 의존하지 않음 |
| 표준 도서 식별자 | `isbn13: string` | 하이픈 없는 13자리 숫자, 외부 JOIN·중복 제거의 기준 |
| 보조 도서 식별자 | `isbn10: string \| null` | 하이픈 없는 10자리, 마지막 `X` 허용 |
| 외부 식별자 | `sourceBookId: string \| null` | `itemId`, `volumeId` 등 출처별 값. ISBN으로 대체하지 않음 |
| 날짜 | `YYYY-MM-DD` | 출간일처럼 날짜만 의미할 때 사용 |
| 일시 | ISO-8601 UTC date-time | 수집·생성·수정 시각. 예: `2026-08-26T04:00:00Z` |
| 금액 | `integer \| null` | 통화가 명시되지 않은 외부 가격은 표시용 보조값으로만 사용 |
| 비율·점수 | `number` | 추천 score는 0 이상으로 저장하고 정렬 기준을 별도로 기록 |
| 목록 | `array` | 순서가 의미 없으면 정규화 단계에서 중복 제거 |
| 결측 | canonical 모델은 `null` | 빈 문자열·공백·`-`·`N/A`·`없음`은 정제 시 `null`로 통일 |

### 2.1 ISBN 규칙

1. 원본 ISBN에서 하이픈과 공백을 제거한다.
2. ISBN-10 또는 ISBN-13 자리수와 체크섬을 검증한다.
3. 유효한 ISBN-10은 ISBN-13으로 변환한다.
4. `isbn13`을 외부 데이터 JOIN, 중복 제거, Elasticsearch 문서 식별의 기준으로 사용한다.
5. ISBN이 없는 레코드는 원본으로 보관할 수 있지만 표준 검색 도서로 확정하지 않는다.
6. 검증에 실패한 값은 버리지 않고 `isbnRaw`, 검증 결과, 실패 사유를 source record에 남긴다.
7. 제목·저자·출판사가 같다는 이유만으로 ISBN이 다른 판본을 합치지 않는다.

`isbn13`은 숫자처럼 보이더라도 문자열로 처리한다. 앞자리 0이 있는 ISBN-10과 외부 식별자의 보존을 위해 모든 식별자는 문자열로 유지한다.

### 2.2 문자열과 원문 보존

- canonical 문자열은 앞뒤 공백을 제거한다.
- HTML entity는 canonical 값에서 해석하되, source record에는 원문을 보존한다.
- 제목은 한글·영문·괄호·부호를 포함한 원문을 보존한다.
- 검색용 정규화 값은 원문과 별도 필드로 만든다. 원문을 덮어쓰지 않는다.
- 저자 원문에 포함된 `지음`, `옮김`, `편`, `역` 등의 역할 정보는 source record에 보존한다.

## 3. 도서 모델

ISBN은 판본 식별자이므로 서비스의 `Book`은 기본적으로 **판본(edition) 단위**다. 같은 작품의 개정판·전자책·세트·낱권은 ISBN 또는 출판 형태가 다르면 별도 `Book`으로 관리한다. 제목·저자 기반의 작품 묶음은 확정 병합이 아니라 `BookWork` 후보 관계로 관리한다.

### 3.1 `Book`

| 필드 | 타입 | 필수 | 용도·규칙 |
| --- | --- | ---: | --- |
| `bookId` | `string` | O | 내부 opaque 식별자 |
| `isbn13` | `string` | O* | 검증된 표준 JOIN 키. 검색용 도서는 필수. |
| `isbn10` | `string \| null` |  | 유효한 ISBN-10 보조 식별자 |
| `title` | `string` | O | canonical 제목 원문 |
| `subtitle` | `string \| null` |  | 부제. 원문에 섞여 있으면 정제 단계에서 분리하고 원문도 보존 |
| `authors` | `string[]` | O* | 역할이 제거된 검색·화면용 저자명 목록 |
| `publisher` | `string \| null` |  | canonical 출판사 |
| `publishedDate` | `date \| null` |  | 실제 출간일. 예정일은 별도 source 필드 |
| `categories` | `string[]` |  | 세부 주제·카테고리. 출처별 원래 경로도 source record에 보존 |
| `keywords` | `string[]` |  | 검색·추천 feature. 임의 키워드 생성 금지 |
| `description` | `string \| null` |  | 책소개·요약을 정제한 본문 |
| `coverImageUrl` | `string \| null` |  | 접근 가능한 표지 URL 후보 중 선택된 값 |
| `language` | `string \| null` |  | BCP-47에 가까운 값. 확인 불가하면 `null` |
| `pageCount` | `integer \| null` |  | 숫자로 검증된 쪽수만 저장 |
| `pageRaw` | `string \| null` |  | 자유 형식 원문. 파싱 실패 시에도 보존 |
| `publicationForm` | `string \| null` |  | 종이책·전자책 등 표준화된 형태 |
| `seriesTitle` | `string \| null` |  | 총서·시리즈명 |
| `volume` | `string \| null` |  | 권차. 숫자로 단정하지 않음 |
| `quality` | `object` | O | 결측·검증·충돌 상태 요약 |
| `createdAt` | `datetime` | O | canonical 레코드 생성 시각 |
| `updatedAt` | `datetime` | O | canonical 레코드 수정 시각 |

\* `isbn13`이 없는 외부 원본은 source record로 보관할 수 있으나, canonical `Book` 확정·검색 색인·사용자 서재 연결 대상에서는 제외한다.

`Book`에는 `rawPayload`와 API 키, 사용자 행동 데이터를 넣지 않는다. 원본 응답과 필드별 출처는 `BookSourceRecord`에 둔다.

### 3.1.1 `BookContentFeatures`

책소개·목차·카테고리에서 배치로 추출한 책 단위 콘텐츠 feature다. API의 공개 도서 기본 정보에 항상 노출할 필요는 없으며, 추천 계산 내부 입력으로 사용한다.

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `bookId` | `string` | O | 대상 도서 |
| `featureScores` | `Record<string, { score: number \| null, confidence: number }>` | O | 각 점수는 0~100, confidence는 0~1 |
| `featureVersion` | `string` | O | 추출 규칙·모델 버전 |
| `extractedAt` | `datetime` | O | 추출 시각 |

초기 feature taxonomy는 `timeRegression`, `fantasy`, `realistic`, `lightTone`, `emotionalIntensity`, `difficulty`처럼 해석 가능한 항목으로 시작한다. 콘텐츠에서 판단할 수 없는 값은 0으로 채우지 않고 `score = null`로 둔다.

### 3.2 `BookWork`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `workId` | `string` | O | 작품 그룹 opaque 식별자 |
| `canonicalTitle` | `string` | O | 작품 그룹 표시용 대표 제목 |
| `canonicalAuthor` | `string \| null` |  | 작품 그룹 대표 저자 |
| `workGroupConfidence` | `number \| null` |  | 자동 그룹핑 후보의 신뢰도. 확정 병합과 구분 |
| `createdAt` | `datetime` | O | 생성 시각 |
| `updatedAt` | `datetime` | O | 수정 시각 |

한 `BookWork`에 여러 ISBN 판본이 연결될 수 있지만, 같은 제목·저자라는 이유만으로 자동 확정하지 않는다. 세트·다권본은 `setIsbn13`, `volume`, `seriesTitle`과 별도 관계로 추적한다.

### 3.3 `BookSourceRecord`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `sourceRecordId` | `string` | O | source record 식별자 |
| `bookId` | `string \| null` |  | canonical 도서로 확정되기 전에는 null 가능 |
| `source` | `enum` | O | `NATIONAL_LIBRARY`, `YES24`, `ALADIN`, `KAKAO`, `GOOGLE_BOOKS`, `DATA4LIBRARY` |
| `sourceBookId` | `string \| null` |  | API별 상품·volume·내부 ID |
| `isbnRaw` | `string \| null` |  | 정규화 전 원문 |
| `rawPayloadRef` | `string` | O | Git에 넣지 않는 원본 파일 또는 object storage 참조 |
| `fieldSourceUpdatedAt` | `datetime \| null` |  | 출처가 제공한 수정 시각 |
| `collectedAt` | `datetime` | O | 우리 수집 시각 |
| `fieldConfidence` | `object` |  | 필드별 품질·선택 근거 |
| `validationErrors` | `string[]` |  | ISBN·날짜·필드 검증 실패 사유 |

canonical 필드에 출처가 다른 값을 병합하더라도 source record는 덮어쓰지 않는다. `fieldSource`, `fieldSourceUpdatedAt`, `fieldConfidence`를 기준으로 최종 선택값을 추적한다.

## 4. 사용자·행동 모델

### 4.1 `User`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `userId` | `string` | O | 내부 opaque 식별자 |
| `oauthProvider` | `enum` | O | `KAKAO` 또는 `GOOGLE` |
| `oauthSubject` | `string` | O | 제공자가 발급한 사용자 고유 식별자. `(oauthProvider, oauthSubject)` unique |
| `email` | `string \| null` |  | OAuth에서 제공된 이메일. 인증 식별자로 사용하지 않음 |
| `nickname` | `string \| null` |  | 화면 표시용 |
| `birthYear` | `integer \| null` |  | 세그먼트 계산 전용, 다른 사용자에게 공개하지 않음 |
| `gender` | `enum \| null` |  | 세그먼트 계산 전용 |
| `createdAt` | `datetime` | O | 생성 시각 |
| `updatedAt` | `datetime` | O | 수정 시각 |

초기 관심 분야와 seed book 평점은 `UserPreference`/`UserSeedBook` 관계로 저장한다. 사용자가 건너뛴 경우 빈 목록과 `skipped = true`를 구분할 수 있어야 한다.

### 4.2 `LibraryItem`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `libraryItemId` | `string` | O | 서재 항목 식별자 |
| `userId` | `string` | O | 소유 사용자 |
| `bookId` | `string` | O | canonical 도서 |
| `status` | `enum` | O | `WANT_TO_READ`, `READING`, `READ` |
| `finishedAt` | `date \| null` |  | `READ`일 때만 저장 |
| `createdAt` | `datetime` | O | 생성 시각 |
| `updatedAt` | `datetime` | O | 수정 시각 |

규칙:

- `(userId, bookId)`는 unique다.
- `WANT_TO_READ`는 좋아요·읽고 싶은 책 등록을 함께 의미한다. 별도 Like 모델을 만들지 않는다.
- 상태의 기본 흐름은 `WANT_TO_READ → READING → READ`다.
- 사용자는 상태를 직접 변경할 수 있다.
- `READ`로 변경할 때 `finishedAt`이 없으면 서버 기준 오늘 날짜를 저장한다.
- `READ`가 아닌 상태로 변경하면 `finishedAt`을 null로 만든다.
- `READING` 또는 `READ`인 항목은 WANT_TO_READ 취소만으로 삭제하지 않는다.

### 4.3 `BookRating`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `ratingId` | `string` | O | 평점 식별자 |
| `userId` | `string` | O | 평점 작성자 |
| `bookId` | `string` | O | 평가 대상 도서 |
| `rating` | `integer` | O | 1~5 정수 |
| `reviewText` | `string \| null` |  | 본인 독서 기록용 한 줄 감상평, 최대 300자 |
| `createdAt` | `datetime` | O | 생성 시각 |
| `updatedAt` | `datetime` | O | 수정 시각 |

인증은 카카오 OAuth와 Google OAuth(Gmail 계정)만 지원한다. 자체 회원가입·이메일/비밀번호 로그인은 제공하지 않으며, OAuth callback에서 provider와 subject를 검증한 뒤 최초 사용자 레코드를 생성하고 서비스 JWT를 발급한다. OAuth access token과 원 제공자 비밀번호는 서비스 DB에 저장하지 않는다.

`(userId, bookId)`는 unique다. 평점은 서재 상태와 별도로 저장한다. `reviewText`는 선택값이며 앞뒤 공백을 제거하고 빈 문자열은 `null`로 저장한다. 감상평은 본인 기록용으로만 제공하고 다른 사용자의 응답·검색 색인·추천 계산에는 포함하지 않는다.

MVP 추천 입력에는 평점·서재 상태·초기 취향만 사용한다. 감상평 원문은 다음 버전에서 사용자 동의와 활용 범위를 확정한 뒤 AI 분석 또는 개인화 feature로 사용할 수 있도록 보존한다.

### 4.4 `Recommendation`과 `RecommendationItem`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `recommendationId` | `string` | O | 추천 생성 단위 |
| `userId` | `string` | O | 추천 대상 사용자 |
| `modelVersion` | `string` | O | 계산·규칙 버전 |
| `weights` | `Record<FeatureKey, number>` | O | 해당 추천에 적용한 feature 가중치. 합계는 서버에서 정규화 |
| `generatedAt` | `datetime` | O | 생성 시각 |
| `items` | `RecommendationItem[]` | O | rank 순서로 반환 |

`RecommendationItem`은 다음 필드를 가진다.

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `bookId` | `string` | O | 추천 도서 |
| `rank` | `integer` | O | 1부터 시작, 추천 내부 unique |
| `score` | `number` | O | 계산 점수 |
| `featureScores` | `FeatureScore[]` | O | 후보별 feature 원점수. 각 점수는 0~100, 정보가 없으면 null |
| `reasonType` | `enum` | O | `SAME_AUTHOR`, `SAME_CATEGORY`, `TEXT_SIMILARITY`, `SEGMENT_POPULAR`, `DEMAND_POPULAR`, `MOMENTUM`, `NEW_BOOK`, `INITIAL_PREFERENCE` |
| `reasonText` | `string` | O | 카드에 항상 표시할 요약 이유 |

추천 결과에는 사용자의 서재에 이미 등록된 도서를 포함하지 않는다. 추천 계산 실패 시 마지막 성공 결과 또는 콜드스타트 결과를 사용할 수 있으며, 어느 전략으로 응답했는지는 `modelVersion`과 reason type으로 추적한다.

추천 생성 성공 시에만 `recommendationId` 단위의 결과 스냅샷을 DB에 저장한다. 같은 스냅샷을 반환하는 조회 요청마다 결과를 중복 저장하지 않는다. Redis가 활성화된 경우 최신 응답을 캐시할 수 있지만, 캐시 삭제·만료 후에도 DB의 최신 성공 스냅샷으로 응답할 수 있어야 한다. 화면에만 존재하는 임시 결과는 주 추천 응답으로 사용하지 않는다.

### 4.5 `UserEvent`

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `eventId` | `string` | O | 이벤트 식별자 |
| `userId` | `string \| null` |  | 비로그인 노출을 허용할 경우 null 가능 |
| `recommendationId` | `string \| null` |  | 추천 결과와 연결 |
| `bookId` | `string \| null` |  | 이벤트 대상 도서 |
| `eventType` | `enum` | O | `IMPRESSION`, `CLICK`, `REASON_VIEW` |
| `rank` | `integer \| null` |  | 노출 당시 추천 순위 |
| `occurredAt` | `datetime` | O | 클라이언트 발생 시각 |
| `createdAt` | `datetime` | O | 서버 수신 시각 |

이벤트 수집 실패는 검색·서재·추천 화면을 차단하지 않는다. 중복 전송 방지 키가 필요한 경우 `recommendationId + bookId + eventType + clientEventId`를 확장 필드로 사용하되, MVP에서는 저장 API 계약을 먼저 고정한다.

## 5. 외부 필드 매핑

### 5.1 표준 필드별 출처 우선순위

L0 카탈로그는 국립중앙도서관과 정보나루의 ISBN13 합집합이다. 출처별 원본과 온디맨드로 보강된 카카오 레코드는 `BookSourceRecord`로 추적하며, canonical `Book`은 검증된 ISBN13을 기준으로 하나만 만든다.

| canonical 필드 | 우선 출처 | 보강 출처 | 선택 규칙 |
| --- | --- | --- | --- |
| `isbn13` | 검증된 국립중앙도서관 | 검증된 모든 외부 API | 체크섬 통과 값만 JOIN 키로 사용 |
| `title` | 국립중앙도서관 공식 서지 | ISBN에 연결된 YES24·알라딘·카카오·Google | canonical 값은 덮어쓰지 않고 충돌을 기록 |
| `authors` | 국립중앙도서관 원문 | 정보나루·YES24·알라딘·카카오·Google | 역할 원문과 정제 목록을 분리 |
| `publisher` | 국립중앙도서관 | YES24·알라딘·카카오·Google | 판본 차이를 확인한 뒤 선택 |
| `categories` | 국중도 SUBJECT/KDC 대분류 | 알라딘·YES24·정보나루·Google | 외부 카테고리는 세부 feature로 보조 사용 |
| `publishedDate` | 정확한 외부 출간일 | 국중도 REAL_PUBLISH_DATE | 국중도 PUBLISH_PREDATE는 예정일로 분리 |
| `description` | YES24·정보나루·알라딘·카카오 | Google Books | Google description은 품질 확인 전 주 출처로 채택하지 않음 |
| `coverImageUrl` | 접근성과 품질이 확인된 YES24·알라딘 | 카카오·Google·정보나루 | 깨진 URL은 선택하지 않고 후보로 남김 |
| `pageCount` | 숫자로 검증된 YES24·알라딘 | 국중도 PAGE 파싱값 | 파싱 실패 시 `pageRaw`만 보존 |
| 대출 인기도 | 정보나루 | 없음 | 국중도·판매 API 지표와 혼용하지 않음 |

### 5.2 API별 필드 매핑

| 출처 | 원본 필드 | canonical 필드 | 처리 |
| --- | --- | --- | --- |
| 국립중앙도서관 | `EA_ISBN` | `isbn13`/`isbn10` | ISBN 타입 판별·체크섬 검증·ISBN13 변환 |
| 국립중앙도서관 | `TITLE` | `title` | 원문 보존 |
| 국립중앙도서관 | `AUTHOR` | `authors` | 역할 문자열을 보존하고 저자명 토큰을 별도 생성 |
| 국립중앙도서관 | `PUBLISHER` | `publisher` | 앞뒤 공백 정리 |
| 국립중앙도서관 | `SERIES_TITLE`, `SERIES_NO`, `VOL` | `seriesTitle`, `volume` | 권차를 문자열로 보존 |
| 국립중앙도서관 | `SUBJECT`, `KDC`, `DDC` | `categories` | 코드와 표시명 모두 source record에 보존 |
| 국립중앙도서관 | `PUBLISH_PREDATE` | `plannedPublicationDate` | 실제 출간일과 혼동하지 않음 |
| 국립중앙도서관 | `REAL_PUBLISH_DATE` | `publishedDate` 후보 | 날짜 형식·달력·미래일 검증 |
| 국립중앙도서관 | `PAGE` | `pageRaw`, `pageCount` 후보 | 숫자 파싱 성공 시에만 pageCount 저장 |
| 국립중앙도서관 | `TITLE_URL`/`cover_url` | `coverImageUrl` 후보 | 접근성 확인 후 선택 |
| 정보나루 | `book.isbn13` | `isbn13` | 국중도와의 JOIN 키 |
| 정보나루 | `book.bookname` | `title` | 국중도 결측 보강용 |
| 정보나루 | `book.authors` | `authors` | `지은이: ...;그림: ...` 형식 파싱 |
| 정보나루 | `book.publisher` | `publisher` | 국중도 결측 보강용 |
| 정보나루 | `book.description` | `description` | 책소개로 분류. `BOOK_INTRODUCTION` 성격 |
| 정보나루 | `book.bookImageURL` | `coverImageUrl` 후보 | URL 후보로 저장 |
| 정보나루 | `book.class_no`, `book.class_nm` | `categories` | KDC 기반 분류 |
| YES24 | `isbn13`, `isbn10` | `isbn13`, `isbn10` | 검증 후 저장 |
| YES24 | `title`, `subTitle`, `author`, `publisher` | `title`, `subtitle`, `authors`, `publisher` | `author` 역할 문자열 원문 보존 |
| YES24 | `publishDate` | `publishedDate` | `YYYYMMDD` 검증 후 변환 |
| YES24 | `contentDetail.bookIntroduction`, `bookSummary` | `description` | introduction을 우선 후보로 사용 |
| YES24 | `cover` | `coverImageUrl` 후보 | URL 접근성 확인 |
| YES24 | `pages` | `pageCount` | 정수일 때만 저장 |
| YES24 | `goodsSortNm` | `categories` | 판매 분류임을 출처 메타데이터로 구분 |
| 알라딘 | `isbn13` | `isbn13` | 빈 값·검증 실패는 null. `itemId`는 sourceBookId |
| 알라딘 | `title`, `author`, `publisher` | `title`, `authors`, `publisher` | HTML entity 해석, 원문 보존 |
| 알라딘 | `pubDate` | `publishedDate` | ISO date 검증 |
| 알라딘 | `description` | `description` 후보 | 빈 문자열과 placeholder는 null |
| 알라딘 | `cover` | `coverImageUrl` 후보 | URL 언이스케이프 |
| 알라딘 | `categoryName` | `categories` | 최상위 몰 구분은 제거하고 세부 분류부터 사용 |
| 알라딘 | `subInfo.itemPage` | `pageCount` | 숫자로 검증된 확장 필드 |
| 카카오 | `isbn13_normalized` | `isbn13` | 수집기 정규화 결과만 사용 |
| 카카오 | `title`, `authors`, `publisher` | `title`, `authors`, `publisher` | `authors` 배열 중복 제거 |
| 카카오 | `contents` | `description` 후보 | 책소개 본문으로 보강 |
| 카카오 | `datetime` | `publishedDate` 후보 | date 부분만 사용하고 출간일 확정 전 검증 |
| 카카오 | `thumbnail` | `coverImageUrl` 후보 | URL 후보로 저장 |
| Google Books | `volumeInfo.industryIdentifiers` | `isbn13`, `isbn10` 후보 | `ISBN_13` 타입과 요청값 일치 여부 검증 |
| Google Books | `volumeInfo.title`, `subtitle`, `authors`, `publisher` | `title`, `subtitle`, `authors`, `publisher` | 판본 일치 확인 |
| Google Books | `volumeInfo.publishedDate` | `publishedDate` 후보 | `YYYY`, `YYYY-MM`, `YYYY-MM-DD`를 구분. 완전한 날짜만 확정 |
| Google Books | `volumeInfo.description` | `description` 후보 | 실측 품질 편차가 있어 주 출처로 자동 채택하지 않음 |
| Google Books | `volumeInfo.categories`, `imageLinks` | `categories`, `coverImageUrl` 후보 | source record에 원본 경로 기록 |

### 5.3 충돌·결측 처리

- 외부 API가 값을 제공해도 기존 canonical 값을 무조건 덮어쓰지 않는다.
- 값이 충돌하면 출처 우선순위, ISBN 판본 일치, 최신 수집 시각, 품질 검증 결과로 선택하고 나머지는 source record에 남긴다.
- 국중도 원본의 빈 필드만 정보나루 정규화본으로 보강한다.
- 설명은 `BOOK_INTRODUCTION`과 `BOOK_SUMMARY`가 모두 비어 있을 때만 결측으로 판정한다.
- `0`은 필드별 의미가 다르므로 일괄 결측 처리하지 않는다. 예: 판매·평점 지표의 0과 쪽수 0을 구분한다.
- 미히트는 오류가 아니라 정상 결과일 수 있다. 재시도 대상과 미히트 결과를 구분해 기록한다.
- 대용량 raw/processed 파일은 Git에 커밋하지 않고, 샘플·리포트·메타데이터만 저장소에 둔다.

## 6. API 응답 기준

### 6.1 도서 검색 응답

검색 목록에는 다음 요약 필드만 제공한다.

```json
{
  "bookId": "opaque-book-id",
  "isbn13": "9791162574317",
  "title": "ROS2 로봇제작 1472",
  "authors": ["이제원", "허윤경", "김자경"],
  "publisher": "구미서관",
  "publishedDate": "2026-09-23",
  "coverImageUrl": "https://example.com/cover.jpg"
}
```

`rawPayload`, source API 내부 ID, 품질 계산 상세, 사용자 개인정보는 검색 응답에 포함하지 않는다.

### 6.2 도서 상세 응답

상세에는 검색 요약 필드에 더해 `subtitle`, `description`, `categories`, `pageCount`, `seriesTitle`, `volume`, `publicationForm`을 제공한다. 로그인 사용자의 경우에만 다음 사용자별 상태를 추가한다.

```json
{
  "libraryStatus": "WANT_TO_READ",
  "rating": 4,
  "reviewText": "전개가 빠르고 인물 묘사가 인상적이었다."
}
```

로그인 사용자는 자신의 `reviewText`를 조회·수정할 수 있다. 비로그인 사용자의 `libraryStatus`, `rating`, `reviewText`는 null이며, 다른 사용자의 상태와 감상평은 절대 노출하지 않는다.

## 7. 완료 체크리스트

- [x] ISBN13을 표준 JOIN·중복 제거 키로 확정
- [x] Book을 판본 단위로 정의하고 BookWork와 분리
- [x] Book/User/LibraryItem/BookRating/Recommendation/UserEvent 필드와 타입 확정
- [x] 좋아요를 `WANT_TO_READ`로 통합하고 별도 Like 모델을 배제
- [x] `WANT_TO_READ → READING → READ`, `finishedAt` 규칙 확정
- [x] 외부 API별 canonical 필드 매핑과 출처 우선순위 확정
- [x] 결측·중복·ISBN·날짜·원문 보존 규칙 확정
- [x] 검색·상세 응답에서 공개할 필드와 제외할 필드 확정

## 8. 다음 작업과 인계 사항

- `S15P21B102-17`: 이 문서의 타입과 실행 규칙을 Spring Boot 프로젝트에 반영
- `S15P21B102-18`: `BookWork`, `Book`, `BookSourceRecord` 및 사용자 도메인 Flyway schema 작성
- `S15P21B102-21`: ISBN 정규화·체크섬 검증을 공통 규칙으로 구현
- `S15P21B102-23`: `Book` 검색 필드와 `isbn13` 문서 식별을 Elasticsearch mapping에 반영
- `S15P21B102-15`: 응답 envelope·오류 코드·페이지네이션 형식을 API 계약으로 확장
