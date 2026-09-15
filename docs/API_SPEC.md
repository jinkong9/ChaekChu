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
| 도서 | `GET /books/search` | ● | SearchPage | 구현 대상 · **`kdc` 필터·대출순·탐색 한도 추가(09-11)** |
| | `GET /books/popular` | ● | OnboardingPage 2단계 | 구현 대상 |
| | `GET /books/popular-segments` | ● | 홈 (현재 정적 JSON) | **구현(09-10)** · FE 연결 |
| 태그 | `GET /tags` | ● | (없음 — GENRES 하드코딩) | **구현(09-10)** · FE 연결 선택 |
| 분류 | `GET /kdc` | ● | (없음 — 검색 분류 칩·드릴다운용) | **구현(09-11)** · FE 연결 |
| | `GET /books/{bookId}` | ● | BookDetailPage · 홈 링 | **구현(09-10)** · ISBN13 도 받는다 |
| | `GET /books/{bookId}/similar` | ● | BookDetailPage 「비슷한 책」 스켈레톤 | 2차 — Qdrant 적재량이 아직 1만 권(전체의 0.3%) |
| | `GET /books/{bookId}/co-loans` | ● | BookDetailPage 「함께 대출된 책」 스켈레톤 | **구현(09-10)** · FE 연결 |
| 추천 | `GET /recommendations` | ● | RecommendPage · TunePage | 구현 대상 · 09-11 부터 덱을 DB 에 저장 |
| 서재 | `GET /library/me` | ● | LibraryPage* | **구현(09-10)** · FE 연결 |
| | `POST /library` | ● | RecommendPage · BookDetailPage | **구현(09-10)** · FE 연결(응답 본문의 `libraryItemId` 사용) |
| | `PATCH /library/{libraryItemId}` | ● | LibraryList · LibraryPageB | **구현(09-10)** · FE 연결 |
| | `DELETE /library/{libraryItemId}` | ● | (없음) | **구현(09-10)** · FE 버튼 추가 |
| 이벤트 | `POST /events` | ● | `lib/events.ts` | **구현(09-11)** · FE 보강 필요(아래 §7.1) |

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

BOOK DNA 화면(`features/dna`)의 공개 API. 서재의 **READ 항목**은 표지·근거 표시용으로
주고, 장르 비율·성향·키워드·독서타입은 AI가 계산한 `profile`을 함께 반환한다.
전체 요청·응답 DTO와 FastAPI 내부 계약은 `docs/BOOK_DNA_API_CONTRACT.md`에서 관리한다.

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

응답에는 다음 AI profile 필드가 추가된다.

