# 도서 임베딩·Qdrant 운영안

> 기준일: 2026-08-31
> 범위: 수집 완료 후의 **오프라인 도서 임베딩·유사도 후보 검색**. 가입 직후 콜드스타트 추천은 이 문서의 벡터 파이프라인과 분리한다.

## 1. 결정 요약

- 원본 서지·텍스트·태그·대출 파생 점수·추천 결과의 기준 저장소는 PostgreSQL이다.
- Qdrant는 **의미 유사도 검색용 도서 벡터와 최소 필터 payload**만 저장한다.
- GMS OpenAI가 OpenAI Batch API를 지원하지 않으므로, `text-embedding-3-small` 일반 Embeddings API를 자체 체크포인트 스크립트로 호출한다. 서비스 요청 중 임베딩 호출은 하지 않는다.
- 임베딩 차원은 지금 확정하지 않는다. 3만 권 평가셋에서 512와 768을 비교한 뒤, 한 컬렉션에는 한 차원만 사용한다. 추천 후보가 약 100만 권이라면 768차원 float16도 운영 가능 범위다.
- 별도 `book_embeddings`, `embedding_jobs`, `embedding_status`, `user_embeddings` 테이블은 만들지 않는다. 벡터 적재 성공·실패는 오프라인 작업 파일로 관리한다.
- 단, 출처와 유형이 다른 소개·목차·요약을 보존하기 위한 `book_text_documents`와, 정보나루 관계 신호를 행으로 푸는 `book_relation_edges`는 ERD에 추가한다.

```text
수집·정규화 완료
  → 출처별 텍스트 보존 및 정제
  → 책별 임베딩 문장 조립
  → GMS OpenAI 일반 Embeddings API 호출
  → Qdrant bulk upsert
  → Qdrant 후보 검색 + PostgreSQL 재정렬
```

## 2. 텍스트 원천과 정제 원칙

### 2.1 출처별 역할

| 원천 | 특성 | 임베딩에서의 역할 |
| --- | --- | --- |
| 정보나루 `desc` | 범위가 넓고, 현재 수집분 중 `desc_len >= 100` 비율이 높음 | 기본 소개문 후보 |
| 국립중앙도서관 `BOOK_INTRODUCTION`, `BOOK_SUMMARY` | 결측은 크지만 값이 있으면 내용이 풍부할 수 있음 | 소개문 보강 또는 대체 |
| 국립중앙도서관 `BOOK_TB_CNT` 및 URL 회수 목차 | 장·절 제목이 세부 소재를 드러낼 수 있음 | 소개문 보강 |
| 정보나루 `keywords` | 저자·출판사·제목 같은 서지어가 섞일 수 있음 | 태그 근거 및 임베딩 보조 재료 |
| 제목·저자·KDC/분류명 | 거의 모든 책에 존재하는 맥락 | 모든 임베딩 문장의 공통 접두사 |

출처 자체에 고정 우선순위를 두지 않는다. 책별로 정제 후 텍스트 품질을 판단하고, 중복되지 않는 가장 좋은 소개문과 목차를 조합한다. `books.description` 하나에 서로 다른 출처 텍스트를 덮어쓰지 않는다.

### 2.2 목차 정제

목차 원문을 그대로 임베딩하면 장·절 번호와 쪽수가 의미보다 강하게 반복된다. 번호와 쪽수는 제거하되, 장·절의 **제목**은 보존한다.

```text
원본
제1장 낯선 세계 ........ 10p
1.1 마법사의 등장 ...... 24
1.2 첫 번째 모험 ....... 38
부록 .................... 301

임베딩용 정제 결과
낯선 세계 · 마법사의 등장 · 첫 번째 모험
```

정제 규칙은 다음과 같다.

- 줄 시작의 `제1장`, `1.`, `1.1`, `Ⅰ.` 등 구조 번호를 제거한다.
- 줄 끝의 `100`, `100p`, `… 100` 같은 쪽수 표현을 제거한다.
- `목차`, `찾아보기`, `참고문헌`, 단독 `부록` 같은 구조성 항목은 제외하거나 낮은 비중으로 둔다.
- 동일한 제목을 중복 제거한다.
- `1984`, `100가지 질문`처럼 제목 자체의 숫자는 제거하지 않는다. 줄 시작의 번호 또는 줄 끝의 쪽수 패턴일 때만 제거한다.

