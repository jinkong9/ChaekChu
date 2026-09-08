# AI FastAPI 추천 서버 계약서

> 상태: 초안 — 백엔드·AI 담당자 검토용
> 기준 브랜치: `dev` (`df299a1`)
> 관련 Jira: `S15P21B102-130`, `S15P21B102-131`, `S15P21B102-142`, `S15P21B102-143`, `S15P21B102-150`

이 문서는 Spring Boot 백엔드와 Python FastAPI 추천 서버 사이의 책임, 요청·응답 DTO,
추천 계산 방식과 아직 결정하지 않은 사항을 고정하기 위한 초안이다. 현재 확보한
Data4Library(D4L) snapshot에 실제로 존재하는 값만 추천 입력으로 사용한다.

## 1. 한 줄 요약

백엔드가 사용자 식별자·seed ISBN·제외 ISBN·D4L 후보 snapshot을 보내면, FastAPI가
snapshot을 검증하고 결정적인 규칙 기반 추천을 계산해 추천 결과만 반환한다.

FastAPI는 원천 수집 API, PostgreSQL, Elasticsearch, Qdrant를 직접 호출하지 않는다.
GMS API나 외부 LLM도 현재 계약에는 포함하지 않는다. 현재 snapshot에 책소개·키워드가
추천 입력으로 보장되지 않기 때문이다.

## 2. 서비스 책임

```text
Data pipeline / DB
  └─ D4L 원본 수집·정제·snapshot 제공
       ↓
Spring Boot Backend
  ├─ 인증·userId 확인
  ├─ seed / exclude ISBN 결정
  ├─ 서비스 DB에서 후보 snapshot 구성
  ├─ FastAPI 호출·timeout·재시도·최종 저장
  └─ ISBN13을 canonical bookId로 매핑
       ↓ POST /internal/v1/recommendations
FastAPI AI Server
  ├─ 요청 DTO와 D4L 필드 검증
  ├─ 후보 중복·seed·exclude 처리
  ├─ 관계·서지·대출 feature 계산
  ├─ 후보 점수 계산·정렬·추천 이유 생성
  └─ 추천 결과 DTO 반환
```

| 주체 | 책임 | 하지 않는 일 |
| --- | --- | --- |
| 데이터 파이프라인 | D4L 원천 수집, 정제, snapshot 생성 | 추천 점수 계산 |
| Spring Boot | 사용자·DB·인증, 후보 구성, AI 호출, 결과 저장·조회 | AI 내부 점수 계산 |
| FastAPI | 입력 검증, 추천 계산, 결과·이유 반환 | 원천 API 호출, 사용자 DB 저장, 인증 판단 |
| CI/CD·운영 | 실행 환경, 배포, health check 라우팅, 비밀값 주입 | 추천 알고리즘 변경 |

## 3. API 목록

### 3.1 추천 생성

```http
POST /internal/v1/recommendations
Content-Type: application/json
```

백엔드가 정제한 snapshot을 한 번에 전달하는 내부 API다. 현재는 페이지네이션을 사용하지
않으며, `size`만큼의 추천 항목을 반환한다.

### 3.2 상태 확인

```http
GET /health
```

응답:

```json
{"status": "ok"}
```

애플리케이션 수준의 인증 헤더·서비스 간 토큰은 현재 FastAPI 코드에 없다. 운영에서는
내부 네트워크 제한이나 gateway/token 적용 방식을 `#143`, `#150`에서 백엔드·운영 담당자와
확정해야 한다.

## 4. 요청 DTO

### 4.1 `RecommendationRequest`

| 필드 | 타입 | 필수 | 기본값·제약 | 의미 |
| --- | --- | ---: | --- | --- |
| `requestId` | `string` | O | 빈 문자열 불가 | 요청 멱등성·추적 키 |
| `userId` | `string` | O | 빈 문자열 불가 | 추천 대상 사용자 식별자 |
| `mode` | `COLD_START \| PERSONALIZED` | O | - | 추천 모드 |
| `size` | `integer` |  | `10`, 1~30 | 반환할 최대 항목 수 |
| `seedIsbns` | `string[]` |  | `[]` | 사용자의 관심 기준 도서 ISBN13 |
| `excludeIsbns` | `string[]` |  | `[]` | 결과에서 제외할 ISBN13 |
| `weights` | `RecommendationWeights` |  | 아래 기본값 | feature 가중치 |
| `books` | `D4LBookInput[]` | O | 최소 1건 | 추천 대상 후보 snapshot |