```json
{
  "dnaVersion": "book-dna-v1",
  "modelVersion": "gms-text-embedding-3-small-20260909-1000",
  "indexVersion": "d4l-small-scale-450000-20260915",
  "tagVersion": "d4l-tags-scale-450000-20260915",
  "profile": {
    "status": "READY",
    "basedOnCount": 23,
    "axes": [{ "code": "FICTION", "label": "소설", "score": 82.4 }],
    "metrics": [{ "code": "IMMERSION", "label": "몰입", "score": 88.1 }],
    "keywords": [{ "code": "RELATIONSHIP", "label": "관계", "score": 84.2 }],
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

`profile.status`는 `READY` 또는 `INSUFFICIENT_DATA`다. profile 점수는 0~100 범위이며,
온라인 조회에서 GMS를 호출하지 않는다. `books`의 표지 색상·애니메이션과 가챠·월드컵·사주
콘텐츠는 프론트 기능으로 유지한다.

<br/>

## 4. 도서

### 4.1 `GET /books/search?q=&kdc=&page=&size=` ●

`q` 와 `kdc` 중 **하나는 필수**(둘 다 없으면 `400`). `q` 는 1~100자로 제목·저자·출판사를 찾고, `kdc` 는 KDC 코드 prefix 1~3자리(`8` 문학 · `81` 한국문학 · `813` 소설)로 `books.category_code`(`"813.62"`)의 앞자리를 맞춘다.
`q` 가 하이픈 포함 ISBN 형태면 ISBN 조회로 처리하고(그때 `kdc` 는 무시), L0 에 없으면 카카오 1회 조회로 온디맨드 등록을 시도한다(서비스 방향 §7).

**탐색 한도 10,000건.** `page × size + size` 가 이를 넘으면 `400` 이다 — `size=20` 이면 `page` 0~499, 화면 1~500쪽. ES `from+size` 상한이자 제품 결정(09-11):
깊은 페이지를 억지로 주지 않고 분류·검색어로 좁히게 유도한다. 그래서 커서(`search_after`)는 두지 않는다. `total` 은 필터 적용 후 전체 건수라 한도보다 클 수 있으니,
화면은 「총 1,107,497건 · 대출순 상위 10,000건 표시」처럼 **총 건수와 탐색 가능 건수를 구분**해 보여 주고, 그 이상은 중분류나 검색어로 좁히도록 유도한다.

```json
{ "total": 37, "page": 0, "size": 20, "items": [ BookSummary, … ] }
```

정렬은 **검색어가 있느냐로 갈린다**(09-11 확정).

| 요청 | 정렬 |
| --- | --- |
| `q` 만 | 관련도(점수) 내림차순 → `bookId` 오름차순 |
| `q` + `kdc` | 같음 — `kdc` 는 점수에 끼지 않는 filter 라 순서가 그대로다. 분류 안에서도 검색 관련도가 먼저 |
| `kdc` 만 | 누적 대출(`loanCum`) 내림차순 → `bookId` 오름차순. 대출값이 없는 책은 **마지막** |

정렬·필터 파라미터는 이 둘뿐이다. 최신순·인기순 선택은 프론트에 없어 두지 않는다.

구현 메모 (2026-09-09, V1 위에서):
- ISBN 판정 = 하이픈·공백을 뗀 뒤 978/979 로 시작하는 13자리 숫자. 정확 조회라 결과는 0 또는 1건. **카카오 온디맨드 등록은 아직 없다** — 없으면 `total: 0`.
- 점수 = 제목 완전일치 ×10 > 형태소 일치(nori, `title^3 · authors^2 · publisher`, 모든 단어 필요) > 부분일치(bigram, `title.ngram^1.5 · authors.ngram`). 동점은 `bookId` 오름차순.
- 제목 완전일치는 공백·대소문자를 무시한다(`어린왕자` = `어린 왕자`). 검색어 띄어쓰기에 따라 순서가 바뀌지 않는다. 완전일치 판본이 여럿이면 표지 있는 쪽 → `bookId` 순.
- 형태소 분석은 조사·어미만 떼고 부사·관형사는 남긴다(`지금 추천` → 지금, 추천). 한자는 독음으로 바꾸지 않아 중국어·일본어 도서가 한국어 검색어에 섞이지 않는다(매핑 v2, 2026-09-09).
- **표지 없는 책은 점수 × 0.7** (매핑 v3, 2026-09-11 · `app.search.no-cover-weight`, 1 이면 끔). 후보를 빼지 않고 순서만 바꾼다 — 같은 작품의 판본 사이에서 표지 있는 쪽이 먼저 오고, 관련도가 훨씬 높은 책이 표지가 없다고 무관한 책 아래로 내려가지는 않는다(완전일치 ×10 유지). 판본 접기(작품 단위 중복 제거)는 하지 않는다.
- `items[]` 의 `category` 는 `kdc_codes`(V2) 로 만든 2단계 경로 `"문학 > 한국문학"`(대·중분류 라벨이 같으면 `"문학"` 하나). 사전을 못 읽으면 대분류 1단계로 폴백. `pageCount` 는 `null`(키는 있다) — `books` 에 컬럼이 없다.
- **색인 범위(v5, 09-15)**: `books` 전 행이 아니라 `books.is_candidate` 인 440,757권만 색인한다 — 원장 누적 대출 90% 커버리지(843+) ∪ 신간에서 전자책·교과서·학습참고서·소개·표지·키워드·관계가 전부 없는 책을 뺀 집합. L0 만 구간 226만 권(93% 가 소개·표지 없음)은 검색 결과에 나오지 않는다. ISBN 정확 조회·상세·찜은 `books` 전체가 대상이라 영향 없다. 규칙·건수는 `database/_pipeline/scripts/build_candidates.py` · `candidates/<날짜>/manifest.json`.
- **분류 필터**는 ES `bool.filter` 의 `prefix: { categoryCode }` 한 절이다(이미 keyword 라 재색인 없이 붙었다). `kdc` 가 1~3자리 숫자가 아니면 `400 VALIDATION_FAILED` · `details.fields[{ field: "kdc" }]`.
- **`kdc` 만 보낼 때의 대출순**은 매핑 v4 의 `loanCum` — 색인할 때 `book_demand_features` 최신 스냅샷(`2026-08`)의 `loan_cum` 을 LEFT JOIN 해 넣는다. 수요 지표가 없는 책(약 57만 권)은 `null` 이고 정렬에서 뒤로 간다. 스냅샷이 더 늘지 않는 전제라 월 배치·증분 갱신 경로는 두지 않았다(추가되면 전체 재색인).
- 정렬에 `unmapped_type` 을 주므로 v4 재색인 중 alias 가 아직 v3 를 가리켜도 `500` 이 아니라 「전부 값 없음」으로 동작한다 — 그 15분 동안 대출순만 정확하지 않고 검색은 살아 있다.
- 검색 엔진 장애는 `503 SEARCH_UNAVAILABLE`(§1.3).

### 4.7 `GET /kdc?depth=&parent=` ● (2026-09-11)

KDC 분류 사전 949개(대분류 10 · 중분류 100 · 소분류 839). 원천은 V2 `kdc_codes`(`code`·`label`·`parent_code`·`depth`)로 내용이 바뀌지 않는 고정 표다.
`code` 의 자릿수가 곧 단계이고 그대로 `GET /books/search?kdc=` 에 넣을 수 있다 — `8`(문학) → `81`(한국문학) → `813`(소설).
검색 결과의 `classNo`(`"813.62"`)는 소수점까지라 그대로 쓰면 `400` 이고, 앞자리만 잘라 쓴다.

| 쿼리 | 규칙 |
| --- | --- |
| `depth` | `1`·`2`·`3`. 그 단계 전체를 준다 |
| `parent` | 부모 코드 1~3자리. 그 코드의 **자식 한 단계**. `parent=8` → `80`~`89` |
| 둘 다 없음 | 전체 949행(약 60KB) |
| 둘 다 있음 | `400 VALIDATION_FAILED` — 다른 질문이라 섞지 않는다 |

```json
GET /kdc?depth=1
→ { "items": [ { "code": "0", "label": "총류", "depth": 1, "parentCode": null },
               { "code": "8", "label": "문학", "depth": 1, "parentCode": null }, … 10개 ] }