`desc_len`이 아니라 **정제 후 의미 있는 텍스트 길이**로 임베딩 적합성을 판정한다. 목차만 길어도 대부분이 번호·쪽수라면 풍부한 텍스트로 취급하지 않는다.

### 2.3 임베딩 대상과 입력 문장

| 상태 | 판정 기준 | 처리 |
| --- | --- | --- |
| `TEXT_RICH` | 정제한 소개문이 충분하거나, 소개문과 목차를 합쳐 의미 있는 내용이 충분함 | Qdrant 정식 임베딩 대상 |
| `TEXT_SHORT` | 소개가 짧지만 제목·저자·분류·정제 목차 또는 키워드가 있음 | 보조 임베딩 대상. 추천 재정렬에서 낮은 신뢰도로 취급 |
| `TEXT_NONE` | 의미 있는 소개·목차·키워드가 없음 | Qdrant 제외. KDC·태그·인기도 기반 추천에만 참여 |

임베딩 문장은 원본 JSON 전체가 아니라 아래 필드만 같은 순서로 조립한다.

```text
제목: {title}
저자: {authors}
분류: {KDC 한글 분류 또는 class_nm}
카테고리: {categories}
책소개: {선택된 정제 소개문}
목차: {정제 목차}
핵심어: {서지어 제거 후 남은 키워드}
```

- HTML, URL, 광고 문구, 빈 필드를 제거한다.
- 소개문이 지나치게 길면 토큰 상한 안에서 자른다.
- 소개문과 목차가 사실상 같은 내용이면 하나만 사용한다.
- 키워드를 여러 번 반복해 임베딩 가중치를 주지 않는다.

## 3. 임베딩과 태그 추출의 역할 분리

`text-embedding-3-small`은 책의 의미 유사도를 위한 벡터를 만든다. 빈도수나 반복 키워드만으로 임베딩 방식을 바꾸지 않는다.

| 신호 | 사용처 |
| --- | --- |
| 소개·목차·제목·분류의 문맥 | Qdrant 유사도 검색 벡터 |
| 책 내부의 반복 키워드 | 소재 태그의 보조 근거 |
| 코퍼스 전체 빈도 | 너무 흔한 단어 제거용 TF-IDF/IDF |
| 정보나루 키워드와 API weight | 태그 점수 보조 근거 |
| KDC·SUBJECT·부가기호 | 분류 태그 생성 및 장르 태그 제약 |

태그 점수는 아래 세 신호를 결합해 `book_content_features`와 `book_tags`에 저장한다. 구체적인 가중치는 골드셋 평가 전에는 고정하지 않는다.

```text
태그 점수
= 태그 앵커와의 임베딩 의미 유사도
+ 키워드 근거
+ KDC·주제코드 제약 또는 보강
```

소개문이 없는 책의 태그 점수는 억지로 0으로 채우지 않는다. 판단 불가 태그는 `null`로 두고, 해당 축을 제외한 분류·인기도·신간 후보 추천에는 계속 참여시킨다.

## 4. 오프라인 임베딩·Qdrant 적재

### 4.1 실행 절차

```text
1. 수집 데이터의 v1 기준 시점을 고정한다.
2. TEXT_RICH와 TEXT_SHORT 책의 임베딩 문장을 만든다.
3. embedding_input_v1.ndjson을 생성한다.
4. GMS OpenAI 일반 Embeddings API를 제공 한도에 맞는 작은 묶음으로 호출한다.
5. 응답 차원·순서·누락을 검증한다.
6. 성공 벡터를 Qdrant에 bulk upsert한다.
7. 실패 도서만 별도 파일로 남기고 재시도한다.
8. 입력 수, 성공 수, Qdrant point 수를 대조한다.
```

GMS가 여러 입력을 한 요청에 허용하면 20~100권 범위에서 실제 제한과 오류율을 보고 묶음 크기를 정한다. 다중 입력을 지원하지 않으면 권당 요청으로 낮추되, 같은 체크포인트 구조를 유지한다.

```text
embedding_input_v1.ndjson   # book_id, source_text_hash, 임베딩용 문장
embedded_ids_v1.ndjson      # Qdrant 저장 성공 book_id
failed_ids_v1.ndjson        # 재시도 대상 book_id와 오류 사유
```

