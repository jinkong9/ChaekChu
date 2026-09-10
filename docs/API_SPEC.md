# 백엔드 API 명세 (v1) — 현재 프론트 기준

> 작성 2026-09-07 · **갱신 2026-09-08** (서재 상태 `WISH`/`READ` 2단 · `progressPage` 제거 · 온보딩 seed 완독일 `null`) · 기준 브랜치 `dev` · 상위 계약 `docs/BACKEND_DATA_CONTRACT.md` · 화면 `frontend/src/**`
>
> 이 문서는 **지금 구현된 프론트가 실제로 호출하거나 자리만 비워 둔 것**을 기준으로 엔드포인트 하나하나의 요청·응답·규칙을 정한다.
> 필드명과 값 규칙은 `BACKEND_DATA_CONTRACT.md` 를 따르고, 그 문서가 「S15P21B102-15 에서 확장」으로 미뤄 둔
> **응답 형식·오류·페이지네이션·인증 흐름**을 여기서 확정한다. 프론트와 어긋나는 곳은 §9 에 모두 적었다.

## 0. 한눈에

| 영역 | 메서드 · 경로 | 인증 | 프론트 호출 위치 | 상태 |
| --- | --- | :-: | --- | --- |
| 인증 | `GET /auth/oauth/{provider}/authorize` | — | LandingPage | 구현 대상 |
| | `GET /auth/oauth/{provider}/callback` | — | (브라우저 리다이렉트) | 구현 대상 · **FE 콜백 라우트 필요** |
| 사용자 | `GET /users/me` | ● | (없음 — 새로고침 복원용) | 구현 대상 · FE 추가 |
| | `POST /users/me/profile` | ● | OnboardingPage 0단계 | 구현 대상 |
| | `POST /users/me/preferences` | ● | OnboardingPage 2단계 | 구현 대상 |
| | `GET /users/me/dna` | ● | DnaPage (현재 mock) | 구현 대상 · FE 연결 |
| 도서 | `GET /books/search` | ● | SearchPage | 구현 대상 |
| | `GET /books/popular` | ● | OnboardingPage 2단계 | 구현 대상 |
| | `GET /books/popular-segments` | ● | 홈 (현재 정적 JSON) | **구현(09-10)** · FE 연결 |
| 태그 | `GET /tags` | ● | (없음 — GENRES 하드코딩) | **구현(09-10)** · FE 연결 선택 |
| | `GET /books/{bookId}` | ● | BookDetailPage · 홈 링 | 구현 대상 · **ISBN13 도 받는다** |
| | `GET /books/{bookId}/similar` | ● | BookDetailPage 「비슷한 책」 스켈레톤 | 2차 |
| | `GET /books/{bookId}/co-loans` | ● | BookDetailPage 「함께 대출된 책」 스켈레톤 | 2차 |
| 추천 | `GET /recommendations` | ● | RecommendPage · TunePage | 구현 대상 |
| 서재 | `GET /library/me` | ● | LibraryPage* | **구현(09-10)** · FE 연결 |
| | `POST /library` | ● | RecommendPage · BookDetailPage | 구현 대상 · **응답 본문 필요** |
| | `PATCH /library/{libraryItemId}` | ● | LibraryList · LibraryPageB | 구현 대상 |
| | `DELETE /library/{libraryItemId}` | ● | (없음) | 구현 대상 · FE 버튼 추가 |
| 이벤트 | `POST /events` | ● | `lib/events.ts` | 구현 대상 |

● = `Authorization: Bearer <JWT>` 필수. 폐기: `GET /recommendations/anonymous`(비회원 추천 없음, FE 도 미호출), `POST /recommendations/tags`(태그 조절은 `GET /recommendations?tags=` 로 흡수).

<br/>

## 1. 공통 규칙

### 1.1 주소 · 헤더

- 기본 경로 `/api/v1`. 프론트는 `VITE_API_BASE_URL=/api/v1`, 개발 프록시 `/api → http://localhost:8080`.
- 요청·응답 본문은 `application/json; charset=utf-8`. 빈 응답은 `204`/`202` 로 본문 없이.
- 인증은 서비스 JWT 를 `Authorization: Bearer <token>` 으로. 만료·위조는 `401`. 프론트는 `401` 을 받으면 즉시 로그아웃한다.
- 시각은 ISO-8601 UTC (`2026-09-07T03:00:00Z`), 날짜는 `YYYY-MM-DD`.

### 1.2 식별자

| 이름 | 타입 | 규칙 |
| --- | --- | --- |
| `bookId` `libraryItemId` `recommendationId` `userId` | `string` | 불투명. 내부 PK 를 노출하지 않으므로 숫자처럼 보여도 문자열이다 (계약 §2) |
| `isbn13` | `string` | 하이픈 없는 13자리. 도서의 외부 표준 키 |

> 프론트 `types.ts` 는 지금 `bookId: number` 다. 파일 머리에 「string rename 은 별도 MR」이라 적혀 있다. **이 명세로 확정** — §9-1.