GET /kdc?parent=8
→ { "items": [ { "code": "80", "label": "문학", "depth": 2, "parentCode": "8" },
               { "code": "81", "label": "한국문학", "depth": 2, "parentCode": "8" }, … 10개 ] }
```

구현 메모:
- 정렬은 `code` **문자열** 오름차순이라 전체 조회에서 `"81"` 다음이 `"811"`·`"813"` 이고 그 뒤가 `"82"` 다. 한 단계만 받으면(`depth`·`parent`) 자릿수가 같아 숫자 순과 같다.
- 소분류 코드로 `parent` 를 물으면 자식이 없어 `items: []` 다 — `404` 가 아니다.
- 응답에 `Cache-Control: max-age=86400, public`. 949행짜리 고정 표라 메모리 캐시는 두지 않았다(프론트는 앱 시작에 한 번, 토큰을 펼칠 때만 부른다). 검색 결과마다 라벨을 붙이는 `KdcCategoryResolver` 는 호출 빈도가 높아 그쪽만 기동 시 메모리에 올린다.
- **`kdc_codes` seed 는 저장소에 없다** — 운영은 팀원이 따로 적재했고, 표가 비면 `items: []` 를 준다(검색의 `category` 는 대분류 폴백으로 계속 동작).

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

### 4.4 `GET /books/{bookId}` ● (09-10 구현)

**`bookId` 자리에 13자리 숫자가 오면 `isbn13` 으로 찾는다.** 홈 링이 `/books/9788936434120` 으로 이동하고 나머지 화면은 내부 id 로 이동한다(§9-4). 응답의 `bookId` 는 항상 내부 id.

```json
{
  …BookSummary,
  "subtitle": null,
  "description": "…",                    // 정보나루 → 형제 권 → 카카오 순으로 고른 대표 소개문
  "descriptionSource": "DATA4LIBRARY",   // DATA4LIBRARY | SIBLING | KAKAO | null
  "toc": null,                           // 목차. 원천 미적재 — 항상 null
  "metrics": [
    { "source": "정보나루", "name": "전국 대출 순위", "value": "상위 3%", "asOf": "2026-08" },
    { "source": "정보나루", "name": "누적 대출", "value": "27,551회", "asOf": "2026-08" },
    { "source": "정보나루", "name": "소장 도서관", "value": "1,535개관", "asOf": "2026-08" }
  ],
  "loanByAge": null,
  "my": null | {
    "libraryItemId": "li_9021", "status": "READ",
    "rating": 4, "reviewText": null, "finishedDate": "2026-09-01"
  }
}
```

- `metrics[].value` 는 **표시용 문자열**을 서버가 만든다 (프론트가 그대로 그린다). 없는 지표는 항목을 빼면 화면이 섹션을 숨긴다.
  원천은 `book_demand_features`(월 스냅샷). 나갈 수 있는 항목과 채움률(09-10, EC2): **누적 대출** 100% · **소장 도서관** 100% ·
  **최근 3개월 대출** 10.8% · **전국 대출 순위** 상위 25% 이내인 책만. 순위는 등수를 세지 않고 기준월 경계값 5개(1·3·5·10·25%)와 비교해 만든다 —
  275만 행을 세는 대신 경계값만 캐시한다. 상위 25% 밖이면 항목을 뺀다(「상위 80%」는 화면에 쓸모가 없다).
- **항상 `null` 인 필드**: `subtitle`(원천 없음) · `toc`(국중 목차 미적재) · `pageCount`(`books` 에 컬럼 없음) ·
  `loanByAge`(정보나루 `loan_grps` 수집률 0.7%라 적재하지 않기로 — 임베딩 보고서 §8). 키는 유지하니 프론트는 null 이면 섹션을 숨긴다.
  A안 상세의 「이 책을 빌린 사람들」 막대그래프와 목차 섹션은 **데이터가 오지 않는다** — 화면에서 빼거나 키워드·소장 도서관 수로 대체해야 한다.
- `my` 는 **본인 서재 항목**. 프론트 타입은 `myLibraryStatus`/`myRating`/`myReviewText` 세 필드인데 `libraryItemId` 가 없어 상세에서 편집을 못 해 서재로 보낸다. `my` 객체로 묶고 `libraryItemId` 를 넣는다 — §9-5. 비로그인·타인 것은 절대 노출하지 않는다(계약 §6.2).

### 4.5 `GET /books/{bookId}/similar?size=` ● (2차 — Qdrant 적재량 부족으로 아직 만들지 않음)

「비슷한 책」. 임베딩 연구 결론(`docs/pipeline/EMBEDDING_STUDY_REPORT.md` §0·§8)대로 **어휘 이웃 ‖ 밀집 이웃 역순위 융합**, 같은 작품(`set_isbn`·제목+저자) 묶어 1권만. `size` 기본 8, 최대 20.

**PostgreSQL 은 이 API 에 관여하지 않는다.** 벡터는 Qdrant 에 있고(`books_active` 별칭, 1536차원 `text-embedding-3-small`) 적재·검색은 FastAPI 쪽이 한다.
V2 가 만든 `book_embeddings` 표는 한 번도 쓰이지 않았고 **V4(09-11)에서 지웠다** — 08-31 운영안이 이미 「만들지 않는다」고 정해 둔 표였다.

막고 있는 것은 **적재량**이다. 09-11 EC2 기준 `books_active` 에 1만 권, 카탈로그 331만 권의 0.3% 다. 지금 열면 대부분의 책에서 빈 결과가 나온다.
만드는 방법 자체는 열려 있다 — AI 서비스의 `POST /internal/v1/recommendations` 에 `seedIsbns=[그 책]` 을 넣으면 그게 「이 책과 비슷한 책」이라 백엔드는 얇은 프록시면 된다.

```json
{ "items": [ { "book": BookSummary, "reason": "같은 작가 · #성장", "score": 0.83 }, … ] }
```

### 4.6 `GET /books/{bookId}/co-loans?size=` ● (09-10 구현)

「함께 대출된 책」. 정보나루 `coLoanBooks`(책당 10권, 1단계 82.9%) 를 `book_relations`(relation_type=`CO_LOAN`) 에서 그대로 서빙한다. 추천 계산이 아니다.
`size` 기본 8, 최대 20. 카탈로그(`books`)에 없는 대상은 빠지므로 `rank` 가 건너뛸 수 있다(연결률 99.9%). 관계가 없으면 `items: []` 에 `asOf: null`.

```json
{ "items": [ { "book": BookSummary, "rank": 1 }, … ], "source": "DATA4LIBRARY", "asOf": "2026-08" }
```

<br/>

## 5. 추천

### 5.1 `GET /recommendations?size=&tags=` ●

| 쿼리 | 규칙 |
| --- | --- |
| `size` | 기본 **10**, 최대 30. 프론트 덱은 5장(`RECOMMEND_DECK_SIZE`), mock 은 30 — 여기서 10 으로 확정(§9-7) |
| `tags` | 반복 파라미터 `tags=#소설&tags=#신간`, 최대 5. TunePage 의 「이 태그로 추천받기」를 서버에 반영하는 통로. 없으면 관심 태그를 사용하고, 관심 태그도 없으면 연령·성별 인기순위 콜드스타트로 대체 |

