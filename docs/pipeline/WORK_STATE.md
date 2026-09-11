# 작업 상태 (재개 지점)

갱신 2026-09-11 · 수집 전부 종료(정보나루 09-09 · 카카오 09-10) · 서비스 DB V1·V2 적재 완료 · 임베딩 진행 중(Qdrant)

> **09-11 정정 — 벡터 저장소는 Qdrant 로 굳었다.** 아래 「ES dense_vector 권고 · Qdrant 보류」와 「e5-large 1024d」는 09-10 시점의 계획이고,
> 실제로 돌아가는 것은 08-31 운영안(`EMBEDDING_QDRANT_OPERATING_PLAN.md`) 쪽이다. EC2 확인 결과:
> Qdrant 가 `--profile recsys` 로 떠 있고 `books_active` → `books_a54692a523124274` 에 **1만 권 · 1536차원**(`text-embedding-3-small`).
> 적재는 `ai/src/recommendation/embedding_batch.py`, 검색은 `vector_search.py` 의 `QdrantVectorIndex` 가 한다.
> 이에 맞춰 쓰이지 않던 `book_embeddings` 표를 **V4 로 제거**했다. 모델·차원 확정과 나머지 적재는 임베딩 담당의 몫으로 남아 있다.

이전 판(08-27, 파일럿 28,714건 기준)의 수치는 모두 폐기했다. 아래는 전량 수집 뒤 실측이다.

<br/>

## 1. 지금 어디까지 왔나

```
[완료] 국중 전수 기준선 · 정보나루 1,660개관 원장(1.4억 행, 13컬럼) · 랭킹 신호(결정 3)
[완료] 정보나루 usageAnalysisList 보강 — L1 1,098,550 큐 100% (고유 ISBN 1,098,623)   09-09 03:15 완주, 수집기 중지·비활성화
[완료] 카카오 보강 — 큐 1,098,550 중 1,098,549 (고유 1,098,651 · 매칭 79.9%)   09-10 09:40 완주, 타이머 disable · backup·heartbeat cron 제거
[완료] 임베딩 모델·입력 연구 — e5-large + STRUCT · 어휘 主 · 벡터 1개          EMBEDDING_STUDY_REPORT.md
[완료] MVP ERD 확정 — V1 (1차 ERDCloud 10테이블 + 보정) · V2 확장 예정           DB_TABLE_DESIGN.md · sql/V1__init.sql
[완료] 스냅샷 확정 — snapshots/2026-09-10 (EC2·로컬 동일, SHA256 · d4l·queue 는 09-09 와 같은 파일, kakao 만 완주본)
[완료] V1 적재 — books 3,312,467 · book_tags 2,023,895 · book_loaned_top20 1,200   로컬 · EC2 둘 다 (09-09) → books 는 09-10 카카오 완주본으로 upsert
[완료] V2 스키마 — V2__recommendation_layer.sql, Flyway CLI 로 로컬·EC2 적용 (09-09 14:40). book_texts 는 books 컬럼 3개로 흡수
[완료] V2 적재 — kdc_codes 949 · book_keywords 8,784,823 · book_relations 13,699,166 (대상 연결 99.5~99.9%) · book_demand_features 2,749,303   로컬 · EC2 (09-09 16:40)
[진행] 임베딩 → Qdrant `books_active` (09-11 1만 권 / 1단계 34만 목표) · ES 는 BM25(nori) 어휘 색인만 — `book_embeddings` 표는 V4 로 제거
```

<br/>

## 2. 확정된 스펙

```
L0 카탈로그   원장 295만 ∪ 국중만 74만(전자책 제외)  → books 3,312,467 (ISBN 체크섬 검증 후)   ← L1 으로 대체될 수 있음 (--scope 스위치)
L1 추천 후보  누적 대출 72+ (수요 99%) ∪ 2025+ 신간 = 1,098,550   tier 1 (940+) 343,399 · tier 2 신간 147,729 · tier 3 607,422
랭킹         직전 2년 차분 + 4 × 3개월 모멘텀 (누적은 필터·prior 전용)
임베딩       (연구 결론) multilingual-e5-large 1024d · STRUCT 1벡터 · 창 512 · int8 양자화(손실 0.13%p)
             ↳ 실제 운용은 text-embedding-3-small 1536d (EMBEDDING_MODEL). 둘 중 무엇으로 갈지는 임베딩 담당 확정 대기
추천 구조     어휘 색인(BM25/tsvector) 主 ‖ 밀집 從 → 역순위 융합 → work_key 작품 묶기 → 텍스트 결측 책만 독자대상·KDC 재정렬
근처 도서관    MVP 배제 (원장은 카탈로그·인기 지표 원천으로만)
벡터 저장소    Qdrant (09-11 확정 — EC2 에서 --profile recsys 로 가동 중). ES 는 어휘 색인 담당
```

