# AI FastAPI 추천 서버 계약서

> 상태: 초안 v2 — 백엔드·AI 담당자 검토 방향 반영
> 기준 데이터: ISBN 중복 제거가 완료된 D4L 도서 약 100만 건
> 관련 Jira: `S15P21B102-131`, `S15P21B102-132`, `S15P21B102-135`~`S15P21B102-143`, `S15P21B102-150`, `S15P21B102-159`

이 문서는 백엔드와 FastAPI 추천 서버의 책임, 사전 색인 배치, 요청·응답 DTO,
추천 계산 방식을 정의한다. FastAPI는 매 요청마다 100만 건의 도서 snapshot을 받지
않는다. 도서 임베딩·태그·D4L feature를 미리 색인하고, 요청 시 사용자의 추천 방향만
받아 후보를 검색하고 재정렬한다.

## 1. 결정된 전체 구조

```text
[오프라인 배치]
D4L 도서 약 100만 건
  ├─ ISBN 중복 제거 완료 데이터 사용
  ├─ 실제 필드 정규화
  ├─ 도서 임베딩 생성
  ├─ 통제된 태그 생성·매핑
  ├─ 대출·관계 feature 계산
  └─ Vector DB + metadata index 적재
        │
[온라인 추천]
Spring Boot
  └─ 사용자 태그·가중치·seed/exclude ISBN 전달
        ↓ POST /internal/v1/recommendations
FastAPI
  ├─ 요청 DTO 검증
  ├─ 태그·seed 기반 query vector 생성
  ├─ Vector DB에서 후보 100~300개 검색
  ├─ 태그·관계·수요 feature로 재랭킹
  ├─ 중복·제외·다양성 보정
  └─ 상위 5개와 결정적 추천 이유 반환
        ↓
Spring Boot
  ├─ ISBN13 → canonical bookId 매핑
  ├─ 도서 상세 정보 결합
  └─ 추천 결과 저장·조회·화면 응답
```

## 2. 서비스별 책임

| 주체 | 담당 내용 | 담당하지 않는 내용 |
| --- | --- | --- |
| 데이터 배치 | D4L 입력 정규화, 임베딩 생성, 태그 생성·매핑, Vector DB 적재 | 사용자별 온라인 추천 |
| Spring Boot | 인증, 사용자 태그·가중치 조회, seed/exclude 결정, FastAPI 호출, 결과 저장 | 임베딩 검색·점수 계산 |
| FastAPI | 요청 검증, query vector 생성, 후보 검색, 재랭킹, 추천 이유 반환 | 원천 API 호출, 사용자 DB 저장 |
| Vector DB | 도서 벡터 ANN 검색과 필요한 metadata filter | 사용자 요청 조합 |
| 운영·CI/CD | 배치·FastAPI 실행, health check, 배포와 비밀값 관리 | 추천 기준 임의 변경 |

FastAPI는 논리적으로 추천 인덱스를 소유하지만, 100만 개 벡터를 Python 프로세스
메모리에 직접 보관하지 않는다. Qdrant 또는 pgvector 같은 검색 저장소를 사용한다.

## 3. 오프라인 도서 색인

### 3.1 입력 필드

현재 확보한 D4L 원본에서 추천에 사용할 필드는 다음과 같다.

```text
isbn13, bookname, authors, publisher, pub_year,
class_no, class_nm, add_symbol, loan_total,
co_loan, mania_rec, reader_rec, loan_history
```

`img`처럼 일부 원본에만 있는 표지 URL은 추천 feature가 아니므로 임베딩·태그 생성에
사용하지 않는다. 화면용 표지와 canonical 도서 정보는 백엔드가 관리한다.

### 3.2 임베딩 생성

도서별 임베딩 텍스트는 현재 데이터에 존재하는 서지·분류 필드만 조합한다.

```text
bookname + authors + publisher + class_no + class_nm
```

`co_loan`, `mania_rec`, `reader_rec`, `loan_history`는 텍스트 임베딩에 섞지 않고
별도 metadata와 재랭킹 feature로 저장한다. 책소개·키워드가 확보되지 않은 도서에
대해 내용 유사도를 가장하지 않는다.

각 벡터에는 다음 metadata를 함께 저장한다.

```text
isbn13
bookname, authors, publisher
pub_year, class_no, class_nm
tagCodes, tagScores, tagConfidence
loan_total, loan_history
co_loan, mania_rec, reader_rec
embeddingVersion, tagVersion, featureVersion
```

임베딩 모델과 차원은 배치 설정으로 고정한다. 모델이나 입력 조합이 바뀌면 전체 또는
변경된 도서만 다시 생성하고 `embeddingVersion`을 변경한다.

### 3.3 태그 생성·매핑

백엔드가 보내는 태그와 도서에 저장된 태그는 자유 문자열이 아니라 통제된 taxonomy의
`code`로 맞춘다.