온보딩 미완료(`PENDING`)면 `409 ONBOARDING_REQUIRED`. 비회원 모드는 없다.

```json
{
  "recommendationId": "rec_01J7…",
  "generatedAt": "2026-09-07T03:00:00Z",
  "mode": "PERSONALIZED",                 // COLD_START | PERSONALIZED
  "fallback": false,                      // true = 개인화 실패로 세그먼트 인기 대체
  "basedOnCount": 4,                      // "최근 기록한 N권을 보고 골랐어요"
  "weights": { "taste": 60, "coLoan": 0, "trending": 15, "steady": 10, "newField": 15 },
  "appliedTags": ["FICTION", "SCIENCE"],
  "items": [
    { "book": BookSummary, "rank": 1, "score": 91.2,
      "featureScores": [ { "key": "taste", "rawScore": 88 }, { "key": "coLoan", "rawScore": null }, … ],
      "tags": ["FICTION", "SCIENCE"],
      "reasonType": "TEXT_SIMILARITY",
      "reasonText": "최근 별 다섯 개를 준 『소년이 온다』와 문장 결이 닿아 있어요." }
  ]
}
```

`appliedTags`와 `items[].tags`는 태그 사전(`GET /tags`)의 불변 `code`를 사용한다.
표시명은 프론트가 `GET /tags`의 `label`로 변환한다. AI 내부 인덱스의 별칭은 백엔드
응답 경계에서 공개 code로 변환한다(`FIC → FICTION`, `ECONOMY → BUSINESS`,
`GROWTH → SELF_HELP`).