실시간 임베딩이나 자동 증분 처리는 이번 범위에 없다. 이후 소개문이 충분히 보강됐을 때만 새 입력 파일과 `v2` 컬렉션을 만들어 다시 적재한다.

### 4.2 Qdrant 컬렉션과 payload

```yaml
collection: book_content_v1
vector name: content
model: text-embedding-3-small
dimension: 512 또는 768  # 3만 권 평가 후 하나로 확정
distance: Cosine
datatype: float16
```

```json
{
  "id": "books.id",
  "vector": { "content": ["선택된 차원의 벡터"] },
  "payload": {
    "book_id": 12345,
    "work_id": 77,
    "isbn13": "978...",
    "kdc_major": "8",
    "category_codes": ["소설", "한국소설"],
    "tag_codes": ["성장", "치유"],
    "audience": "ADULT",
    "ebook": false,
    "content_status": "TEXT_RICH",
    "embedding_version": "te3-small-{dimension}-v1"
  }
}
```

Qdrant에는 필터할 값만 저장한다. `kdc_major`, `category_codes`, `tag_codes`, `audience`, `ebook`, `content_status`에만 필요할 때 payload index를 둔다.

- 저장하지 않음: 책소개 원문, 전체 `feature_scores` JSON, 원본 수집 JSON, 사용자 개인정보·리뷰, 월별/실시간 대출량
- Qdrant 밖에서 관리: 원본 텍스트, 태그 산출 근거, 대출 파생 점수, 추천 결과

### 4.3 추천 조회

```text
사용자의 관심 태그·선호 도서·평점
  → 선호 도서 벡터의 가중 평균으로 취향 벡터 생성
  → Qdrant에서 유사 후보 200권 검색
  → PostgreSQL에서 읽은 책·찜한 책 제외
  → 태그 점수·KDC·인기도·신간성으로 재정렬
  → work_id와 시리즈 정보로 중복 제거
  → 최종 20권 반환
```

가입 직후처럼 사용자 취향 벡터가 없는 콜드스타트는 이 흐름을 사용하지 않는다. 세그먼트·가입 설문·신간 후보·인기도 추천은 별도 후보군으로 운영한다.

## 5. 후보 규모·차원·인프라

### 5.1 차원 확정 기준

추천에 실제 노출할 벡터 후보군을 약 100만 권으로 예상한다. 이 규모에서는 768차원 float16도 운영 가능하다. 다만 차원은 검색 품질을 확인한 뒤 확정한다.

```text
3만 권 평가셋
  → 512차원과 768차원 임베딩 생성
  → Recall@20, 태그/KDC 일치율, 사람이 보는 유사 도서 품질 비교
  → 체감 이득이 있으면 768, 아니면 512 선택
```

| 설정 | 벡터 원본 크기 |
| --- | ---: |
| 100만 권 × 512차원 × float16 | 약 1.0GiB |
| 100만 권 × 768차원 × float16 | 약 1.4GiB |
| 100만 권 × 768차원 × float32 | 약 2.9GiB |

100만 권·768차원·float16은 HNSW, 최소 payload, WAL을 포함해도 T3.xlarge에서 운영 가능한 범위다. 반대로 300만 권 전체를 기본 1536차원 float32로 저장하면 벡터 원본만 약 17.2GiB이므로 같은 EC2에서 운영할 수 없다.

### 5.2 300만 권 확장 시 상한

| 300만 권 기준 | 512차원 float16 | 768차원 float16 |
| --- | ---: | ---: |
| 벡터 원본 | 약 2.9GiB | 약 4.3GiB |
| HNSW 기본값 기준 | 약 0.4GiB 이상 | 약 0.4GiB 이상 |
| 운영 판단 | 디스크 중심 운영 필요 | T3.xlarge 동시 운영에는 비권장 |

