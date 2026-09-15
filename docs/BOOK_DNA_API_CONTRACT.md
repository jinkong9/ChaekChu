# Book DNA API 계약서

> 상태: 설계 v1
> 관련 Jira: `S15P21B102-180`~`S15P21B102-186`
> 대상 스토리: `S15P21B102-154`

이 문서는 BOOK DNA 화면을 실제 사용자 서재와 책 DNA 데이터에 연결하기 위한
백엔드·FastAPI·프론트 공통 계약이다. DNA 조회 시 GMS를 호출하지 않으며, 책별
임베딩·태그·분류·대출 feature는 오프라인 배치에서 미리 생성한다.

## 1. 책임과 호출 흐름

```text
Frontend
  GET /api/v1/users/me/dna
        ↓
Spring Boot
  인증·서재/평점 조회 → AI request 변환
        ↓
FastAPI
  POST /internal/v1/dna/profile
  Qdrant에서 책 DNA 조회 → 사용자 DNA 계산
        ↓
Spring Boot
  AI profile + canonical BookSummary 결합
        ↓
Frontend
  레이더·지표·키워드·독서타입 렌더링
```

| 영역 | 책임 |
| --- | --- |
| 데이터 배치 | ISBN별 embedding·tag·KDC·대출 feature 생성 및 Qdrant 색인 |
| FastAPI | 사용자 도서 seed를 책 DNA와 결합해 profile 계산 |
| Spring Boot | 인증, 사용자 서재 조회, AI 호출, 공개 응답·캐시 |
| Frontend | 응답 표시, 표지 색상·애니메이션, 가챠·월드컵·사주 UI |

프론트는 사용자 서재의 원천 데이터를 직접 집계하지 않는다. AI profile의 점수와
타입은 FastAPI 응답을 사용하고, 화면에 필요한 책 상세·표지는 백엔드가 제공한다.

## 2. 공개 API

### `GET /api/v1/users/me/dna`

로그인한 사용자의 BOOK DNA를 반환한다.

- 인증: `Authorization: Bearer <JWT>` 필수
- query parameter: 없음
- 최신 profile을 반환하며, 구현 시 동일 입력·버전 결과를 캐시할 수 있다.
- 데이터가 부족해도 `200`으로 반환하고 `profile.status`로 상태를 구분한다.

### 2.1 공개 응답 DTO

```json
{
  "generatedAt": "2026-09-15T10:30:00Z",
  "dnaVersion": "book-dna-v1",
  "modelVersion": "gms-text-embedding-3-small-20260909-1000",
  "indexVersion": "d4l-small-scale-450000-20260915",
  "tagVersion": "d4l-tags-scale-450000-20260915",
  "declaredTags": ["FICTION", "SCIENCE"],
  "readCount": 23,
  "books": [
    {
      "bookId": "88123",
      "isbn13": "9788936434120",
      "title": "소년이 온다",
      "authors": ["한강"],
      "classNo": "813.62",
      "category": "문학 > 한국문학",
      "coverUrl": "https://example.com/cover.jpg",
      "rating": 5,
      "finishedDate": "2026-08-30"
    }
  ],
  "profile": {
    "status": "READY",
    "basedOnCount": 23,
    "axes": [
      { "code": "FICTION", "label": "소설", "score": 82.4 }
    ],
    "metrics": [
      { "code": "IMMERSION", "label": "몰입", "score": 88.1 }
    ],
    "keywords": [
      { "code": "RELATIONSHIP", "label": "관계", "score": 84.2 }
    ],
    "type": {
      "code": "EMPATH",
      "name": "감성적인 공감가",
      "phrase": "사람의 마음이 움직이는 순간을 따라 읽는",
      "summary": "사람과 관계를 다룬 이야기를 오래 기억하는 독자예요."
    },
    "evidence": {
      "readBookCount": 23,
      "ratedBookCount": 18,
      "topGenres": ["FICTION", "ESSAY"],
      "topTags": ["FIC", "FAMILY"]
    }
  }
}
```

### 2.2 필드 규칙

| 필드 | 타입 | 규칙 |
| --- | --- | --- |
| `generatedAt` | ISO-8601 string | profile 계산 시각(UTC) |
| `dnaVersion` | string | DNA 계산 로직 버전 |
| `modelVersion` | string | 임베딩 모델 또는 profile 모델 버전 |
| `indexVersion` | string | 사용한 책 Qdrant index 버전 |
| `tagVersion` | string | 사용한 태그 taxonomy/index 버전 |
| `declaredTags` | string[] | 사용자가 선택한 공개 taxonomy code |
| `readCount` | integer | DNA 계산에 사용한 READ·seed 도서 수 |
| `books` | BookSummary[] | 최대 200권, `finishedDate` 내림차순, null은 마지막 |
| `profile.status` | enum | `READY` 또는 `INSUFFICIENT_DATA` |
| `profile.basedOnCount` | integer | 실제 계산에 사용된 유효 도서 수 |
| `score` | number | 0 이상 100 이하 |

공개 응답의 `axes[].code`, `keywords[].code`, `evidence.topGenres`는 백엔드 공개
taxonomy를 사용한다. AI 내부 태그가 공개 사전에 없는 경우 label을 임의로 만들지
않고 `evidence.topTags` 또는 내부 근거로만 남긴다.