- `items` 는 `rank` 오름차순, 서재에 있는 책 제외, 같은 작품 1권.
- 관심 태그와 행동 seed가 모두 없으면 `book_loaned_top20` 최신 기준월을 사용한다. 출생연도·성별이 있으면 해당 연령×성별, 성별이 없으면 연령대 남녀 합산, 연령도 없거나 해당 세그먼트가 비어 있으면 전체 세그먼트 합산 순위로 완화한다. 이 경로의 `mode` 는 `COLD_START`, `fallback` 은 `true`, `reasonType` 은 `SEGMENT_POPULAR` 이다.
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

`status` 없으면 전체(`WISH`/`READ`, 대소문자 무관 — 본문과 같은 규칙). 정렬 `updatedAt` 내림차순. 페이지 없음(사용자 서재는 수백 권 규모) — `{ "items": [ LibraryItem, … ] }`.

### 6.2 `POST /library` ●

```json
{ "bookId": "88123", "status": "WISH" }
```

**201 + `LibraryItem` 본문.** 지금 mock 은 본문 없이 201 이라 프론트가 새 `libraryItemId` 를 알 수 없다(§9-5). 이미 있으면 `409 LIBRARY_ITEM_EXISTS` + `details.libraryItemId` — 프론트는 그걸로 `PATCH` 하면 된다. `status=READ` 면 `finishedDate=오늘`(**Asia/Seoul** 기준, 09-10 확정 — 서버 Clock 은 UTC 라 그대로 쓰면 한국 새벽에 전날이 들어간다). 본문은 `bookId`·`status` 두 필드만(09-10 확정) — 별점·감상은 응답의 `libraryItemId` 로 PATCH.

### 6.3 `PATCH /library/{libraryItemId}` ●

부분 갱신. 보낸 필드만 바꾼다.

```json
{ "status": "READ", "rating": 4, "reviewText": "전개가 빠르다.", "finishedDate": "2026-09-01" }
```

