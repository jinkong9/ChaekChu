# 데이터 위치와 요약

**갱신 2026-08-31**

모든 데이터는 **저장소 밖** `C:\Users\SSAFY\ygg\특화프로젝트\project_personal\` 에 있다.
저장소에는 코드와 문서만 둔다 (약 9GB, Git 에 넣을 수 없다).

컬럼 상세는 [DATA_INVENTORY.md](DATA_INVENTORY.md), 생성 스크립트는 [SCRIPTS.md](SCRIPTS.md) 참조.

<br/>

## 1. 서비스에 직접 쓰는 것

L1 추천 후보 1,082,390종을 만드는 데 실제로 들어가는 파일들이다.

| 파일 | 크기 | 내용 | 상태 |
| --- | ---: | --- | --- |
| `nl_books_enriched.parquet` | 327 MB | **국중 서지 마스터.** 2,047,239행 · 정규화 ISBN13 · KDC · 부가기호 · 회수 텍스트 병합본 | 완료 |
| `nl_text_clean.csv` | 595 MB | **국중 회수 텍스트(정제본).** 174,388행 — 목차 79,720 / 소개 74,694 / 요약 19,974. **목차의 유일한 출처** | 완료 |
| `data4library/d4l_usage.jsonl` | 120 MB | **정보나루 보강분.** 소개문 · 키워드 50개 · **함께대출 10건** · 마니아/다독자 추천 · 월별 대출이력 · 연령×성별 | **수집 중** |
| `kakao_enriched.jsonl` | 23 MB | **카카오 보강분.** 소개문 250자(줄거리 중심) · 표지 · 판매상태 · 정가 | 일시 중지 |
| `data4library/loans_by_isbn.parquet` | 25 MB | **ISBN 합산 대출.** 2,791,309종 · 누적 19.7억 건. 필터·랭킹·수집 우선순위의 근거 | 완료 |
| `data4library/enrich_queue.csv` | 36 MB | **수집 우선순위 큐.** 1,082,390행 (1단계 338,819 / 신간 148,328 / 꼬리 595,243) | 완료 |

<br/>

## 2. 분석·검증용 (서비스에는 직접 안 씀)

| 파일 | 크기 | 내용 |
| --- | ---: | --- |
| `data4library/holdings.parquet` | 673 MB | **보유 원장.** 1.21억 행 (관 × ISBN × 대출 × 권수) · 1,660개관 전수. 대출 임계 산출의 원천 |
| `data4library/libraries.parquet` | 0.1 MB | 도서관 마스터 (libCode · 위경도 · 지역) |
| `data4library/book_joined_sample.parquet` | 6 MB | 4개 소스 조인 검증용 표본 |

<br/>

## 3. 원본·중간 산출물 (재생성 가능)

| 파일 | 크기 | 비고 |
| --- | ---: | --- |
| `books_all_years.jsonl` | 2,250 MB | 국중 원본 JSONL. Parquet 변환의 입력 |
| `nl_books.parquet` | 275 MB | 원본 39컬럼 그대로 |
| `nl_books_derived.parquet` | 94 MB | 파생 컬럼 추가 (정규화 ISBN 등) |
| `nl_url_text.csv` | 621 MB | 회수 **원문**. 정제 규칙이 바뀌면 여기서 다시 만든다 |
| `data4library/shards/` | 2.85 GB | 정보나루 관별 CSV 1,660개. 보유 원장의 입력 |
| `data4library/snap_cache/` | 0.46 GB | 스냅샷 캐시 360개 |

<br/>

## 4. 정리 가능 (백업·구버전)

지워도 파이프라인에 지장이 없다. 합계 **약 788 MB**.

| 파일 | 크기 | 왜 남아 있나 |
| --- | ---: | --- |
| `nl_url_text.csv.corrupt` | 643 MB | 중복 프로세스 사고 때의 원본 백업. 복구 검증 완료 |
| `data4library/d4l_usage.jsonl.quota_bak` | 100 MB | 쿼터 오염 복구 전 백업. 복구 검증 완료 |
| `data4library/d4l_enriched.jsonl` | 18 MB | `srchDtlList` 시절 수집분. `d4l_usage.jsonl` 로 대체됨 |
| `data4library/enrich_queue.csv.old` | 26 MB | 국중 텍스트 보유분을 제외하던 구버전 큐 |
| `*.xlsx.csv` | 40 MB | 엑셀용 BOM 사본. 언제든 재생성 |
| `data4library/*_pilot_*.jsonl` | 1 MB | 파일럿 표본. 근거는 문서에 남아 있다 |

<br/>

## 5. 자격 증명

`project_personal/.env` — **gitignore 되어 있고 저장소에 없다.**

```
정보나루 · 정보나루2 · 정보나루3   각 일 3만 호출 (키별 스로틀 확인됨)
카카오                            일 약 3만 호출
구글북스 · 국중도                  현재 미사용
```

<br/>

## 6. 데이터 흐름

```
[국중]  books_all_years.jsonl
          │ convert_nl_to_parquet
          ▼  nl_books.parquet
          │ measure_baseline
          ▼  nl_books_derived.parquet
          │ recover_nl_url_text  →  nl_url_text.csv
          │ clean_text_for_embedding → nl_text_clean.csv  ← 목차·소개·요약
          │ merge_recovered_text
          ▼  nl_books_enriched.parquet ─┐
                                        │
[정보나루] shards/ 1,660개                │
          │ build_holdings_parquet      │
          ▼  holdings / loans_by_isbn ──┤
                                        │ build_enrich_queue
                                        ▼  enrich_queue.csv
                                        │
                     ┌──────────────────┴──────────────────┐
                     │ enrich_from_data4library            │ enrich_from_kakao
                     ▼  d4l_usage.jsonl                    ▼  kakao_enriched.jsonl
                     └──────────────────┬──────────────────┘
                                        ▼
                            L1 추천 후보 1,082,390종
                            (임베딩 · 협업필터링 입력)
```