### 1.3 응답 형식

성공 응답은 **봉투 없이 자원 그 자체**다 (프론트가 `res.data` 를 바로 타입에 대입한다). 목록은 `{ items: [...] }` 로 감싼다.

오류는 하나의 형식만 쓴다.

```json
{ "code": "BOOK_NOT_FOUND", "message": "도서를 찾을 수 없습니다.", "details": { "bookId": "88123" } }
```

| HTTP | `code` | 언제 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 필드 형식·범위 위반. `details.fields[]` 에 `{ field, reason }` |
| 400 | `UNSUPPORTED_PROVIDER` | OAuth provider 가 `kakao`/`google` 가 아님 |
| 401 | `UNAUTHORIZED` | 토큰 없음·만료·위조 |
| 403 | `FORBIDDEN` | 남의 서재 항목 등 |
| 404 | `BOOK_NOT_FOUND` `LIBRARY_ITEM_NOT_FOUND` `USER_NOT_FOUND` | |
| 409 | `LIBRARY_ITEM_EXISTS` | 같은 책을 서재에 두 번 담음 (`details.libraryItemId` 로 기존 항목을 돌려준다) |
| 409 | `ONBOARDING_REQUIRED` | 온보딩 미완료 사용자가 추천을 요청 |
| 429 | `RATE_LIMITED` | 이벤트·검색 과다 |
| 503 | `SEARCH_UNAVAILABLE` | 검색 엔진(Elasticsearch)에 닿지 못함. 검색만 막히고 다른 기능은 정상 — 프론트는 「잠시 후 다시」 안내 |
| 500 | `INTERNAL_ERROR` | |

### 1.4 페이지네이션

`page`(0부터) · `size`(기본 20, 최대 50) 쿼리, 응답에 `total` `page` `size` `items`. 지금 프론트는 검색에서 첫 페이지만 쓰고 넘기지 않는다 — 서버 기본값으로 동작한다.

### 1.5 도서 공통 형태

```ts
BookSummary {
  bookId: string
  isbn13: string | null
  title: string
  authors: string[]            // 역할 제거. 화면은 " · " 로 이어 쓴다
  publisher: string | null
  publicationYear: number | null
  coverUrl: string | null      // 가장 큰 변형(알라딘 cover500 등). 축소는 FE lib/coverUrl.ts 가 한다
  pageCount: number | null
  category: string | null      // 분류 경로 "문학 > 한국소설". 서재 선반·DNA 장르 키는 2단계까지
  classNo: string | null       // KDC 코드 "813.62". 원장 최빈값 (1단계 100%)
}
```

`authors` 원소가 없으면 `[]`. `category` 는 원장 KDC → `kdc_codes` 라벨 경로로 만든다 (정보나루 `class_nm` 보완).

<br/>

## 2. 인증

OAuth 만 지원(카카오·Google). 자체 가입·비밀번호 없음. 서비스는 JWT 를 발급하고 OAuth access token 은 저장하지 않는다.

### 2.1 `GET /auth/oauth/{provider}/authorize`

`provider` ∈ `kakao` | `google`. **302** 로 제공자 로그인 화면에 보낸다(`state` 는 서버가 발급해 세션/서명 쿠키로 검증). 프론트는 `window.location.assign()` 으로 전체 페이지 이동한다.

> 프론트 MSW 모드는 이 주소가 JSON `{ accessToken, nickname, onboarded }` 을 돌려주는 것으로 mock 되어 있다. 실서버는 302 다. mock 은 §2.2 의 콜백 결과를 흉내낸 것으로 이해한다.

### 2.2 `GET /auth/oauth/{provider}/callback?code=&state=`

제공자 콜백. `state` 검증 → 토큰 교환 → `(provider, subject)` 로 사용자 조회·생성 → 서비스 JWT 발급 → **프론트로 302**:

```
302 Location: {FRONTEND_ORIGIN}/oauth/callback#accessToken=<jwt>&onboarded=true|false
```

- 토큰은 **URL fragment(`#`)** 에 넣는다. 서버 로그·Referer 에 남지 않는다. 프론트 콜백 페이지가 읽어 `authStore.login()` 하고 즉시 주소에서 지운다.
- `nickname` 은 여기 넣지 않는다. 콜백 페이지가 `GET /users/me` 로 받는다 (한글 인코딩·길이 문제 회피).
- 실패 시 `302 {FRONTEND_ORIGIN}/?error=oauth_failed`.
- **프론트에 `/oauth/callback` 라우트가 없다** — §9-2.

JWT: `sub=userId`, `exp` 24시간, HS256. 갱신 토큰은 MVP 에서 두지 않는다(만료 시 재로그인). 로그아웃은 클라이언트가 토큰을 지우는 것으로 끝나며 서버 엔드포인트가 없다.

<br/>

## 3. 사용자

### 3.1 `GET /users/me` ●