| 규칙 | |
| --- | --- |
| `READ` 로 바꾸며 `finishedDate` 가 없거나 `null` 이면 | 오늘(Asia/Seoul) |
| `WISH` 로 바꾸면 | `finishedDate=null` |
| `status` 없이 보내면(평점·감상평만) | `finishedDate` 유지 — 온보딩 seed 의 `null` 도 그대로. `finishedDate` 를 직접 보내면 `READ` 항목에 한해 반영 |
| `reviewText` | 앞뒤 공백 제거, 빈 문자열 → `null`, 300자 초과 `400` |
| `rating` | 1~5 정수 또는 `null`(삭제) |
| 이미 `READ` 인데 `status=READ` 를 다시 보내면 | `finishedDate` 유지(멱등). 온보딩 seed 의 `null` 도 그대로 |
| `status` 전환 없이 `finishedDate` 에 `null` 을 보내면 | 이미 `READ` 인 항목의 완독일을 지운다(seed 처럼 `null`). `WISH` 항목은 무시 |
| `rating` | `1~5` 정수 또는 `null`(삭제). 빈 문자열 `""` 은 `400` — 삭제로 오인하지 않는다 |
| `reviewText` 300자 | 글자(코드포인트) 수 기준 — PG `VARCHAR(300)` 과 같다. 이모지 하나 = 1자 |
| `status`·`rating`·`reviewText`·`finishedDate` 위반 | 모아서 한 번에 `400 VALIDATION_FAILED`, `details.fields[{field, reason}]` |
| 타인 항목 | `403` |
| 없는 항목(숫자가 아닌 id 포함) | `404 LIBRARY_ITEM_NOT_FOUND`, `details.libraryItemId` |

**200 + `LibraryItem`.**

### 6.4 `DELETE /library/{libraryItemId}` ●

**204.** 찜 해제·서재에서 빼기. 계약 §4.2 「`READ` 는 WISH 취소만으로 삭제하지 않는다」는 *상태 변경*의 규칙이고, 명시적 삭제는 허용한다. 프론트에 버튼이 없다 — §9-10.

<br/>

## 7. 이벤트

### 7.1 `POST /events` ● (09-11 구현)

```json
{ "eventType": "CLICK", "bookId": "88123", "recommendationId": "rec_3f9c1a20b7d84e55",
  "rank": 3, "position": 1, "context": "RECOMMEND", "sessionId": "8f1e…",
  "occurredAt": "2026-09-11T03:12:44.120Z", "clientEventId": "c1f0-…" }
```

| `eventType` | 없으면 버리는 값 | 뜻 |
| --- | --- | --- |
| `IMPRESSION` | `recommendationId` | 추천이 화면에 뜸. **덱 단위(덱당 1회)와 카드 단위(`bookId`+`position`) 둘 다 받는다** |
| `CLICK` | `bookId` | 추천·홈에서 상세로 진입 |
| `BOOK_VIEW` | `bookId` | 상세 화면 열람 (책당 1회/마운트). `dwellMs` 로 체류 시간 |
| `WISH` | `bookId` | 찜 등록. 개인화 정본은 `user_library`, 이 이벤트는 「어느 화면에서 담았나」 |
| `DISMISS` | `bookId` | **카드를 넘기거나 다른 책으로 바꿔 꺼냄 — 하나뿐인 부정 신호** |
| `SEARCH` | `query` | 검색 실행. `query`·`resultCount` 가 `payload` 로 |
| `REASON_VIEW` | `recommendationId`, `bookId` | 추천 이유 펼침 |

**202, 본문 없음. 언제나 202 다** — 종류를 모르든, 없는 책이든, 본문이 비었든 오류를 내지 않는다(계약 §4.5).
대신 위 조건을 못 채운 이벤트는 **저장하지 않고 버린다.** 즉 202 는 「받았다」이지 「저장했다」가 아니다.
`bookId` 는 내부 id 와 13자리 ISBN13 을 모두 받고 카탈로그에 있어야 한다. 길이를 넘는 문자열은 잘라서라도 저장하고, 범위 밖 `rank`·`position` 은 비운다.
클라이언트 시계가 5분 이상 앞서면 `occurredAt` 을 서버 수신 시각으로 바꾼다.

#### 프론트가 채워 줘야 하는 것 (현재 `lib/events.ts` 에 없음)

