# 데이터 파이프라인 문서

추천 서비스의 도서 데이터를 수집·측정·결정한 기록이다.
**코드는 `database/_pipeline/` 에 있고 여기에는 문서만 둔다.**

<br/>

## 문서

| 문서 | 내용 |
| --- | --- |
| [CATALOG_STATUS_REPORT.md](CATALOG_STATUS_REPORT.md) | **현황 보고서.** 외부 공유용 — 수집 현황·계획·성과·제약 한 장 요약 (HTML 판 동봉) |
| [RECSYS_ACCURACY_REPORT.md](RECSYS_ACCURACY_REPORT.md) | **추천 정확도 검증.** 임베딩 실험 + 실제 추천 결과 + 실패 원인 (HTML 판 동봉) |
| [EMBEDDING_EXPERIMENT_PROTOCOL.md](EMBEDDING_EXPERIMENT_PROTOCOL.md) | 위 실험의 사전 등록 프로토콜. 결과 보기 전 확정한 판정 규칙 |
| [WORK_STATE.md](WORK_STATE.md) | **재개 지점.** 지금 어디까지 왔고 다음이 뭔지. 먼저 읽을 것 |
| [RECOMMENDATION_DATA_DECISIONS.md](RECOMMENDATION_DATA_DECISIONS.md) | 아키텍처 결정 기록. 결정 → 실측 근거 → 기각한 대안 |
| [DATA_INVENTORY.md](DATA_INVENTORY.md) | 파일별 컬럼·타입·실측 채움율·조인 키 주의사항 |
| [SCRIPTS.md](SCRIPTS.md) | 스크립트 색인. 14개 전부 — 역할·실행 순서·박혀 있는 함정 |

관련 문서 — 저장소 밖 `project_personal/` :
`DATA_SOURCE_STRATEGY.md` (소스 전략), `COVERAGE_SIMULATION_SPEC.md` (측정 명세)

<br/>

## 코드 위치

```
database/_pipeline/
├── scripts/     수집·측정·정제 코드
└── reports/     스크립트가 생성한 산출물 (.txt, .csv) — 재생성 가능
```

스크립트별 설명은 [SCRIPTS.md](SCRIPTS.md) 에 있다.

<br/>

## 데이터 위치

대용량 데이터(약 5.5GB)는 **저장소 밖** `project_personal/` 에 있다.
파일 목록과 스키마는 [DATA_INVENTORY.md](DATA_INVENTORY.md) 참조.

<br/>

## 의존성

```bash
pip install duckdb
```

`_pipeline` 스크립트만 duckdb 를 쓴다. 기존 API별 수집기(`database/{API}/scripts/`)는
표준 라이브러리만 사용하며 이 의존성과 무관하다.