근거: [RECOMMENDATION_DATA_DECISIONS.md](RECOMMENDATION_DATA_DECISIONS.md) · [EMBEDDING_STUDY_REPORT.md](EMBEDDING_STUDY_REPORT.md)

<br/>

## 3. 실측 커버리지 (전량 수집 후 · 카카오 완주본으로 09-10 재계산)

| 단계 | 큐 | 정보나루 소개 60자+ | 카카오 소개 60자+ | 하나라도 | 둘 다 없음 | 키워드 | 함께대출 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1단계 | 343,399 | 86.7% | 68.0% | **87.9%** | 12.1% | 48.2% | **82.9%** |
| 2단계 신간 | 147,729 | 54.9% | 62.2% | 67.4% | 32.6% | 1.7% | 13.0% |
| 3단계 | 607,422 | 70.0% | 48.2% | 71.4% | 28.6% | 3.5% | 40.3% |
| L1 전체 | 1,098,550 | 73.2% | 56.3% | **76.0%** | 24.0% | 17.3% | 50.0% |

소개 없는 책(L1 24.0% = 26.4만 권, 1단계는 12.1% = 4.2만 권)의 70% 는 서점 비유통 전집 낱권(카카오 미매칭 ×35) — 형제 권 소개 빌려오기로 1단계 16% 회복, 나머지는 서지 임베딩.
키워드·함께대출은 **1단계 전용 신호**. 2·3단계 65만 권은 임베딩이 거의 유일한 신호. (EMBEDDING_STUDY_REPORT §3.3)

<br/>

## 4. 데이터 위치

**스냅샷 = 한 벌, 두 곳에 같은 것.** 이후 모든 빌드는 스냅샷만 읽는다 (수집 파일 직접 참조 금지).

| 위치 | 내용 |
| --- | --- |
| EC2 `~/pipeline_data/snapshots/2026-09-10/` | `d4l_usage.jsonl.gz` 615M(09-09 와 같은 파일) · `kakao_enriched.jsonl.gz` 222M(완주) · `enrich_queue.csv` · `SHA256SUMS` · `make.log` — **현재 기준** |
| 로컬 `project_personal/snapshots/2026-09-10/` | 위와 동일 (체크섬 확인). `2026-09-09/` 는 첫 적재 기록용으로 남김 |
| 로컬 `project_personal/data4library/` | `books_dedup.parquet` 160M(원장 295만 종) · `holdings_full.parquet` 5G(도서관×ISBN, 서비스 미사용) · `segment_popular_202608.jsonl`(정보나루 loanItemSrch 12세그먼트) |
| 로컬 `project_personal/nl_books_enriched.parquet` | 국중 서지·부가기호·회수 텍스트 |
| 로컬 `project_personal/load/` | `books.csv.gz` 432M(V2 컬럼 포함) · `book_tags.csv.gz` 7M · `book_loaned_top20.csv` · V2 4종 · `build_manifest.json`(입력 SHA·통계) |
| EC2 `~/load/` | 위 적재 파일 사본 + `load_service_tables.sh` |
| EC2 `~/backups/` | 수집 파일 세대 백업 (KEEP=5) — 스냅샷 확정 뒤 정리 대상 |

09-10 `books` upsert 결과: 소개 989,078 → 992,226(카카오 12,579 → 15,777 · 형제 174,720 → 174,670) · 표지 883,615 → 885,156. 남은 19% 가 3단계였고 카카오 소개는 정보나루 소개가 없을 때만 쓰므로 증가폭이 작다.

<br/>

## 5. 적재 절차 (재현)

```
# 1 스냅샷 (EC2)      gzip -1 d4l·kakao → snapshots/<날짜>/ + sha256sum → scp -r 로컬
# 2 세그먼트 인기      py scripts/fetch_segment_popular.py                      → load/book_loaned_top20.csv   (정보나루 12호출)
# 3 빌드 (로컬)        py scripts/build_service_tables.py --snapshot snapshots/<날짜> --scope L0   → load/books.csv.gz · book_tags.csv.gz  (약 9분)
# 4 적재 (로컬)        PG_CONTAINER=b102-postgres-local bash scripts/load_service_tables.sh project_personal/load   (books 3분 · tags 2분)
# 5 적재 (EC2)         scp load/* → ~/load/ ; bash ~/load/load_service_tables.sh ~/load                             (books 4분 · tags 3분)
```
스키마는 백엔드 Flyway(V1__init · V1_1__seed_tags)가 만든다. 로더는 upsert 라 재실행 가능. 자세한 것은 [SCRIPTS.md](SCRIPTS.md).

<br/>

## 6. 다음 작업

