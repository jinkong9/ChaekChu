# AI 추천 구현 범위와 진행 순서

> 기준: ISBN 중복 제거가 완료된 D4L 도서 약 100만 건과
> [`AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](AI_FASTAPI_RECOMMENDATION_CONTRACT.md)

## 1. 핵심 방향

AI는 매 요청마다 전체 도서 데이터를 받지 않는다. 오프라인 배치로 도서 임베딩·통제된
태그·D4L 수요 feature를 생성하고 Vector DB에 색인한다. 백엔드는 온라인 요청마다
사용자의 `tags`, `weights`, `seedIsbns`, `excludeIsbns`를 FastAPI에 전달한다.

```text
D4L 100만 건
  → 필드 정규화
  → 임베딩 생성 + 태그 생성·매핑
  → Vector DB / metadata index
  → query vector 생성
  → ANN 후보 100~300개
  → feature 재랭킹·다양성 보정
  → 상위 5개 + 추천 이유
```

## 2. 데이터 경계

### 사용하는 입력

`isbn13`, `bookname`, `authors`, `publisher`, `pub_year`, `class_no`, `class_nm`,
`add_symbol`, `loan_total`, `co_loan`, `mania_rec`, `reader_rec`, `loan_history`

### 사용하지 않는 입력

- Git에 넣지 않는 대용량 원본 JSONL 자체
- 사용자 감상평, access token, 개인정보 원문
- 현재 원본에 보장되지 않는 description, keywords, embedding
- 온라인 요청 시 GMS LLM 호출

일부 원본 행의 `img`는 추천 feature가 아니므로 백엔드 화면 데이터로만 취급한다.

## 3. Jira별 AI 구현 범위

| Jira | 구현 내용 |
| --- | --- |
| #131 | D4L 필드·관계·대출이력 품질 검증과 통계 리포트 |
| #132 | 고정 필드 정규화, `inputHash`, feature 버전 관리 |
| #133 | 실제 관계 데이터 기반 P@5/R@10/coverage/diversity 평가 |
| #134 | ISBN 기준 중복 제거와 작품·저자 편중 완화 규칙 |
| #135 | Vector DB ANN 후보 검색과 seed/exclude 필터 |
| #136 | 100만 건 오프라인 임베딩 생성·재시작·실패 기록·색인 |
| #159 | 통제된 태그 taxonomy 생성·D4L 도서 태그 매핑·confidence 저장 |
| #137 | semantic·tagMatch·D4L feature 후보 재랭킹 |
| #138 | feature 결측 처리와 fallback |
| #139 | seed·태그가 없는 cold-start 수요 추천 |
| #140 | seed ISBN과 사용자 태그로 query vector 생성 |
| #141 | 사용자 가중치 적용, 제외, 다양성 보정, top-5 선택 |
| #142 | FastAPI 응답 DTO와 결정적 추천 이유 |
| #143 | Spring Boot-FastAPI 통합·timeout·5xx·ISBN 매핑 검증 |
| #150 | 배치·FastAPI 실행, health check, 배포·운영 계약 |
| #160 | Qdrant 활성 index·FastAPI 추천 엔진 runtime 연결 |
| #161 | 운영 임베딩 provider·대규모 index 생성 |
| #162 | GMS 태그 provider·대규모 배치 운영 검증 |
| #163 | 실데이터 추천 품질·가중치 튜닝 평가 |
| #164 | FastAPI 추천 동시성·장애 복구 검증 |
| #165 | 모델·태그·index 갱신 및 alias 롤백 runbook |
| #166 | 태그 sidecar 검증 및 임베딩 index payload 연동 |
| #167 | 태그 prototype 임베딩 생성·Qdrant collection 연동 |
| #168 | 실데이터 end-to-end 추천 smoke·태그 품질 검증 |

태그 생성·매핑은 #136과 분리된 오프라인 배치 단계로 관리한다. 필요하면 별도 Jira
하위 작업으로 나누며, 규칙 기반 태그와 GMS LLM 배치 태그를 `source`, `confidence`,
`tagVersion`으로 구분한다.

## 4. 추천 점수

```text
finalScore =
  semantic  × semanticWeight
+ tagMatch  × tagMatchWeight
+ coLoan    × coLoanWeight
+ trending  × trendingWeight
+ steady    × steadyWeight
```

임베딩은 의미적으로 가까운 후보를 찾는 데 사용하고, 함께대출·대출량·태그는 후보
재랭킹에 사용한다. 관계 데이터를 임베딩 문장에 섞어 의미 유사도로 오해하지 않는다.

## 5. 실행 순서

1. #131 데이터 품질 검증
2. #132 정규화·inputHash·버전 규칙
3. 임베딩 배치와 Vector DB 색인
4. #159 태그 taxonomy·생성·매핑 배치
5. #135~#141 검색·재랭킹·fallback 구현
6. #133 오프라인 평가와 기준선 비교
7. #143 백엔드 통합 테스트
8. #150 운영 배포

## 6. 공통 완료 기준

- 같은 입력·가중치·index version에서 같은 순위를 재현한다.
- 임베딩·태그·feature·index 버전을 결과와 리포트에 남긴다.
- 원본 데이터와 대용량 벡터는 Git에 커밋하지 않는다.
- 태그가 없거나 근거가 부족한 경우 임의로 생성하지 않고 결측으로 기록한다.
- 추천 이유는 실제 점수에 기여한 feature에서만 생성한다.
- P@5, R@10, coverage, diversity, p95 latency를 측정한다.