Qdrant는 기본적으로 float32를 사용하므로 컬렉션 생성 시 float16을 명시한다. 벡터·HNSW·payload index·WAL·최적화 여유를 함께 고려해야 한다. [Qdrant 용량 계획](https://qdrant.tech/documentation/capacity-planning/)

현재 인프라에서는 다음을 채택한다.

```yaml
EC2: T3.xlarge (4 vCPU / 16GiB)
PostgreSQL: 원본·태그·대출 파생 점수·추천 결과
Qdrant: float16 + 디스크 중심(mmap/cold) 벡터 운영
Backend: 후보 검색 후 PostgreSQL 재정렬
EBS: 최소 100GiB
```

## 6. 신간·대출 이력 처리

신간은 대출 이력이 없거나 첫 달 값만 있어 차분이 0일 수 있다. 이를 인기 0점으로 해석하지 않는다.

```text
출간 직후 또는 관측 월 수 부족
  → trending_score = NULL
  → steady_score = NULL
  → 신간성 + 콘텐츠 적합도로만 후보 참여

완전한 월별 관측이 일정 기간 쌓인 뒤
  → 같은 출간 시기·같은 KDC 집단과 비교
  → 월별 차분·백분위·계절성 보정으로 trending_score 산출
```

신간 날짜의 신뢰도는 `REAL_PUBLISH_DATE` 검증 성공값, 검증된 `PUBLISH_PREDATE`, 정보나루의 연도값 순으로 둔다. 예정일이나 연도만으로 실제 출간일을 단정하지 않는다.

정보나루 `loan_history`가 누적값인지 월간값인지도 먼저 확인한다. 누적값이라면 반드시 차분 후 사용한다.

## 7. ERD 변경

### 7.1 추가할 테이블

#### `book_text_documents`

서로 다른 출처의 소개문·목차·요약을 보존하고 임베딩 입력을 재현하기 위한 테이블이다. 임베딩 상태 관리 테이블이 아니다.

```text
book_text_documents
- id PK
- book_id FK -> books.id
- source                     # NLL, DATA4LIBRARY, KAKAO
- text_type                  # DESCRIPTION, INTRODUCTION, SUMMARY, TOC, KEYWORDS
- content                    # 서비스용 정제 텍스트
- char_count
- content_hash
- source_url NULL
- collected_at
- updated_at
```

국중도 원본·API 원문은 기존 `book_source_records`와 수집 원본 보관소에 남긴다. `book_text_documents`는 서비스·임베딩용 정제 텍스트를 둔다. 목차는 `text_type = TOC`로 저장하고, 번호·쪽수 제거 결과는 오프라인 임베딩 문장 생성 시 적용한다.

#### `book_relation_edges`

정보나루의 `co_loan`, `mania_rec`, `reader_rec` 배열을 관계 행으로 풀어 보존한다.

```text
book_relation_edges
- source_book_id FK -> books.id
- target_book_id FK NULL
- target_isbn13
- relation_type              # CO_LOAN, MANIA_REC, READER_REC
- rank_or_weight NULL
- as_of_month NULL
- collected_at
```

`target_book_id`가 아직 없더라도 `target_isbn13`은 보존하고, 해당 ISBN이 나중에 적재되면 연결한다. 이 관계는 초기 핵심 랭킹에 바로 넣지 않고, 유효 대상 ISBN·canonical JOIN 비율을 재측정한 후 보조 후보군으로 사용한다.

### 7.2 그대로 유지할 테이블

| 테이블 | 역할 |
| --- | --- |
| `books` | 제목·저자·판본·카테고리·작품 그룹의 canonical 서지 |
| `book_source_records` | 출처 원본·수집 이력·검증 오류 |
| `book_content_features` | 콘텐츠 feature 점수와 버전 |
| `tags` / `book_tags` | 태그 사전과 책별 태그 점수·신뢰도·출처 |
| `book_demand_features` | 인기·트렌드·신간 파생 점수 |
| `user_interests` / `user_seed_books` | 가입 설문과 초기 선호 정보 |
| `recommendations` / `recommendation_items` | 추천 결과 |

### 7.3 추가하지 않는 테이블

```text
book_embeddings
embedding_jobs
embedding_status
embedding_profiles
user_embeddings
```

Qdrant가 벡터를 보관하며, 이번 일회성 적재의 성공·실패는 `ndjson` 작업 파일로 관리한다. 사용자 취향 벡터도 요청 시 선호 도서 벡터를 가중 평균해 만들고 영구 저장하지 않는다.

## 최종 한 줄

```text
수집·정제 완료 → 출처별 소개·목차 보존 → 목차 번호·쪽수 정제 → 의미 중심 임베딩 + 키워드/KDC 태그 보강 → GMS 일반 API 호출 → Qdrant float16 적재 → PostgreSQL 재정렬
```