`books[].isbn13`은 요청 안에서 유일해야 한다. `seedIsbns`가 snapshot 안에 하나도
없으면 현재 구현은 `fallback = true`, `mode = COLD_START`로 처리한다. seed ISBN과
exclude ISBN은 추천 결과에서 제외한다.

### 4.2 `RecommendationWeights`

| 필드 | 타입 | 기본값 |
| --- | --- | ---: |
| `taste` | `number >= 0` | 60 |
| `coLoan` | `number >= 0` | 0 |
| `trending` | `number >= 0` | 15 |
| `steady` | `number >= 0` | 10 |
| `newField` | `number >= 0` | 15 |

가중치 합계는 100일 필요가 없다. 실제 값이 존재하는 feature만 분모에 포함해
가중평균한다. 현재 D4L snapshot에는 `newField`가 없으므로 기본 설정에서는 해당
가중치가 자동으로 제외된다.

### 4.3 `D4LBookInput`

추천 계약에서 허용하는 도서 필드는 아래와 같다. 필드명은 현재 수집 snapshot의
원본 이름을 그대로 따른다.

| 필드 | 타입 | 필수 | 검증·용도 |
| --- | --- | ---: | --- |
| `isbn13` | `string` | O | `978` 또는 `979`로 시작하는 13자리 |
| `ok` | `boolean \| null` |  | 원본 처리 성공 여부 |
| `bookname` | `string` | O | 빈 문자열 불가 |
| `authors` | `string \| null` |  | 저자 일치 feature |
| `publisher` | `string \| null` |  | 보조 서지 feature |
| `pub_year` | `string \| null` |  | 응답 표시용 |
| `class_no` | `string \| null` |  | 세부 분류 일치 feature |
| `class_nm` | `string \| null` |  | 상위 분류 일치 feature |
| `add_symbol` | `string \| null` |  | 응답 표시용 |
| `loan_total` | `integer >= 0` | O | 누적 대출량, steady feature |
| `co_loan` | `[isbn13, title][]` |  | 함께대출 관계와 순위 |
| `mania_rec` | `[isbn13, title][]` |  | 마니아 추천 관계와 순위 |
| `reader_rec` | `[isbn13, title][]` |  | 다독자 추천 관계와 순위 |
| `loan_history` | `[month, number, number][]` |  | 월별 대출 이력과 최신 수요 |

실제 snapshot 예시는 다음과 같다.

```json
{
  "isbn13": "9788959772087",
  "ok": true,
  "bookname": "임플란트 대작전",
  "authors": "전경남 글 ;지문 그림",
  "publisher": "좋은책어린이",
  "pub_year": "2016",
  "class_no": "813.7",
  "class_nm": "문학 > 한국문학 > 소설",
  "add_symbol": "73810",
  "loan_total": 164338,
  "co_loan": [["9788928318049", "걱정 세탁소 :걱정을 세탁해 드립니다!"]],
  "mania_rec": [["9788928307043", "쫀쫀 공주의 짜사공"]],
  "reader_rec": [["9788949162539", "하하 자매 떡집"]],
  "loan_history": [["2026년 07월", 110, 17453]]
}
```

`loan_history`의 세 번째 값은 원본 snapshot에서 보존하지만, 현재 추천 baseline은
두 번째 값만 최신 대출량 proxy로 사용한다. 세 번째 값의 정확한 의미와 기준은
`#131` 데이터 검증에서 확정해야 한다.

일부 실제 원본 행에는 `img`가 추가로 존재한다. 표지 URL은 추천 feature가 아니므로
현재 AI 응답에 포함하지 않는다. 백엔드 화면에 필요하면 canonical 도서 데이터에서
별도로 제공한다.

## 5. 응답 DTO

### 5.1 `RecommendationResponse`

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `recommendationId` | `string` | `requestId`, `userId`, 모델 버전으로 만든 결과 식별자 |
| `requestId` | `string` | 원 요청 추적 키 |
| `userId` | `string` | 추천 대상 사용자 |
| `generatedAt` | ISO datetime | 결과 생성 시각 |
| `mode` | `COLD_START \| PERSONALIZED` | 실제 적용된 모드 |
| `modelVersion` | `string` | 현재 `d4l-relations-v1` |
| `fallback` | `boolean` | seed 기반 개인화 대신 cold-start로 대체됐는지 여부 |
| `basedOnCount` | `integer` | snapshot 안에서 유효하게 찾은 seed 수 |
| `weights` | `RecommendationWeights` | 실제 적용한 가중치 |
| `appliedTags` | `string[]` | 전체 추천에 적용한 태그. 현재는 빈 배열 |
| `items` | `RecommendationItem[]` | 점수순 추천 결과 |

