# 데이터 파이프라인 문서

추천 서비스의 도서 데이터를 수집·측정·결정한 기록이다.
**코드는 `database/_pipeline/` 에 있고 여기에는 문서만 둔다.**

<br/>

## 문서

| 문서 | 내용 |
| --- | --- |
| [WORK_STATE.md](WORK_STATE.md) | **재개 지점.** 지금 어디까지 왔고 다음이 뭔지. 먼저 읽을 것 |
| [RECOMMENDATION_DATA_DECISIONS.md](RECOMMENDATION_DATA_DECISIONS.md) | 아키텍처 결정 기록. 결정 → 실측 근거 → 기각한 대안 |
| [DATA_INVENTORY.md](DATA_INVENTORY.md) | 파일별 컬럼·타입·실측 채움율·조인 키 주의사항 |

관련 문서 — 저장소 밖 `project_personal/` :
`DATA_SOURCE_STRATEGY.md` (소스 전략), `COVERAGE_SIMULATION_SPEC.md` (측정 명세)

<br/>

## 코드 위치

```
database/_pipeline/
├── scripts/     수집·측정·정제 코드
└── reports/     스크립트가 생성한 산출물 (.txt, .csv) — 재생성 가능
```

주요 스크립트:

| 스크립트 | 역할 |
| --- | --- |
| `convert_nl_to_parquet.py` | 국중 JSONL 2.2GB → Parquet |
| `isbn_sql.py` | ISBN10/13 정규화 SQL 매크로 (자체 검증 포함) |
| `measure_baseline.py` | Phase 0 전수 기준선 측정 |
| `build_holdings_parquet.py` | 정보나루 샤드 → 보유 원장 Parquet 3종 |
| `recover_nl_url_text.py` | 국중 URL 텍스트 회수 (API 쿼터 무관) |
| `repair_url_text_csv.py` | 회수 CSV 복구 (손상 행 판별) |
| `clean_text_for_embedding.py` | 임베딩 입력용 텍스트 정제 |
| `pilot_kakao_coverage.py` | 카카오 보강 능력 층화 측정 |
| `pilot_data4library_coverage.py` | 정보나루 보강 능력 측정 |
| `analyze_nl_uncovered.py` | 대출 필터가 버리는 집합 분석 |

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