`books`는 표지·책 상세 표시를 위한 근거 데이터다. AI가 책 상세 정보를 생성하지
않으며, 백엔드 canonical book 데이터와 결합해 반환한다.

## 3. 내부 FastAPI API

### `POST /internal/v1/dna/profile`

백엔드가 인증된 사용자의 서재 snapshot을 전달하면 AI가 profile만 계산한다.

```json
{
  "requestId": "dna-8-20260915-001",
  "userId": "8",
  "declaredTags": ["FICTION", "SCIENCE"],
  "books": [
    {
      "isbn13": "9788936434120",
      "status": "READ",
      "rating": 5,
      "finishedDate": "2026-08-30"
    },
    {
      "isbn13": "9788954646079",
      "status": "WISH",
      "rating": null,
      "finishedDate": null
    }
  ]
}
```

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | ---: | --- |
| `requestId` | string | O | 로그·재시도 추적 키 |
| `userId` | string | O | 백엔드가 인증으로 확정한 사용자 식별자 |
| `declaredTags` | string[] |  | 공개 taxonomy code, 없으면 `[]` |
| `books` | array | O | 최대 200권, 중복 ISBN13은 하나로 취급 |
| `books[].isbn13` | string | O | 숫자 13자리 ISBN13 |
| `books[].status` | `READ \| WISH` | O | DNA 계산은 READ를 중심으로 사용 |
| `books[].rating` | integer/null |  | 1~5, 미평가면 null |
| `books[].finishedDate` | date/null |  | `YYYY-MM-DD`, 미완독·seed는 null |

### 3.1 내부 응답 DTO

```json
{
  "requestId": "dna-8-20260915-001",
  "dnaVersion": "book-dna-v1",
  "modelVersion": "gms-text-embedding-3-small-20260909-1000",
  "indexVersion": "d4l-small-scale-450000-20260915",
  "tagVersion": "d4l-tags-scale-450000-20260915",
  "profile": {
    "status": "READY",
    "basedOnCount": 22,
    "axes": [],
    "metrics": [],
    "keywords": [],
    "type": null,
    "evidence": {}
  },
  "unresolvedIsbns": []
}
```

FastAPI는 사용자 개인정보나 책 제목 원문을 응답에 새로 생성하지 않는다. Qdrant에서
ISBN으로 찾지 못한 도서는 `unresolvedIsbns`에 기록하고 나머지 도서로 계산한다.

## 4. 계산 규칙

1. `READ` 도서를 우선 사용하고, `WISH`는 기본 profile에서 보조 신호로만 사용한다.
2. 평점이 높고 최근에 읽은 책일수록 user DNA에 큰 가중치를 준다.
3. 책별 embedding의 가중 평균을 사용자 semantic vector로 계산한다.
4. 책 태그·공개 장르를 가중 집계해 axes와 keywords를 계산한다.
5. 대출 연령·성별 feature는 사용자 프로필에 직접 노출하지 않고, 추천 보조 근거로만 사용한다.
6. 동일 작품·중복 ISBN은 한 권으로 계산한다.
7. 유효 도서가 0권이면 `INSUFFICIENT_DATA`와 빈 profile을 반환한다.
8. profile 문장과 독서타입은 초기 버전에서 결정적 템플릿으로 생성한다. 온라인 GMS 호출은 하지 않는다.

## 5. 오류·fallback

| 상황 | HTTP | 처리 |
| --- | ---: | --- |
| 정상 profile | 200 | `READY` 반환 |
| 유효 도서 부족 | 200 | `INSUFFICIENT_DATA`, 빈 지표 또는 제한된 지표 반환 |
| 중복·잘못된 ISBN 일부 | 200 | 유효 도서만 계산, `unresolvedIsbns` 기록 |
| 요청 DTO 오류 | 422 | 필드 오류 반환 |
| Qdrant timeout/장애 | 503 | 백엔드가 마지막 profile 또는 안내 응답 사용 |
| 내부 예기치 않은 오류 | 500 | 민감정보 없이 errorId만 로그 |

DNA 실패가 검색·서재·추천 API까지 실패시키면 안 된다. 백엔드는 DNA 화면에 오류
안내를 표시하고 기존 캐시가 있으면 마지막 성공 profile을 사용할 수 있다.

## 6. 버전·캐시·보안

- profile cache key: `userId + libraryUpdatedAt + dnaVersion + indexVersion + tagVersion`
- 책 index가 바뀌면 profile을 재계산하지만, 변경되지 않은 책 DNA는 재생성하지 않는다.
- 공개 응답에는 `userId`를 반환하지 않는다.
- AI 내부 API는 Docker 내부 네트워크에서만 호출하고 외부에 공개하지 않는다.
- request log에는 requestId·버전·도서 수·처리 시간만 남긴다.
- GMS key와 Qdrant key는 응답·로그·문서에 포함하지 않는다.

## 7. 구현 순서

```text
#180 계약·DTO 문서
  → #181 AI profile 계산 엔진
  → #182 FastAPI endpoint
  → #183 백엔드 공개 API·adapter
  → #184 프론트 mock 제거
  → #185 품질·통합 검증
  → #186 운영·버전·캐시 문서화
```