```json
{
  "userId": "u_18f2",
  "nickname": "책벌레",
  "onboardingStatus": "COMPLETED",
  "interestTags": ["#소설", "#과학"],
  "birthYear": 1996,
  "gender": "F"
}
```

`onboardingStatus` ∈ `PENDING` | `COMPLETED` | `SKIPPED`. 프론트의 `onboarded` = `status !== 'PENDING'`. `birthYear`·`gender` 는 본인에게만 돌려준다. `interestTags` 는 태그 **표시명**(`#소설`) — `tags.label` 그대로.
새로고침 뒤 상태 복원과 콜백 직후 닉네임 확보에 쓴다. 지금 프론트는 로그인 응답의 `nickname` 만 믿고 다시 묻지 않는다 — §9-3.

### 3.2 `POST /users/me/profile` ●

```json
{ "nickname": "책벌레", "birthYear": 1996, "gender": "F" }
```

| 필드 | 규칙 |
| --- | --- |
| `nickname` | 필수. 2~20자, 앞뒤 공백 제거 |
| `birthYear` | 선택(`null` 허용). 1900 ≤ 값 ≤ 올해. 프론트는 `<input type="date">` 에서 연도만 보낸다. 없으면 세그먼트 `ALL` |
| `gender` | `"F"` \| `"M"` \| `null` |

**204.** 여러 번 보내면 덮어쓴다(멱등). 프론트가 `POST` 를 쓰므로 그대로 두되 의미는 `PUT` 이다.

> **왜 OAuth 로 받지 않는가 (09-07 확인).** 카카오의 성별·연령대·출생연도는 **비즈 앱 전용 선택 동의**(출생연도는 추가 심사), Google 은 기본 프로필에
> 성별·생일이 없고 People API 민감 범위(앱 검수)다. 팀 프로젝트 조건에서는 둘 다 받을 수 없으므로 온보딩 입력이 유일한 경로다.
> `birthYear`·`gender` 는 **선택 입력**으로 두고, 없으면 세그먼트 `ALL`(전체 인기)로 처리한다. 비즈 앱 전환 시 동의받은 값은 폼 **미리 채움**으로만 쓴다.

### 3.3 `POST /users/me/preferences` ●

```json
{
  "genres": ["소설", "에세이", "과학"],
  "books": [ { "bookId": "88123", "rating": 5 }, { "bookId": "88410", "rating": 3 } ]
}
```

| 필드 | 규칙 |
| --- | --- |
| `genres` | 0~5개. 온보딩 화면의 한글 라벨(아래 표). 서버가 태그 코드로 바꿔 `user_interests` 에 **전체 교체** 저장. `#소설`(태그 표시명)·`FICTION`(코드)도 받는다. 표에 없는 값은 무시 (V1.1 seed) |
| `books[].bookId` | 존재하는 도서. 없으면 `404 BOOK_NOT_FOUND` |
| `books[].rating` | 필수 1~5 정수 (계약 §4.1.2: 고른 책마다 반드시) |

처리: `books` 를 서재(`user_library`)에 `status=READ`, `rating`, **`finished_at=NULL`**, `source=ONBOARDING` 으로 넣는다(ERD 가 seed book 을 서재로 통합).
완독일이 없는 `READ` = **서비스를 만나기 전에 읽은 책**이다. 프론트는 이 항목을 완독 연표·월별 통계에서 빼고 「서비스를 만나기 전에 읽은 책」으로 표시한다
(09-07 `feature/FE-onboarding-library` 머지). 서버는 여기서 `finishedDate` 를 오늘로 채우지 **않는다** — 그 규칙은 서재 API(§6.2·§6.3)에만 적용된다.
이미 서재에 있는 책이면 평점만 갱신하고 상태·완독일은 건드리지 않는다.
`genres` 가 비어도 요청이 오면 `onboardingStatus=COMPLETED`. 온보딩을 건너뛰는 별도 호출은 없다 — 프론트가 「건너뛰기」로 빈 배열을 보낸다. **204.**

온보딩 라벨 ↔ 태그 코드 (프론트 `GENRES` 14개 ↔ `Tag.code`):

| 라벨 | 코드 | 라벨 | 코드 |
| --- | --- | --- | --- |
| 소설 | `FICTION` | 경제·경영 | `BUSINESS` |
| 에세이 | `ESSAY` | 사회 | `SOCIETY` |
| 인문 | `HUMANITIES` | 시 | `POETRY` |
| 역사 | `HISTORY` | 여행 | `TRAVEL` |
| 과학 | `SCIENCE` | 기술·IT | `TECH` |
| 예술 | `ART` | 자기계발 | `SELF_HELP` |

`#판타지` `#추리` `#성장` 같은 TunePage 태그와 온보딩 라벨은 어휘가 다르다 — §9-6.

### 3.4 `GET /users/me/dna` ●

BOOK DNA 화면(`features/dna`)의 재료. 서재의 **READ 항목**을 그대로 준다. 집계(장르 비율·작가 빈도·스펙트럼)는 프론트가 한다 — 지금 mock 훅이 그렇게 되어 있고 표지 색 추출은 브라우저에서만 가능하다.