| 필드 | 왜 필요한가 |
| --- | --- |
| `clientEventId` | `(userId, clientEventId)` 로 중복 제거한다. **지금 안 보내서 중복 제거가 동작하지 않는다** — StrictMode 이중 마운트와 뒤로가기 재진입으로 같은 노출이 두 번 들어온다 |
| `position` | 화면에서 실제로 보인 자리. `rank`(서버 순위)와 **다르다** — RecommendPage 가 덱을 태그 겹침으로 재정렬한 뒤 앞 5장만 편다. 두 값을 같다고 보면 위치 편향 보정이 틀어진다 |
| 카드 단위 `IMPRESSION` | 덱 단위 노출만으로는 「10권을 보냈는데 5권만 보였다」를 구분할 수 없다. 안 보인 책을 「관심 없음」으로 학습시키게 된다 |
| `DISMISS` | 넘긴 카드. 유일한 부정 신호이자 `excludeIsbns` 의 원천 |
| `context` · `sessionId` | 화면 출처와 방문 묶기. 검색 → 상세 → 찜 흐름을 볼 수 있다 |

#### 쌓인 기록을 어디에 쓰나

추천 요청(`AiRecommendationRequest`)이 받는 칸은 셋뿐이고, 이벤트가 추천을 바꾸는 방법도 그 셋이 전부다.

| 요청 필드 | 지금 | 이벤트로 |
| --- | --- | --- |
| `seedIsbns` | `READ` + 평점이 있는 서재 항목만 | 찜한 책, 반복 열람한 책(`BOOK_VIEW` 2회 이상, 최근성 감쇠) |
| `excludeIsbns` | 서재에 담긴 책 | `DISMISS` 한 책, 노출됐는데 클릭 0인 책 |
| `tags[].weight` | 전부 1.0 하드코딩 | 클릭·찜한 책의 태그 빈도 |

측정용으로는 덱 CTR · `reasonType` 별 클릭률 · 찜 전환율을 뽑아 `weights` 재조정 근거로 쓴다.
**이 계산은 모두 추천 스냅샷과 짝이다** — 무엇을 보여줬는지는 덱에만 있다(아래).

### 7.2 추천 스냅샷 (09-11 구현 · 내부)

`GET /recommendations` 는 응답을 내보낼 때 그 덱을 `recommendations` · `recommendation_items` 에 그대로 저장한다. API 응답 형태는 달라지지 않는다.

- 응답의 `recommendationId` 가 `recommendations.public_id` 다. 이벤트의 `recommendationId` 는 이 값으로 덱을 찾는다.
- 함께 남기는 것: `mode` `fallback` `basedOnCount` `weights` `appliedTags` `modelVersion` `indexVersion`, 항목별 `rank` `score` `featureScores` `tags` `reasonType` `reasonText`.
- **저장 실패는 추천 응답을 막지 않는다.** 로그만 남기고 응답은 그대로 나간다.
- 저장된 덱이 없는 `recommendationId` 로 이벤트가 오면 그 연결만 비우고 이벤트는 저장한다 — 책 단위 신호까지 버리지 않는다.

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
| `similar` | Qdrant `books_active`(1536d `text-embedding-3-small`) ‖ 어휘 이웃 | 09-11 기준 1만 권 적재. PG 에는 벡터를 두지 않는다(V4) |
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
| 16 | `lib/events.ts` 가 `clientEventId`·`position`·`context`·`sessionId` 를 안 보내고 노출이 덱 단위뿐 | §7.1 「프론트가 채워 줘야 하는 것」대로 채우고 카드 단위 `IMPRESSION` 과 `DISMISS` 추가 | 중복 제거가 아예 동작하지 않고, 화면에 뜬 적 없는 책이 「보여줬는데 안 눌렀다」로 집계된다 |

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
| 「비슷한 책」후보 생성 경로 | ~~pgvector 단독~~ / Qdrant + 어휘 융합 | **Qdrant 로 정리됨(09-11)** — 남은 것은 융합 여부와 적재 완주 |
| `reasonText` 템플릿 문장 | `reasonType` 8종별 | 추천 구현 문서 |
| JWT 만료·갱신 | 24시간 고정 / refresh 토큰 도입 | 베타 운영 피드백 |
| 이벤트 보존 기간·집계 | 원본 90일 / 일별 집계 영구 | W3 지표 설계 |
| 온디맨드 카카오 등록 정책 | 검색 결과 0건 + ISBN 형태일 때만 | L0 적재 후 |