```text
분류: FIC, ESSAY, SCIENCE, HISTORY, ECONOMY
장르: FANTASY, MYSTERY, ROMANCE
소재: GROWTH, FAMILY, TIME_TRAVEL
신호: TRENDING, STEADY, NEW_BOOK
```

태그 생성 우선순위는 다음과 같다.

1. `class_nm`, `class_no`에서 확정 가능한 분류 태그 생성
2. `bookname`, `authors`, 분류 정보를 이용한 규칙 기반 매핑
3. 규칙으로 판단하기 어려운 항목은 선택적으로 GMS LLM 배치 생성
4. 생성 결과에 `tagVersion`, `source`, `confidence` 저장

GMS LLM을 사용하더라도 추천 요청 시 매번 호출하지 않는다. 오프라인 배치에서만
사용하고, 생성된 태그를 검토·버전 관리한 뒤 검색과 재랭킹에 사용한다. 근거가 없는
태그는 생성하지 않고 `confidence`가 낮은 태그는 핵심 순위 feature에서 제외한다.

### 3.4 배치 산출물

배치는 다음 산출물을 만든다.

```text
book index
  ├─ isbn13
  ├─ embedding
  ├─ tagCodes / tagScores / tagConfidence
  ├─ D4L demand features
  └─ embeddingVersion / tagVersion / featureVersion

quality report
  ├─ 전체 도서 수
  ├─ 임베딩 성공·실패 수
  ├─ 태그 생성·결측·저신뢰 수
  ├─ 관계·대출이력 결측률
  └─ 배치 inputHash
```

대용량 벡터와 원본 JSONL은 Git에 커밋하지 않는다. 배치 코드, 스키마, 작은 검증용
fixture, 집계 리포트만 저장소에서 관리한다.

## 4. 온라인 추천 요청 DTO

### 4.1 `RecommendationRequest`

```json
{
  "requestId": "req-20260908-001",
  "userId": "user-123",
  "mode": "PERSONALIZED",
  "size": 5,
  "seedIsbns": ["9788959772087"],
  "excludeIsbns": ["9788928318049"],
  "tags": [
    {"code": "FANTASY", "weight": 0.8},
    {"code": "GROWTH", "weight": 0.5}
  ],
  "weights": {
    "semantic": 0.45,
    "tagMatch": 0.25,
    "coLoan": 0.15,
    "trending": 0.10,
    "steady": 0.05
  }
}
```

| 필드 | 타입 | 필수 | 의미 |
| --- | --- | ---: | --- |
| `requestId` | `string` | O | 요청 추적·재시도 중복 방지 키 |
| `userId` | `string` | O | 추천 대상 사용자 |
| `mode` | `COLD_START \| PERSONALIZED` | O | 추천 모드 |
| `size` | `integer` |  | 기본 5, 최대 10 권장 |
| `seedIsbns` | `string[]` |  | 관심 기준 도서 ISBN13 |
| `excludeIsbns` | `string[]` |  | 서재·이미 본 책 등 제외 ISBN13 |
| `tags` | `TagPreference[]` |  | 사용자가 원하는 추천 방향 |
| `weights` | `RecommendationWeights` |  | 최종 재랭킹 가중치 |

`tags[].code`는 사전에 등록된 taxonomy만 허용한다. 알 수 없는 태그는 전체 요청을
실패시키기보다 무시하고 경고할지, 422로 거부할지는 백엔드와 추가 결정한다.

### 4.2 가중치

| 필드 | 의미 |
| --- | --- |
| `semantic` | seed·태그 query vector와 도서 vector의 유사도 |
| `tagMatch` | 사용자가 선택한 태그와 도서 태그의 일치도 |
| `coLoan` | D4L 함께대출 관계 |
| `trending` | 최신 대출 수요 |
| `steady` | 누적 대출량 기반 안정 수요 |

가중치 합계는 1.0으로 정규화하거나 서버에서 정규화한다. 특정 feature가 결측이면
가용한 feature만으로 재계산하며, 결측을 0점으로 오해하지 않는다.

## 5. 추천 계산 단계

### 5.1 Query vector 생성

- `seedIsbns`가 있으면 해당 도서 벡터를 평균·가중 평균한다.
- `tags`가 있으면 태그별 prototype vector를 가중 평균한다.
- seed와 태그 query를 mode와 요청 가중치에 따라 결합한다.
- seed와 태그가 모두 없으면 `COLD_START` 수요 추천으로 전환한다.

태그 prototype vector도 태그 생성 배치와 같은 `embeddingVersion`으로 관리한다. 매 요청
시 GMS를 호출하거나 임의의 자연어 문장을 생성하지 않는다.

### 5.2 후보 검색

Vector DB에서 query vector와 가까운 후보를 100~300개 검색한다. 다음은 하드 필터로
먼저 제거한다.

- `excludeIsbns`
- `seedIsbns`
- 색인에 없는 도서
- 운영 정책상 비활성화된 도서