```json
{
  "declaredTags": ["#소설", "#과학"],
  "readCount": 23,
  "books": [
    { "bookId": "88123", "isbn13": "9788936434120", "title": "소년이 온다", "authors": ["한강"],
      "classNo": "813.62", "category": "문학 > 한국소설", "coverUrl": "https://…/cover500/….jpg",
      "rating": 5, "finishedDate": "2026-08-30" }
  ]
}
```

`books` 는 `finishedDate` 내림차순(**`null` 은 마지막**), 최대 200권. 온보딩 seed(`finishedDate=null`, §3.3)도 `books`·`readCount` 에 **포함**한다 —
장르 비율·작가 빈도는 언제 읽었든 취향이다. 연표·월별 통계에서 빼는 것은 프론트가 `finishedDate` 로 거른다. `rating` 이 없는 완독 책은 `null`. `declaredTags` = `interestTags`.

<br/>

## 4. 도서

### 4.1 `GET /books/search?q=&page=&size=` ●

`q` 필수, 1~100자. 제목·저자·출판사 대상. `q` 가 하이픈 포함 ISBN 형태면 ISBN 조회로 처리하고, L0 에 없으면 카카오 1회 조회로 온디맨드 등록을 시도한다(서비스 방향 §7).

```json
{ "total": 37, "page": 0, "size": 20, "items": [ BookSummary, … ] }
```

정렬은 검색 점수 → 대출 인기(`popularity_score`) 순. 필터·정렬 파라미터는 프론트에 없어 두지 않는다.

구현 메모 (2026-09-09, V1 위에서):
- ISBN 판정 = 하이픈·공백을 뗀 뒤 978/979 로 시작하는 13자리 숫자. 정확 조회라 결과는 0 또는 1건. **카카오 온디맨드 등록은 아직 없다** — 없으면 `total: 0`.
- 점수 = 제목 완전일치 ×10 > 형태소 일치(nori, `title^3 · authors^2 · publisher`, 모든 단어 필요) > 부분일치(bigram, `title.ngram^1.5 · authors.ngram`). 동점은 `bookId` 오름차순. `popularity_score` 는 V2 컬럼이라 그때 tie-break 로 넣는다.
- 제목 완전일치는 공백·대소문자를 무시한다(`어린왕자` = `어린 왕자`). 검색어 띄어쓰기에 따라 순서가 바뀌지 않는다. 완전일치 판본이 여럿이면 `bookId` 순 — 인기 순은 V2.
- 형태소 분석은 조사·어미만 떼고 부사·관형사는 남긴다(`지금 추천` → 지금, 추천). 한자는 독음으로 바꾸지 않아 중국어·일본어 도서가 한국어 검색어에 섞이지 않는다(매핑 v2, 2026-09-09).
- `items[]` 의 `category` 는 `kdc_codes`(V2) 로 만든 2단계 경로 `"문학 > 한국문학"`(대·중분류 라벨이 같으면 `"문학"` 하나). 사전을 못 읽으면 대분류 1단계로 폴백. `pageCount` 는 `null`(키는 있다) — `books` 에 컬럼이 없다.
- 검색 엔진 장애는 `503 SEARCH_UNAVAILABLE`(§1.3).

### 4.2 `GET /books/popular?size=` ●

온보딩 2단계의 「알 만한 책」그리드. **로그인 사용자의 세그먼트(연령×성별) 인기** 상위. `size` 기본 12, 최대 40. **온보딩 중(PENDING)에도 호출 가능.**

세그먼트 규칙(09-10 확정, 프론트 mock 과 동일): ① 출생연도·성별 모두 있음 → 그 세그먼트 순위 ② 출생연도만 → 같은 연령대 남·녀를 책 단위로 `loanCount` 합산해 재정렬(`segment.gender = null`, 라벨 `"20대"`)
③ 둘 다 없음 → 전 세그먼트 합산(`segment = null`). 연령대 = (올해 − 출생연도)를 10 단위로 내림, **10~60**(60 = 60대 이상 — 원천 `book_loaned_top20` 이 60대를 따로 가진다). 기준월은 표의 최신 `period`.

```json
{ "segment": { "age": "20", "gender": "F", "label": "20대 여성" } | null,
  "items": [ BookSummary, … ] }
```

`items` 에는 `coverUrl`·`category` 를 **반드시** 채운다 — mock 이 비워 보내 그리드가 글자로 뜬다(§9-9).

### 4.3 `GET /books/popular-segments` ● (09-10 구현)

홈 인기 링. 지금은 `frontend/public/data/popular-ring.json`(09-02 생성, 10세그먼트 × 20권)을 읽는다. 같은 형태로 API 화한다.

```json
{
  "generatedAt": "2026-09-01T00:00:00Z",
  "period": { "startDate": "2026-06-01", "endDate": "2026-08-31" },
  "segments": [
    { "id": "20_F", "label": "20대 여성", "age": "20", "gender": "F",
      "items": [ { "ranking": 1, "loanCount": 518, "book": BookSummary, "coverLargeUrl": "…" }, … ] }
  ]
}
```

