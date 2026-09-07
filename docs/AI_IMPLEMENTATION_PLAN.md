# AI 추천 구현 계획

> B102 AI 담당자가 Jira `S15P21B102-129`부터 `S15P21B102-143`까지 구현할 때 따르는 기술 로드맵이다.
>
> 기준일: 2026-09-07

## 1. 목표와 범위

MVP의 AI는 별도 실시간 ML 서버가 아니라 **재현 가능한 Python 배치**로 동작한다.
도서 콘텐츠와 수요 데이터를 이용해 추천 후보를 미리 계산하고, 사용자 취향과 행동을
반영한 결과 스냅샷을 백엔드가 저장·조회한다.

포함 범위:

- 추천 입력 스키마 및 품질 검증
- 도서 작품·판본 그룹과 대표 도서 선정
- TF-IDF 어휘 후보와 multilingual-e5-large 밀집 후보
- 두 후보군의 Reciprocal Rank Fusion(RRF)
- 콜드스타트 및 행동 기반 개인화
- 설명용 태그·추천 이유·feature score 출력
- 오프라인 품질·결측·성능 평가와 백엔드 적재 계약

제외 범위:

- 실시간 모델 학습 또는 별도 모델 서빙 API
- 사용자 기반 협업 필터링
- 감상평 원문을 이용한 추천·임베딩
- Kafka 등 분산 이벤트 처리 인프라

## 2. 기준 문서

- 실행 방법: [`ai/README.md`](../ai/README.md)
- 전체 업무 순서: [`BE_AI_CICD_WORK_CHECKLIST.md`](BE_AI_CICD_WORK_CHECKLIST.md)
- 데이터·추천 정책: [`RECOMMENDATION_SERVICE_DIRECTION.md`](RECOMMENDATION_SERVICE_DIRECTION.md)
- 백엔드 입출력 계약: [`BACKEND_DATA_CONTRACT.md`](BACKEND_DATA_CONTRACT.md)
- 수집 데이터 위치와 스키마: [`pipeline/DATA_INVENTORY.md`](pipeline/DATA_INVENTORY.md)
- 기존 임베딩 실험: [`pipeline/EMBEDDING_EXPERIMENT_PROTOCOL.md`](pipeline/EMBEDDING_EXPERIMENT_PROTOCOL.md)

문서 간 내용이 다르면 `BACKEND_DATA_CONTRACT.md`의 공개 계약을 우선하고, 알고리즘
내부 결정은 이 문서를 갱신한 뒤 변경한다.

## 3. 실행 구조

```text
database 원천·정제 산출물
        │
        ▼
입력 검증·L1 후보·수요 feature        #130, #131
        │
        ├─ STRUCT 텍스트·inputHash     #132
        └─ 작품·판본 그룹              #134
        │
        ├─ TF-IDF 후보                 #135
        └─ e5 임베딩 → dense top-K     #136, #137
                    │
                    ▼
                RRF 융합               #138
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
콜드스타트 추천 #139       행동 프로필·개인화 #140, #141
        └───────────┬────────────┘
                    ▼
태그·이유·스냅샷 출력               #142
                    │
                    ▼
백엔드 적재·조회 및 통합 평가        #36, #35, #143
```

추천 실행은 `build`, `evaluate`, `recommend` 세 CLI를 유지한다.

- `build`: 입력 검증부터 후보·feature·벡터·인덱스 산출까지 수행한다.
- `evaluate`: 고정 fixture와 기준선으로 품질·결측·성능을 측정한다.
- `recommend`: 사용자 또는 세그먼트 입력으로 추천 스냅샷을 생성한다.

## 4. 권장 패키지 구조

```text
ai/
├─ config/                 환경별 비밀값 없는 설정
├─ src/recommendation/
│  ├─ cli.py               CLI 파싱과 실행 경계
│  ├─ config.py            설정 검증
│  ├─ runtime.py           seed·로그·결정적 출력
│  ├─ schema/              입력·출력 모델과 검증
│  ├─ features/            L1, 수요, STRUCT, 태그
│  ├─ catalog/             작품·판본 그룹
│  ├─ retrieval/           TF-IDF, e5, dense, RRF
│  ├─ personalization/     콜드스타트·행동 프로필·재정렬
│  ├─ evaluation/          fixture와 평가 지표
│  └─ io/                  파일·DB 입출력 어댑터
├─ tests/
│  ├─ fixtures/            작고 고정된 공개 가능 테스트 데이터
│  ├─ unit/
│  └─ integration/
└─ output/                 재생성 가능한 로컬 산출물, Git 제외
```