### 5.2 `RecommendationItem`

현재 구현은 도서 정보를 `book` 객체 안에 넣는다.

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `book` | `RecommendationBook` | ISBN13과 화면 표시용 서지 정보 |
| `rank` | `integer >= 1` | 결과 순위 |
| `score` | `0~100 number` | 최종 가중 점수 |
| `featureScores` | `FeatureScore[]` | feature별 계산 점수 |
| `tags` | `string[]` | 항목 추천 이유를 보여주는 태그 |
| `reasonText` | `string` | 사용자에게 보여줄 추천 이유 |
| `reasonType` | `string` | 추천 이유 코드 |

`RecommendationBook`은 `isbn13`, `bookname`, `authors`, `publisher`, `pub_year`,
`class_no`, `class_nm`을 포함한다. AI는 `bookId`를 생성하거나 DB에 저장하지 않는다.
백엔드는 응답의 `book.isbn13`을 canonical `bookId`와 매핑한다.

응답 예시:

```json
{
  "recommendationId": "rec_2e1f...",
  "requestId": "req-20260908-001",
  "userId": "user-123",
  "generatedAt": "2026-09-08T04:00:00Z",
  "mode": "PERSONALIZED",
  "modelVersion": "d4l-relations-v1",
  "fallback": false,
  "basedOnCount": 1,
  "weights": {
    "taste": 60,
    "coLoan": 0,
    "trending": 15,
    "steady": 10,
    "newField": 15
  },
  "appliedTags": [],
  "items": [
    {
      "book": {
        "isbn13": "9788928318049",
        "bookname": "걱정 세탁소 :걱정을 세탁해 드립니다!",
        "authors": "정성훈",
        "publisher": "웅진주니어",
        "pub_year": "2020",
        "class_no": "813.7",
        "class_nm": "문학 > 한국문학 > 소설"
      },
      "rank": 1,
      "score": 81.25,
      "featureScores": [
        {"key": "taste", "rawScore": 40.0},
        {"key": "coLoan", "rawScore": null},
        {"key": "trending", "rawScore": 100.0},
        {"key": "steady", "rawScore": 72.4},
        {"key": "newField", "rawScore": null}
      ],
      "tags": ["#함께대출"],
      "reasonText": "관심 도서와 함께 대출된 책이에요.",
      "reasonType": "CO_LOAN"
    }
  ]
}
```

## 6. 현재 추천 계산 방식

현재 구현은 모델 학습이나 임베딩 검색이 아닌, 실제 D4L 필드로 재현 가능한 baseline이다.

### 6.1 후보 제외

1. 요청의 `books`를 ISBN13으로 인덱싱한다.
2. `seedIsbns`와 `excludeIsbns`를 제외 목록으로 합친다.
3. 후보가 snapshot에 없으면 seed로 사용하지 않는다.
4. 남은 후보만 점수 계산 대상이 된다.

### 6.2 feature 계산

| feature | 계산 방식 |
| --- | --- |
| `coLoan` | seed의 `co_loan` 순위에 따라 `1 / rank`를 계산하고 100배 |
| `mania_rec` | seed의 `mania_rec` 순위에 따라 `0.75 / rank`를 계산 |
| `reader_rec` | seed의 `reader_rec` 순위에 따라 `0.5 / rank`를 계산 |
| `taste` | 같은 저자 60점, 같은 `class_no` 40점. 분류가 없을 때 같은 출판사 15점 |
| `trending` | 후보의 최신 `loan_history[][1]`을 snapshot 내 최대값으로 0~100 정규화 |
| `steady` | `loan_total`을 snapshot 내 최대값으로 0~100 정규화 |
| `newField` | 현재 데이터에 근거가 없어 `null` |

관계 feature는 현재 seed 중 가장 높은 값만 사용한다. 추천 이유 우선순위는
`co_loan` → `mania_rec` → `reader_rec` → 같은 저자 → 같은 분류 → 수요 인기순이다.

### 6.3 최종 정렬

가용한 feature에 대해서만 다음 가중평균을 계산한다.

```text
score = Σ(featureScore × weight) / Σ(사용 가능한 feature의 weight)
```

동점이면 `loan_total` 내림차순, 다시 같으면 `isbn13` 오름차순으로 정렬한다. 따라서
같은 요청 snapshot·가중치·코드 버전에서는 같은 순위가 재현된다.