세그먼트는 원천대로 **최대 12개**(10·20·30·40·50·60 × F/M, 60 = 60대 이상), 각 20권, 기준월에 행이 있는 것만. `period` 는 집계 창(직전 3개월), `generatedAt` 은 기준월 다음 달 1일 00:00Z.
데이터가 없으면 `segments: []` 에 `period`·`generatedAt` 은 null. 월 1회 적재(`fetch_segment_popular.py` → `load_service_tables.sh --only book_loaned_top20`). 정적 파일과의 차이: `gender` 가 `'남'|'여'` → `'M'|'F'`, `publicationYear` 가 문자열 → 숫자, 책 필드가 `BookSummary` 로 정리 — §9-8.

### 4.4 `GET /books/{bookId}` ●

**`bookId` 자리에 13자리 숫자가 오면 `isbn13` 으로 찾는다.** 홈 링이 `/books/9788936434120` 으로 이동하고 나머지 화면은 내부 id 로 이동한다(§9-4). 응답의 `bookId` 는 항상 내부 id.

```json
{
  …BookSummary,
  "subtitle": null,
  "description": "…",                    // 정보나루 → 카카오 순으로 고른 대표 소개문
  "descriptionSource": "DATA4LIBRARY",   // DATA4LIBRARY | KAKAO | null
  "toc": null,                           // 목차. 국중 회수분이 있을 때만
  "metrics": [
    { "source": "정보나루", "name": "전국 대출 순위", "value": "상위 3%", "asOf": "2026-08" },
    { "source": "정보나루", "name": "누적 대출", "value": "27,551회", "asOf": "2026-08" }
  ],
  "loanByAge": [ { "ageGroup": "10대", "ratio": 8 }, … ] | null,
  "my": null | {
    "libraryItemId": "li_9021", "status": "READ",
    "rating": 4, "reviewText": null, "finishedDate": "2026-09-01"
  }
}
```

- `metrics[].value` 는 **표시용 문자열**을 서버가 만든다 (프론트가 그대로 그린다). 없는 지표는 항목을 빼면 화면이 섹션을 숨긴다.
- `loanByAge` 는 정보나루 `loan_grps` 가 있을 때만(1단계 3.2%) — 대부분 `null`.
- `my` 는 **본인 서재 항목**. 프론트 타입은 `myLibraryStatus`/`myRating`/`myReviewText` 세 필드인데 `libraryItemId` 가 없어 상세에서 편집을 못 해 서재로 보낸다. `my` 객체로 묶고 `libraryItemId` 를 넣는다 — §9-5. 비로그인·타인 것은 절대 노출하지 않는다(계약 §6.2).

### 4.5 `GET /books/{bookId}/similar?size=` ● (2차)

「비슷한 책」. 임베딩 연구 결론(`docs/pipeline/EMBEDDING_STUDY_REPORT.md` §0·§8)대로 **어휘 이웃 ‖ 밀집 이웃 역순위 융합**, 같은 작품(`set_isbn`·제목+저자) 묶어 1권만. `size` 기본 8, 최대 20.

```json
{ "items": [ { "book": BookSummary, "reason": "같은 작가 · #성장", "score": 0.83 }, … ] }
```

### 4.6 `GET /books/{bookId}/co-loans?size=` ● (2차)

「함께 대출된 책」. 정보나루 `coLoanBooks`(책당 10권, 1단계 82.9%) 를 그대로 서빙. 없으면 `items: []`.

```json
{ "items": [ { "book": BookSummary, "rank": 1 }, … ], "source": "DATA4LIBRARY", "asOf": "2026-08" }
```

<br/>

## 5. 추천

### 5.1 `GET /recommendations?size=&tags=` ●

| 쿼리 | 규칙 |
| --- | --- |
| `size` | 기본 **10**, 최대 30. 프론트 덱은 5장(`RECOMMEND_DECK_SIZE`), mock 은 30 — 여기서 10 으로 확정(§9-7) |
| `tags` | 반복 파라미터 `tags=#소설&tags=#신간`, 최대 5. TunePage 의 「이 태그로 추천받기」를 서버에 반영하는 통로. 없으면 관심 태그 사용 |

온보딩 미완료(`PENDING`)면 `409 ONBOARDING_REQUIRED`. 비회원 모드는 없다.