수집 코드인 `database/_pipeline`은 원천 데이터를 만드는 역할만 유지한다. 추천 코드가
수집 스크립트를 직접 import하지 않도록 파일·테이블 계약을 경계로 분리한다.

## 5. 구현 단계와 Jira 순서

### 단계 A — 실행·입력 계약

1. `#129` Python 3.12 패키지·설정·CLI — 완료
2. `#130` 입력 스키마·결측 검증기 — 다음 작업
3. `#131` L1 후보·수요 feature 배치
4. `#132` STRUCT 텍스트·inputHash
5. `#134` 작품·판본 그룹
6. `#133` 오프라인 fixture·P@10·R@50 기준선

`#132`, `#134`, `#133`은 `#130` 이후 병렬로 진행할 수 있다.

### 단계 B — 후보 검색

7. `#135` TF-IDF 어휘 후보
8. `#136` multilingual-e5-large 임베딩
9. `#137` dense top-K 검색
10. `#138` RRF 융합과 결측 폴백

`#135`와 `#136`은 병렬 가능하다. RRF는 각 후보의 원점수를 직접 비교하지 않고
순위만 결합한다. 기본식은 다음과 같다.

```text
rrfScore(item) = Σ 1 / (k + rank_source(item))
```

초기 `k`는 60으로 두되 설정값으로 관리하고 평가 결과 없이 임의 조정하지 않는다.

### 단계 C — 개인화와 결과 계약

11. `#139` 세그먼트·초기 취향 콜드스타트
12. `#140` 사용자 행동 신호·취향 프로필
13. `#141` 개인화 블렌딩·제외·다양성 정렬
14. `#142` 추천 태그·이유·스냅샷 출력
15. `#143` 품질·결측·성능 회귀 및 백엔드 통합 검증

행동 신호의 초기 우선순위는 높은 평점, 읽음, WISH, 상세 조회 순으로 둔다.
정확한 가중치는 설정에 두고 스냅샷의 `weights`에 함께 기록한다.

## 6. 입력 계약

`#130`에서 최소한 다음 논리 엔터티를 검증한다. 실제 파일 컬럼은 데이터 계약에 맞춰
매핑할 수 있지만 추천 내부의 표준 이름은 고정한다.

| 엔터티 | 필수 식별자 | 주요 필드 | 핵심 검증 |
| --- | --- | --- | --- |
| Book | `bookId`, `isbn13` | title, author, publisher, category, description | 식별자 unique, ISBN 형식, 빈 제목 차단 |
| DemandFeature | `bookId`, `baseMonth` | trending, steady, newField | 유한한 수, 기준월·산출 버전 필수 |
| UserInterest | `userId`, `interestCode` | weight | 사용자 내 중복 차단, 음수 금지 |
| UserBehavior | `userId`, `bookId` | eventType, rating, occurredAt | 허용 이벤트, 평점 1~5, UTC 시각 |
| WorkGroup | `bookId`, `workId` | representative | 작품당 대표 도서 하나 |

검증 실패는 일부 행을 조용히 버리지 않는다. 오류 보고서에 규칙, 행 식별자, 오류
건수와 제한된 예시를 남기고 비밀값·감상평 원문은 기록하지 않는다.

## 7. 콘텐츠 표현과 후보 생성

STRUCT 텍스트의 필드 순서는 고정한다.

```text
제목: {title}
저자: {author}
카테고리: {category}
키워드: {controlledKeywords}
소개: {description}
목차: {tableOfContents}
```