### 6.4 fallback

seed가 없거나 snapshot에서 seed를 찾지 못하면 `fallback = true`로 두고 전체 후보의
대출 수요와 서지 feature 중심으로 정렬한다. 외부 LLM을 호출해 설명이나 점수를
추정하지 않는다.

## 7. 오류와 장애 처리

| 상황 | FastAPI 응답 | 처리 주체 |
| --- | --- | --- |
| 정상 추천 | `200` + `RecommendationResponse` | 백엔드가 ISBN 매핑 후 저장·반환 |
| 필수값·타입·범위·중복 ISBN 오류 | `422` | 백엔드가 요청 수정 또는 오류 응답 |
| 후보가 모두 제외됨 | `200` + 빈 `items` 가능 | 백엔드가 화면 fallback 정책 적용 |
| AI 서버 timeout | 응답 없음 | 백엔드가 마지막 성공 결과 또는 cold-start 사용 |
| AI 서버 `5xx` | 오류 응답 | 백엔드가 재시도·fallback·장애 로그 처리 |
| AI 응답 schema 불일치 | 백엔드 검증 실패 | 성공 저장하지 않고 fallback |

부분 결과를 성공으로 반환하지 않는다. `requestId`는 백엔드의 재시도 중복 저장 방지와
AI 로그 추적에 사용한다.

## 8. 보안·데이터 경계

- 감상평, OAuth secret, access token, 내부 DB 비밀번호를 AI 요청에 넣지 않는다.
- 현재 추천에 필요하지 않은 `img` 등 원본 부가 필드는 AI 입력 계약에서 사용하지 않는다.
- 원본 대용량 JSONL/GZIP은 Git에 커밋하지 않는다. 로컬 검증용 fixture로만 사용한다.
- AI 로그에는 전체 snapshot이나 사용자 행동 원문을 남기지 않고 `requestId`, 건수,
  버전, 오류 유형 중심으로 기록한다.
- 운영 인증·네트워크 제한은 애플리케이션 추천 로직과 분리해 `#150`에서 확정한다.

## 9. 현재 구현과 후속 확인 사항

다음 항목은 문서에 명시적으로 판단이 필요한 부분이다.

1. **응답 도서 구조**: 현재는 `items[].book.isbn13` 중첩 구조다. 기존 백엔드·프론트가
   `items[].isbn13` 평탄 구조를 기대한다면 하나로 통일해야 한다.
2. **reasonType 코드**: 현재 AI는 `CO_LOAN`, `MANIA_REC`, `READER_REC`를 반환하지만
   프론트 타입에는 아직 `TEXT_SIMILARITY`, `SEGMENT_POPULAR` 등 기존 코드가 남아 있다.
   백엔드에서 변환할지, 공통 enum을 확장할지 결정해야 한다.
3. **unknown field 정책**: 실제 원본의 `img` 같은 부가 필드를 허용할지, Pydantic에서
   `extra=forbid`로 차단할지 결정해야 한다. 추천 계약만 보면 차단이 더 안전하다.
4. **snapshot 전달 범위**: MVP는 백엔드가 후보 전체를 `books`로 전달하는 방식이다.
   운영 데이터가 커지면 백엔드가 후보를 줄이거나 AI 전용 snapshot 저장소를 둘지 재검토한다.
5. **대출 이력 의미**: `loan_history` 세 번째 값의 의미와 기준월을 `#131`에서 검증한다.
6. **LLM/GMS 사용 여부**: 현재 D4L 필드만 사용한다는 제약에서는 사용하지 않는다. 이후
   LLM을 도입하려면 입력 필드, 비용·timeout, 근거 표시, 모델 버전을 별도 계약으로 추가한다.

## 10. 역할별 다음 순서

문서 승인 후 AI 담당 작업 순서는 다음과 같다.

1. `#131`: 실제 1000건 snapshot 품질 검증 및 통계 리포트
2. `#132`: 고정 필드 정규화와 `inputHash` 구현
3. `#133`: 관계 정답·인기 기준선과 P@10/R@50/coverage 평가
4. `#134~#141`: 중복 제거, 후보 생성, feature·랭킹·fallback·개인화 구현
5. `#143`: Spring Boot-FastAPI 통합 테스트와 timeout·5xx 검증
6. `#150`: 실행·헬스체크·배포·운영 계약 마무리

이 문서에서 1~9의 계약이 합의되면, 다음 구현 단위는 `#131`이다.