```json
{
  "recommendationId": "rec_01J7…",
  "generatedAt": "2026-09-07T03:00:00Z",
  "mode": "PERSONALIZED",                 // COLD_START | PERSONALIZED
  "fallback": false,                      // true = 개인화 실패로 세그먼트 인기 대체
  "basedOnCount": 4,                      // "최근 기록한 N권을 보고 골랐어요"
  "weights": { "taste": 60, "coLoan": 0, "trending": 15, "steady": 10, "newField": 15 },
  "appliedTags": ["#소설", "#신간"],
  "items": [
    { "book": BookSummary, "rank": 1, "score": 91.2,
      "featureScores": [ { "key": "taste", "rawScore": 88 }, { "key": "coLoan", "rawScore": null }, … ],
      "tags": ["#소설", "#내취향근접"],
      "reasonType": "TEXT_SIMILARITY",
      "reasonText": "최근 별 다섯 개를 준 『소년이 온다』와 문장 결이 닿아 있어요." }
  ]
}
```

- `items` 는 `rank` 오름차순, 서재에 있는 책 제외, 같은 작품 1권.
- 프론트가 그리는 것은 `recommendationId` `generatedAt` `fallback` `basedOnCount` `appliedTags` `items[].rank/tags/reasonText/book` 뿐이다. `score` `featureScores` `weights` `mode` `reasonType` 은 이벤트 분석·디버그용으로 남긴다(계약 §4.4).
- 같은 스냅샷을 다시 조회하면 새로 저장하지 않는다. `tags` 를 바꿔 요청하면 새 스냅샷(새 `recommendationId`).
- `reasonText` 는 서버가 완성한 한 문장(카드에 그대로). `reasonType` 별 템플릿은 추천 구현 문서에서.

<br/>

## 6. 서재

`ShelfStatus` ∈ `WISH` | `READ` — **2단 확정(09-02 회의, 「읽는 중」폐기)**. 찜 = `WISH` (별도 좋아요 없음). 프론트 `types.ts` 도 09-07 머지로 2단이다.

```ts
LibraryItem {
  libraryItemId: string
  book: BookSummary
  status: ShelfStatus
  rating: number | null        // 1~5 정수. 상태와 무관하게 둘 수 있다
  reviewText: string | null    // 본인 전용, ≤300자, 공백만이면 null
  finishedDate: string | null  // READ 일 때만. 서재 API 로 READ 가 되면 미지정 시 서버가 오늘. 온보딩 seed 는 null(§3.3)
  createdAt: string
  updatedAt: string
}
```

### 6.1 `GET /library/me?status=` ●

`status` 없으면 전체. 정렬 `updatedAt` 내림차순. 페이지 없음(사용자 서재는 수백 권 규모) — `{ "items": [ LibraryItem, … ] }`.

### 6.2 `POST /library` ●

```json
{ "bookId": "88123", "status": "WISH" }
```

**201 + `LibraryItem` 본문.** 지금 mock 은 본문 없이 201 이라 프론트가 새 `libraryItemId` 를 알 수 없다(§9-5). 이미 있으면 `409 LIBRARY_ITEM_EXISTS` + `details.libraryItemId` — 프론트는 그걸로 `PATCH` 하면 된다. `status=READ` 면 `finishedDate=오늘`.

### 6.3 `PATCH /library/{libraryItemId}` ●

부분 갱신. 보낸 필드만 바꾼다.

```json
{ "status": "READ", "rating": 4, "reviewText": "전개가 빠르다.", "finishedDate": "2026-09-01" }
```

| 규칙 | |
| --- | --- |
| `READ` 로 바꾸며 `finishedDate` 가 없으면 | 오늘 |
| `WISH` 로 바꾸면 | `finishedDate=null` |
| `status` 없이 보내면(평점·감상평만) | `finishedDate` 유지 — 온보딩 seed 의 `null` 도 그대로. `finishedDate` 를 직접 보내면 `READ` 항목에 한해 반영 |
| `reviewText` | 앞뒤 공백 제거, 빈 문자열 → `null`, 300자 초과 `400` |
| `rating` | 1~5 정수 또는 `null`(삭제) |
| 타인 항목 | `403` |

**200 + `LibraryItem`.**

### 6.4 `DELETE /library/{libraryItemId}` ●

**204.** 찜 해제·서재에서 빼기. 계약 §4.2 「`READ` 는 WISH 취소만으로 삭제하지 않는다」는 *상태 변경*의 규칙이고, 명시적 삭제는 허용한다. 프론트에 버튼이 없다 — §9-10.

<br/>

## 7. 이벤트

### 7.1 `POST /events` ●

```json
{ "eventType": "CLICK", "bookId": "88123", "recommendationId": "rec_01J7…", "rank": 3,
  "occurredAt": "2026-09-07T03:12:44.120Z", "clientEventId": "c1f0-…" }
```

| `eventType` | 필수 필드 | 뜻 |
| --- | --- | --- |
| `IMPRESSION` | `recommendationId` | 추천 덱이 화면에 뜸 (덱당 1회) |
| `CLICK` | `bookId` (+`recommendationId`,`rank`) | 추천·홈에서 상세로 진입 |
| `BOOK_VIEW` | `bookId` | 상세 화면 열람 (책당 1회/마운트) |
| `WISH` | `bookId` (+`recommendationId`,`rank`) | 찜 등록 |
| `REASON_VIEW` | `recommendationId`,`bookId` | 추천 이유 펼침 (계약에 있음, 프론트 미사용) |