### 5.3 후보 재랭킹

```text
finalScore =
  semantic  × semanticWeight
+ tagMatch  × tagMatchWeight
+ coLoan    × coLoanWeight
+ trending  × trendingWeight
+ steady    × steadyWeight
```

각 점수는 0~100으로 정규화한다. 이후 같은 ISBN·작품·저자 편중을 줄이는 다양성
보정을 적용하고 최종 상위 5개를 반환한다. Vector DB에서 바로 5개만 가져오지 않는
이유는 제외·중복·다양성 보정 후에도 충분한 후보를 확보하기 위해서다.

### 5.4 추천 이유

추천 이유는 실제로 점수에 기여한 feature를 기반으로 결정적 템플릿으로 만든다.

```text
TAG_MATCH       선택한 태그와 일치하는 책이에요.
SEMANTIC        관심 도서와 서지·분류 특성이 비슷한 책이에요.
CO_LOAN         관심 도서와 함께 대출된 책이에요.
TRENDING        최근 대출 수요가 높은 책이에요.
STEADY          꾸준히 대출된 책이에요.
```

여러 근거가 있으면 `reasons[]`로 모두 반환하고, 화면용 대표 이유는 `primaryReason`으로
반환하는 방식을 권장한다. LLM이 근거에 없는 설명을 생성하도록 하지 않는다.

## 6. 응답 DTO

```json
{
  "recommendationId": "rec-abc123",
  "requestId": "req-20260908-001",
  "userId": "user-123",
  "modelVersion": "d4l-hybrid-v1",
  "indexVersion": "d4l-2026-07-v1",
  "fallback": false,
  "items": [
    {
      "isbn13": "9788928318049",
      "rank": 1,
      "score": 92.14,
      "featureScores": {
        "semantic": 94.2,
        "tagMatch": 88.0,
        "coLoan": 80.0,
        "trending": 72.4,
        "steady": 65.1
      },
      "matchedTags": ["FANTASY", "GROWTH"],
      "primaryReason": {
        "type": "TAG_MATCH",
        "text": "선택한 태그와 일치하는 책이에요."
      },
      "reasons": [
        {"type": "TAG_MATCH", "text": "선택한 태그와 일치하는 책이에요."},
        {"type": "CO_LOAN", "text": "관심 도서와 함께 대출된 책이에요."}
      ]
    }
  ]
}
```

AI는 추천 대상 ISBN과 점수·근거를 반환하고, 백엔드는 ISBN13으로 canonical 도서 정보와
표지를 결합한다. 이렇게 하면 AI 색인과 백엔드 DB의 도서 표시 정보가 달라져도 정본이
백엔드에 유지된다.

## 7. 오류와 장애 처리

| 상황 | 처리 |
| --- | --- |
| 정상 요청 | `200`과 최대 5개 추천 반환 |
| DTO·가중치·ISBN 형식 오류 | `422` |
| seed·태그 없음 | `fallback = true`, trending/steady 기반 추천 |
| Vector DB timeout | FastAPI 오류, 백엔드가 마지막 성공 결과 또는 cold-start 사용 |
| 색인 버전 불일치 | 최신 활성 index로 처리하고 응답에 `indexVersion` 기록 |
| 후보 부족 | 가능한 개수만 반환하고 fallback 여부를 명시 |

추천 결과의 재현을 위해 `requestId`, `modelVersion`, `indexVersion`, `tagVersion`,
`featureVersion`을 로그와 결과에 남긴다.

## 8. 남은 결정 사항

1. Vector DB를 Qdrant와 pgvector 중 무엇으로 운영할지
2. 임베딩 모델·차원·quantization 설정
3. GMS 태그 생성 적용 범위와 비용·confidence 기준
4. 태그가 없는 도서의 처리와 알 수 없는 사용자 태그 정책
5. 응답의 `reasons[]`/`primaryReason` 구조와 프론트 공통 enum
6. 같은 작품을 식별할 `workKey`가 현재 데이터에 있는지, 없으면 ISBN 단위 diversity만
   적용할지
7. 백엔드 요청의 사용자 태그·가중치 저장 및 변경 시 추천 캐시 무효화 방식

## 9. 다음 구현 순서

1. `#131`: 실제 D4L 데이터 품질·대출 이력 의미 검증
2. `#132`: 고정 필드 정규화와 inputHash
3. 오프라인 임베딩 생성·Vector DB 색인
4. `#159`: 오프라인 태그 taxonomy·생성·매핑 배치
5. `#135`: Vector DB 후보 검색
6. `#136~#141`: feature 재랭킹·fallback·seed/태그 query·제외·다양성
7. `#143`: Spring Boot-FastAPI 통합 테스트
8. `#150`: 배치·FastAPI 실행·health check·배포 계약

이 문서가 합의되면 다음 실제 구현은 D4L 품질 검증 후 임베딩·태그 배치부터 시작한다.