- 결측 필드는 빈 라인을 만들지 않고 생략한다.
- 같은 정규화 입력은 같은 `inputHash`를 생성한다.
- TF-IDF와 임베딩 모두 동일한 작품의 다른 판본과 자기 자신을 후보에서 제외한다.
- 텍스트가 부족하면 콘텐츠 점수만 결측 처리하고 수요 기반 후보에서 삭제하지 않는다.
- 모델명, 모델 revision, 전처리 버전과 입력 해시를 산출물 metadata에 기록한다.

## 8. 개인화·제외·다양성

최종 점수는 각 feature를 0~100으로 정규화한 뒤 결측 feature의 가중치를 분모에서
제외해 계산한다. 초기 기준은 다음과 같다.

| feature | 초기 가중치 |
| --- | ---: |
| taste | 60 |
| trending | 15 |
| steady | 10 |
| newField | 15 |
| coLoan | 0 |

필수 후처리 순서:

1. 자기 자신과 동일 작품 판본 제거
2. 사용자의 WISH·READING·READ 도서 제거
3. 점수 내림차순 정렬과 결정적 tie-break
4. 동일 시리즈·저자·카테고리 과점 제한
5. 결과 부족 시 콜드스타트 후보로 충원
6. rank, featureScores, tags, reasonType, reasonText 생성

## 9. 출력·백엔드 적재 계약

추천 산출물은 최소 다음 정보를 포함한다.

```json
{
  "schemaVersion": 1,
  "artifactHash": "...",
  "inputHash": "...",
  "modelVersion": "...",
  "userId": "...",
  "mode": "COLD_START",
  "weights": {},
  "items": [
    {
      "bookId": "...",
      "rank": 1,
      "score": 0.0,
      "featureScores": {},
      "tags": [],
      "reasonType": "...",
      "reasonText": "..."
    }
  ]
}
```

- 산출물에는 실행 시각이나 절대 경로처럼 재현성을 깨는 값을 넣지 않는다.
- 실제 적재 실행의 시작·종료 시각은 별도 실행 metadata에서 관리한다.
- 백엔드는 전체 실행이 성공한 결과만 원자적으로 최신 스냅샷으로 전환한다.
- 실패하면 마지막 성공 결과 또는 콜드스타트를 사용한다.

## 10. 평가와 품질 게이트

주 지표:

- `Precision@10`: 상위 10개 중 정답으로 판단한 추천 비율
- `Recall@50`: 정답 후보 중 상위 50개가 회수한 비율

함께 기록할 운영 지표:

- 입력·출력 건수와 탈락 사유
- 텍스트·수요 feature 결측률
- 작품·시리즈 중복률
- 사용자당 추천 결과 부족률
- 단계별 처리 시간과 최대 메모리
- 동일 입력 재실행 시 산출물 해시 일치 여부

기준선보다 낮아진 변경은 원인과 승인 없이 병합하지 않는다. fixture는 작고 고정하며
개인정보나 외부 API 비밀값을 포함하지 않는다.

## 11. 작업별 완료 기준

각 AI Jira 작업은 다음 조건을 모두 만족해야 완료한다.

- CLI 또는 패키지 공개 인터페이스가 문서화되어 있다.
- 정상·경계·결측·잘못된 입력 테스트가 있다.
- 같은 seed와 입력으로 동일 결과를 만든다.
- 입력·모델·설정 버전이 산출물에 남는다.
- 로그에 비밀값·개인정보·감상평 원문이 없다.
- 대용량 데이터와 생성 산출물을 Git에 커밋하지 않는다.
- `uv run pytest`와 영향 범위 통합 테스트가 통과한다.
- Jira에 브랜치, 커밋, 테스트 결과와 다음 작업 인계 사항을 남긴다.

## 12. 미확정 사항 관리

다음 값은 코드 상수가 아니라 설정과 평가 기록으로 관리한다.

- RRF `k` 및 후보 소스별 가중치
- 행동 유형별 가중치와 최근성 감쇠
- 행동이 충분하다고 판단하는 개인화 전환 임계값
- 저자·카테고리·시리즈 다양성 상한
- 모델 캐시 위치와 배치 크기

값을 변경할 때는 fixture 기준 전후 지표, 변경 이유와 `modelVersion`을 함께 기록한다.