**202**, 본문 없음. 검증 실패도 `202` 로 받고 버린다 — 이벤트가 화면을 막으면 안 된다(계약 §4.5). `clientEventId` 가 있으면 `(userId, clientEventId)` 로 중복 제거. 배치 전송은 두지 않는다(프론트가 건별 fire-and-forget).

<br/>

## 8. 데이터 출처 (백엔드 구현자용)

| 응답 필드 | 원천 | 비고 |
| --- | --- | --- |
| `title` `authors` `publisher` `publicationYear` `classNo` | 원장 `books_dedup.parquet` (정보나루 usage 로 보완) | 1단계 100% |
| `category` | `classNo` → `kdc_codes` 라벨 경로 | 정보나루 `class_nm` 은 89% 라 보조 |
| `description` | 정보나루 `desc`(86.7%) → 카카오 `contents`(68%) | 둘 다 없는 1단계 책 0.3% |
| `coverUrl` | 정보나루 `img` → 카카오 `thumbnail` | 알라딘 cover500 형태 우선 |
| `metrics` 「전국 대출 순위」「누적 대출」 | 원장 `loans` · `loan_rank` | 월 갱신 |
| `loanByAge` | 정보나루 `loan_grps` | 3.2% 만 존재 |
| `co-loans` | 정보나루 `co_loan` | 82.9% |
| `similar` | e5-large `STRUCT` 벡터(pgvector/Qdrant) ‖ tsvector 어휘 | 연구 보고서 §8 |
| `popular-segments` | 정보나루 세그먼트 인기 (홈 링 빌드 스크립트의 원천) | 월 배치 |

<br/>

## 9. 프론트와의 차이 — 반영해야 할 것

번호는 §0 표의 「FE …」와 대응한다. **명세가 기준**이고, 프론트를 이에 맞춘다.

| # | 지금 프론트 | 명세 | 왜 |
| --- | --- | --- | --- |
| 1 | `bookId: number` · `author: string` | `bookId: string` · `authors: string[]` | 계약 §2·§3.1. `types.ts` 머리에 이미 「별도 MR」로 예고돼 있다. 화면은 `authors.join(' · ')` |
| 2 | OAuth 실서버 모드가 `authorize` 로 전체 이동만 하고 **콜백 라우트가 없다** | `/oauth/callback` 페이지 추가: fragment 에서 `accessToken`·`onboarded` 읽어 `login()`, `GET /users/me` 로 닉네임, 주소 정리 | 토큰이 SPA 로 돌아올 길이 없다 |
| 3 | 닉네임·`onboarded` 를 로그인 응답에서만 받고 재검증 없음 | 앱 시작 시 `GET /users/me` | 새로고침·다기기 일관성. `onboardingStatus` 가 진실 |
| 4 | 홈 링은 `/books/{isbn13}`, 나머지는 `/books/{bookId}` | 서버가 13자리는 ISBN 으로 해석 | 프론트 수정 없이 흡수 |
| 5 | `POST /library` 응답 없음 · 상세에 `libraryItemId` 없음 → 상세에서 편집 불가 | `POST /library` → `LibraryItem`, 상세 `my.libraryItemId` | 상세에서 별점·감상평 편집이 가능해진다 |
| 6 | 온보딩 장르 라벨(14개, `#` 없음) ≠ TunePage 태그(`#` 접두) | §3.3 매핑표로 서버가 코드화. TunePage 는 `GET /recommendations?tags=` 로 서버 반영 | 두 어휘가 따로 놀면 `appliedTags` 가 거짓이 된다 |
| 7 | 덱 5장 표시, mock 30장, 크기 미정 | `size` 기본 10 | 5장 화면 + 미니폴더 교체분 |
| 8 | 홈이 정적 `popular-ring.json` | `GET /books/popular-segments` (2차). `gender` `M/F`, `publicationYear` 숫자 | 월 갱신을 배포 없이 |
| 9 | mock `GET /books/popular` 가 `coverUrl`·`category` 를 비움 | 서버는 반드시 채움 | 온보딩 그리드가 글자로 뜬다 |
| 10 | 찜 해제·서재 삭제 버튼 없음 | `DELETE /library/{id}` + 버튼 | 실수로 담은 책을 뺄 수 없다 |
| 11 | ~~`progressPage` 표시만, 쓰는 UI 없음, ERD 미반영~~ **해소(09-08)** — 서재 상태는 09-02 회의에서 `WISH`/`READ` 2단으로 확정, FE 는 09-07 머지에서 `READING`·`progressPage` 제거 | 명세·V1 DDL 에서도 제거. 컬럼 추가 없음 | 문서-코드 일치 |
| 12 | `/onboarding` 이 `ProtectedRoute` 밖 | 안으로 옮기거나 토큰 없으면 `/` 로 | 프로필·취향 POST 가 토큰 없이 나갈 수 있다 |
| 13 | `GET /recommendations/anonymous` 코드 잔존 | 삭제 | 비회원 추천 없음 (08-31 결정) |
| 14 | BOOK DNA 가 정적 JSON 재가공 | `GET /users/me/dna` 연결 | 필드는 §3.4 로 확정 |
| 15 | 검색 `SearchResponse.page` 를 1로 mock | 0부터 | Spring `Pageable` 기본과 일치 |