1. **임베딩** — 1단계 34만 권 STRUCT(제목/저자/분류/키워드 30/소개 둘) → **Qdrant `books_active`**. 09-11 기준 1만 권(0.3%)이라 `GET /books/{id}/similar` 은 아직 열 수 없다. 적재분 관리는 `ndjson` 작업 파일(08-31 운영안 §7.3)
2. **ES 색인** — `books` BM25(nori: 제목·저자·출판사·`book_keywords`·소개 둘) + `dense_vector` int8_hnsw. 컨테이너 상한 4G → 5G
3. **`book_demand_features` 다음 달** — 10월 원장 스냅샷이 오면 `loan_24m`·`trending_score`·`steady_score` 계산 시작(결정 3). 지금은 누적·3/12개월·소장관만
4. `ai/` 서비스에 스냅샷 경로 연결 (`d4l-usage-v1` 계약 validate) — 또는 DB(`book_relations` 등)를 읽도록 전환 여부 결정

<br/>

## 7. 미해결 / 보류

| 항목 | 상태 |
| --- | --- |
| `books` 범위 | L0 서지 3.3M 으로 적재. **L1 으로 대체될 수 있음** — `--scope L1` 으로 재빌드하면 1,047,435 행 |
| L1 중 books 에 없는 51,115 ISBN | 국중 전자책(신간 트랙, 제외 결정) + 체크섬 불일치. 추천 후보에서도 빠진다 |
| `book_tags` 채우는 주체 | KDC 접두 규칙(`KDC_TAGS`)으로 배치가 채움. 09-09 표본 감사로 51x 의학·52x·59x·69x 스포츠·37x 교육·388·896 제외(40만 행 삭제). 태그 없는 KDC 구간은 비워 둠 |
| 형제 권 소개(SIBLING) 174,720 | 저자 토큰 일치 160,802 + 어간 6자 이상 13,918. 일반명 교과서 오결합은 차단했지만 완벽하지 않음 — `description_source='SIBLING'` 으로 구분 가능 |
| `book_loaned_top20` 원천 | 프론트 시안의 `segment_popular_500.json` 은 없었다 → `fetch_segment_popular.py` 로 재수집(월 1회). 창 06-01~08-31, 동률 순위는 재부여 |
| ~~벡터 저장소~~ | **해소(09-11)** — Qdrant. EC2 가동 확인, `book_embeddings` 는 V4 로 제거 |
| 임베딩 모델·차원 | 연구는 e5-large 1024d, 운용은 text-embedding-3-small 1536d. 하나로 정해 문서에 적을 것 |
| 정보나루 재수집 | 하지 않음. 함께대출 목록 갱신이 필요하면 1단계만 하루 |
| Windows CSV(CRLF) | `\copy` 종료 줄과 섞이면 실패 — 로더가 `tr -d '\r'` 로 정규화 |

<br/>

## 8. 반복된 사고와 교훈 (누적)

- **HTTP 429 는 쿼터가 아니라 초당 제한** — 카카오 수집기가 429 를 키 소진으로 오판해 키 5개를 40초 만에 은퇴시켰다(키마다 3만이 남아 있었다). 상태 코드 하나로 「하루 끝」을 판정하지 말고, 0 호출에 소진이 뜨면 의심할 것 (09-10)
- **`py` 런처와 `python` 은 다른 인터프리터일 수 있다** — duckdb 는 3.11 에만 있다. 빌드는 `python`(3.11) 으로 (09-10)
- **Python UDF 를 DuckDB 에 행 단위로 걸지 말 것** — 350만 행에서 단일 스레드 30분+ 미완. SQL 매크로로 바꾸면 4분 (09-09)
- **psql heredoc 과 파이프를 같이 쓰면 heredoc 이 stdin 을 차지한다** — `\copy from stdin` 이 SQL 줄을 데이터로 읽었다. stdin 하나에 SQL→데이터→`\.`→SQL 순서로 흘릴 것
- **API 순위에는 동률이 있다** — UNIQUE(세그먼트, 순위) 에 걸린다. 조인 뒤 row_number 로 재부여
- **원장 ISBN 에 체크섬 틀린 자리표시 값(9780000000000 류)이 10만 건** — 접두·길이만 보지 말고 체크섬을 검증할 것
- **역할어 목록은 실데이터로 확인** — 「지음」이 빠져 「한강 지음」이 저자로 들어갔다
- **Docker Desktop stale 소켓** — `Docker\run` · `docker-secrets-engine` 폴더 rename (메모리 docker-desktop-stale-socket-fix)
- 쿼터 소진이 '데이터 없음' 으로 위장한다 · 프로세스 생존은 출력 파일 증가량으로 · 로그는 저장소 밖에 · 네트워크 예외는 `OSError` 까지 (08-27~09-03 누적, 상세는 git 이력)