<br/>

## 10-0. 전수 검증 기록 (2026-09-07) — 18개가 전부인가

프론트 `src/**` 의 네트워크 호출을 grep 으로 전수 확인하고(`api.*(` 16곳 · `fetch(` 2곳), 계획 문서 세 개의 API 언급 16개와 대조했다.

**프론트 호출 → 명세** (호출 13종, 전부 대응)

| 프론트 호출 | 명세 |
| --- | --- |
| `GET /auth/oauth/{p}/authorize` · `POST /users/me/profile` · `POST /users/me/preferences` · `GET /books/popular` · `GET /books/search` · `GET /books/{id}` · `GET /recommendations` · `GET /library/me` · `POST /library` · `PATCH /library/{id}` · `POST /events` | 같은 경로로 정의 (§2~§7) |
| `fetch('/data/popular-ring.json')` ×2 (홈 링 · BOOK DNA) | `GET /books/popular-segments` (2차) · `GET /users/me/dna` |
| `GET /recommendations/anonymous` (호출자 없음) | 폐기 |

**문서 언급 → 명세** (MVP 계획 §8~§11 · 데이터 계약 §4.6)

| 문서 | 명세 | 비고 |
| --- | --- | --- |
| `GET /auth/oauth/{p}/callback` · `GET /users/me` · `GET /recommendations` | 동일 | |
| `GET /books?query=` | `GET /books/search?q=` | 프론트 경로를 따름 |
| `GET /library?status=` · `POST /library/books/{bookId}` · `PATCH /library/books/{bookId}/status` · `DELETE /library/books/{bookId}` | `GET /library/me` · `POST /library` · `PATCH /library/{id}` · `DELETE /library/{id}` | 프론트가 `libraryItemId` 기준으로 호출 |
| `PUT /books/{bookId}/rating` · `DELETE …/rating` | `PATCH /library/{id}` 의 `rating` (null 이면 삭제) | 평점이 서재 행에 통합됨 (ERD) |
| `GET /users/me/preferences` · `PUT /users/me/preferences` | `GET /users/me`(interestTags) · `POST /users/me/preferences`(멱등) | seed 책 목록을 되돌려 주는 API 는 없다 — 재온보딩 UI 가 없어 보류 |

**결론: 18개로 프론트와 문서를 모두 덮는다.** 다만 두 가지를 적어 둔다.

1. **`GET /tags` — 09-10 구현.** 응답 `{ items: [{ code, label, kind, selectable }] }`, `tag_code` 순. 지금 사전은 온보딩 장르 12개(`GENRE`, 라벨 `#소설`)뿐이라
   프론트 `GENRES` 는 이 목록으로 바꿀 수 있고(라벨의 `#` 는 프론트가 뗀다), TunePage `SUGGESTED_TAGS`(THEME·SIGNAL) 는 추천 구현에서 seed 가 추가될 때까지 하드코딩을 유지한다.
   `POST /users/me/preferences` 의 `genres` 는 `code`·`label`·`#` 없는 라벨을 모두 받으므로 전환 시점은 프론트가 정한다.
2. **`SKIPPED` 는 프론트에서 만들어지지 않는다.** 온보딩의 「건너뛰기」는 마지막 단계에서 `POST /users/me/preferences` 를 (빈 목록으로라도) 보내고 끝나므로 항상 `COMPLETED` 다.
   `SKIPPED` 는 계약에 있는 예약 상태로 두고, 서버는 만들지 않는다.

그 외 후보로 검토했지만 필요 없는 것: 로그아웃(무상태 JWT, 클라이언트가 토큰 삭제) · 프로필 수정/조회 화면(없음) · 회원 탈퇴(MVP 범위 밖) · 표지 이미지 프록시(핫링크 `no-referrer` 로 충분) · 헬스체크(`/actuator/health`, 인프라).

## 10. 아직 정하지 않은 것

| 항목 | 후보 | 결정 시점 |
| --- | --- | --- |
| 「비슷한 책」후보 생성 경로 | pgvector 단독 / Qdrant + tsvector 융합 | 임베딩 배치 구현 시 (`EMBEDDING_STUDY_REPORT.md` §8.4) |
| `reasonText` 템플릿 문장 | `reasonType` 8종별 | 추천 구현 문서 |
| JWT 만료·갱신 | 24시간 고정 / refresh 토큰 도입 | 베타 운영 피드백 |
| 이벤트 보존 기간·집계 | 원본 90일 / 일별 집계 영구 | W3 지표 설계 |
| 온디맨드 카카오 등록 정책 | 검색 결과 0건 + ISBN 형태일 때만 | L0 적재 후 |
