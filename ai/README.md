# B102 Recommendation

Python 3.12로 실행하는 추천 API·배치·평가 패키지다. 백엔드가 정제한 canonical 입력을
내부 FastAPI로 받아 추천 결과 계약에 맞춰 반환하며, CLI는 오프라인 검증과 평가에 사용한다.

## 준비

```bash
cd ai
uv sync --extra dev
```

`uv`가 없다면 Python 3.12 환경에서 다음과 같이 설치할 수 있다.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"  # Windows
```

## 실행

모든 명령은 같은 공통 옵션을 사용한다.

```bash
uv run b102-recommendation --config config/local.toml build --input tests/fixtures/books.jsonl
uv run b102-recommendation --config config/local.toml validate --input tests/fixtures/d4l_usage.contract.sample.jsonl
uv run b102-recommendation --config config/local.toml evaluate --input tests/fixtures/books.jsonl
uv run b102-recommendation --config config/local.toml recommend --input tests/fixtures/books.jsonl --user-id demo-user
uv run b102-recommendation --config config/local.toml tune \
  --input tests/fixtures/d4l_usage.contract.sample.jsonl --k 5 --recall-k 10

# EC2/운영: 환경변수의 provider·Qdrant staging index로 실행
uv run b102-recommendation --config config/local.toml index \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --index-version d4l-2026-09-v1 \
  --tag-sidecar /home/ubuntu/pipeline_data/data4library/d4l_tags.v1.jsonl \
  --batch-size 32 --max-retries 2

# EC2/운영: rule tag + 선택적 GMS tag sidecar 생성
uv run b102-recommendation --config config/local.toml tags \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --sidecar /home/ubuntu/pipeline_data/data4library/d4l_tags.v1.jsonl \
  --tag-version d4l-tags-v1 --max-retries 2

# EC2/운영: taxonomy tag prototype을 Qdrant tags_active alias에 적재
uv run b102-recommendation --config config/local.toml tag-index \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --index-version d4l-2026-09-v1 --tag-version d4l-tags-v1 \
  --batch-size 32 --max-retries 2

# EC2/운영: D4L 관계 정답으로 추천 가중치 후보를 비교
uv run b102-recommendation --config config/local.toml tune \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --tag-sidecar /home/ubuntu/pipeline_data/data4library/d4l_tags.v1.jsonl \
  --k 5 --recall-k 10

# 로컬/EC2: validation·tag 품질·weight tuning을 하나의 report로 검증
uv run b102-recommendation --config config/local.toml smoke \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --tag-sidecar /home/ubuntu/pipeline_data/data4library/d4l_tags.v1.jsonl \
  --tag-version d4l-tags-v1 --k 5 --recall-k 10 \
  --output /home/ubuntu/pipeline_data/data4library/recommendation-smoke.json

# FastAPI/운영: 동시 요청과 timeout·복구 smoke test
uv run pytest --basetemp .pytest-tmp-164 tests/test_resilience.py

uv run uvicorn recommendation.api:app --host 0.0.0.0 --port 8000
```

컨테이너로 실행할 때는 저장소 루트에서 다음 명령을 사용한다.

```bash
docker build -f ai/Dockerfile -t b102-ai:local ai
docker run --rm -p 8000:8000 -e AI_PORT=8000 -e AI_LOG_LEVEL=info b102-ai:local
```

컨테이너는 non-root 사용자로 실행되며 `/health`는 `modelVersion`과 활성
`indexVersion`을 함께 반환한다. `AI_PORT`, `AI_LOG_LEVEL`, `AI_MODEL_VERSION`,
`AI_INDEX_VERSION`으로 실행 환경을 주입할 수 있다. `QDRANT_URL`과 활성
`AI_INDEX_VERSION`이 함께 설정되면 FastAPI 시작 시 Qdrant 검색·query vector
adapter가 연결된다. `QDRANT_COLLECTION`은 `books_active` alias를 기본값으로
사용하고, `QDRANT_TAG_COLLECTION`은 사전 계산한 태그 prototype collection이
있을 때만 설정한다. `QDRANT_VECTOR_NAME`은 named vector를 사용할 때 지정한다.
활성 index가 설정되기 전에는 추천 API가 빈 결과의 명시적 fallback으로 응답한다.

운영 환경에서는 온라인 FastAPI에 필요한 변수만 주입하고 원본 데이터·벡터·API key는
이미지나 Git에 포함하지 않는다. 아래 임베딩·태그 API 변수는 온라인 요청용이 아니라
오프라인 배치 실행 시에만 사용한다.

```text
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=<secret>
QDRANT_COLLECTION=books_active
QDRANT_TAG_COLLECTION=tags_active
QDRANT_VECTOR_NAME=
QDRANT_TIMEOUT_SECONDS=10
AI_MODEL_VERSION=gms-text-embedding-3-small-release
AI_INDEX_VERSION=not-generated  # 배치 promote 후 실제 indexVersion으로 변경
AI_TAG_VERSION=not-generated    # tag-index promote 후 실제 tagVersion으로 변경

# offline batch only
EMBEDDING_API_URL=https://gms.ssafy.io/gmsapi/api.openai.com/v1/embeddings
EMBEDDING_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
EMBEDDING_TIMEOUT_SECONDS=30
TAG_API_URL=https://gms.ssafy.io/gmsapi/api.openai.com/v1/chat/completions
TAG_API_KEY=
TAG_MODEL=gpt-4o-mini
TAG_API_TIMEOUT_SECONDS=30
TAG_RULE_CONFIDENCE_THRESHOLD=0.85
TAG_BATCH_SIZE=16
```

규칙 기반 태그 중 하나라도 `TAG_RULE_CONFIDENCE_THRESHOLD` 이상이면 해당 도서의 GMS 태그 호출을 생략한다. 기본값은 `0.85`이며, GMS 결과를 항상 확인하려면 threshold를 `1.0`으로 설정한다.
GMS provider를 사용하는 tags 배치는 `TAG_BATCH_SIZE`만큼의 도서를 한 요청으로 묶으며, 기본값은 `16`이다.

기본 출력은 `ai/output/<command>.json`에, 로그는 `ai/logs/recommendation.log`에
생성된다. `--output`으로 명령별 출력 위치를 덮어쓸 수 있다.

## 재현성 계약

- Python은 3.12 계열만 지원한다.
- 설정의 `seed`와 입력 파일이 같으면 `artifactHash`와 JSON 산출물이 같다.
- JSON은 키 정렬과 고정 구분자를 사용해 직렬화한다.
- 산출물에는 실행 시각이나 절대 경로를 넣지 않는다.
- 설정 오류에는 환경 변수 값이나 비밀값을 출력하지 않는다.
- `inputHash`는 추천 입력 feature를 고정 순서로 정규화한 `d4l-feature-normalization-v1`
  기준으로 계산하며, `description`, `keywords`, `embedding`은 포함하지 않는다.
- 관계 목록은 식별자·제목 기준으로 중복 제거 후 정렬하고, `loan_history`는 월 기준으로
  정렬해 원본 배열 순서에 영향을 받지 않게 한다.

실제 feature, 평가 지표, 추천 알고리즘은 후속 Jira 작업에서 각 command handler를
확장한다. CLI와 결과 envelope는 호환성을 위해 유지한다.

`validate`는 EC2 `d4l_usage.jsonl` 또는 `.gz` 원천 스냅샷의 `d4l-usage-v1` 계약을
검사한다. 필수 식별자·제목·대출량의 오류, ISBN 중복, 관계 목록·월별 대출 이력의 타입과
범위 오류는 차단하고, 선택 필드 결측과 문서에 없는 필드는 경고로 남긴다. 결과에는
대출량·대출 이력 통계, 관계 ISBN의 스냅샷 내부 커버리지, 아직 제공되지 않은 L1·수요
feature 상태가 함께 기록된다.

`evaluate`는 세 D4L 관계(`co_loan`, `mania_rec`, `reader_rec`)를 정답으로 사용해
`popularBaseline`, `embeddingOnly`(현재는 재현 가능한 TF-IDF 내용 유사도 proxy),
`hybrid`를 비교한다. 결과에는 P@5, R@10, 관계 대상 coverage, 분류 기준 diversity와
관계 대상의 색인 밖 개수·후보 부족·빈 관계·결측 대출이력 케이스가 포함된다. 모든
분모는 결과 JSON에 기록되며, 대용량 원본과 벡터는 저장소에 넣지 않는다.

`tune`은 같은 D4L 관계를 정답으로 사용해 semantic, tagMatch, coLoan, trending,
steady 가중치 후보를 비교한다. P@5, Recall@10, target coverage, diversity를
기반으로 결정적인 선택 점수를 계산하고 추천 기본 가중치를 결과에 기록한다. 태그
sidecar가 없거나 특정 ISBN의 태그가 없으면 `tagMatch`를 0점으로 간주하지 않고
해당 후보의 가중치 분모에서 제외한다. 현재 오프라인 semantic 점수는 재현 가능한
TF-IDF proxy이며, 운영 100만 건 임베딩 색인과의 검증은 staging Qdrant에서 별도로
수행한다.

`tests/test_resilience.py`는 in-memory index를 사용해 실제 HTTP DTO 경계에서 32건
동시 personalized 요청의 응답 격리와 hard exclude를 확인한다. 또한 검색 timeout은
demand fallback으로 전환되는지, query vector timeout은 500 없이 빈 fallback으로
응답하는지, 정상 엔진으로 교체한 뒤 다시 추천되는지를 검증한다. 이 테스트는 외부
Qdrant/GMS를 호출하지 않으므로 CI와 로컬 smoke test에서 반복 실행할 수 있다.

추천 후보는 `isbn13`을 유일한 병합 키로 사용한다. 같은 ISBN이 여러 번 들어오면
메타데이터 완성도, 누적 대출량, 제목·저자·분류 보조 키 순서로 대표 도서를 결정한다.
제목·저자·분류가 같더라도 ISBN이 다르면 서로 다른 후보로 유지하며, D4L 관계도
후보 ISBN과 정확히 일치하는 경우에만 조인한다.

후보 검색은 `recommendation.vector_search`의 `CandidateSearchService`를 통해 수행한다.
운영 환경은 Qdrant REST 어댑터를 사용하고, 테스트·로컬 smoke check는 동일한 계약의
in-memory 인덱스를 사용한다. `seedIsbns`와 `excludeIsbns`는 합쳐서 하드 제외하며,
모든 검색은 활성 `indexVersion`을 metadata filter로 고정한다. 응답 상태는 `OK`,
`CANDIDATE_SHORTAGE`, `INDEX_NOT_FOUND`, `TIMEOUT`으로 구분하고 검색 limit·index
version·제외 수·seed 수를 함께 기록한다.

후보 재랭킹은 `recommendation.reranking`의 `HybridReranker`가 담당한다. semantic,
tagMatch, coLoan, trending, steady를 각각 0~100으로 계산하고, 백엔드가 전달한
가중치 중 실제 값이 있는 feature만으로 분모를 재계산한다. 따라서 결측 feature를
임의의 0점 근거로 해석하지 않으며, 최종 score·featureScores·기여 feature를 함께
기록할 수 있다. 같은 점수는 ISBN13 오름차순으로 정렬해 실행 간 결과를 재현한다.

검색 장애와 결측 feature fallback은 `recommendation.fallback`의
`RecommendationFallbackPolicy`가 담당한다. 태그가 없으면 tagMatch를 결측으로 두고
semantic·수요 feature만으로 계산한다. 후보 부족은 가능한 결과만 반환하면서
`CANDIDATE_SHORTAGE`와 `fallback=true`를 기록하고, Vector DB timeout·색인 없음은
제외 ISBN을 적용한 수요 후보로 전환한다. 수요 후보조차 없으면 빈 결과와
`canPersist=false`를 반환해 장애 중간 결과를 정상 추천으로 저장하지 않는다. 후보
부족도 가능한 결과를 화면에 반환하되 `canPersist=false`로 표시한다. 모든
fallback 결과에는 modelVersion과 indexVersion을 함께 보존한다.

seed와 query vector를 만들 수 없는 COLD_START 요청은
`recommendation.demand`의 `ColdStartDemandRanker`로 처리한다. `loan_history`의
최신 월 대출량을 trending, `loan_total`을 steady로 각각 정규화하고 기본 가중치
0.6·0.4를 적용한다. 두 feature 중 하나만 있으면 해당 feature만 사용하며, 둘 다
없으면 score 0으로 정렬한다. 결과는 `COLD_START_DEMAND`와 demandScores를 남기고,
seed·exclude ISBN은 항상 제거한다.

seed·사용자 태그 query vector는 `recommendation.query_vector`의
`QueryVectorBuilder`가 사전 색인 벡터만으로 생성한다. seed 벡터는 평균하고, 태그
prototype은 사용자 tag weight로 가중 평균한 뒤 요청의 semantic·tagMatch weight로
두 성분을 결합한다. 알 수 없는 taxonomy, 색인에 없는 seed·태그, index version 불일치는
결과 metadata에 기록하며, 사용 가능한 벡터가 없으면 `COLD_START`로 전환한다. 이
경로에서는 매 요청 GMS 호출을 하지 않는다.

최종 top-K 선택은 `recommendation.top_k`의 `TopKRecommendationRanker`가 담당한다.
요청 size는 기본 5, 최대 10으로 검증하고 seed·exclude ISBN과 중복 ISBN을 먼저 제거한다.
점수 순서만 고정하지 않고 작품(workKey 또는 서지 기반 fallback)·저자 반복에 선택 penalty를
적용해 다양성을 보정한다. 응답용 primaryReason과 reasons는 실제로 양수 기여한
feature만으로 결정적 템플릿을 만들며, 근거가 없는 태그·설명을 추가하지 않는다.

임베딩 배치는 `recommendation.embedding_batch`의 `EmbeddingBatchRunner`로 실행한다.
입력은 서지·분류 필드만 조합하고, 관계·대출이력은 Qdrant payload metadata로 저장한다.
태그 배치 sidecar를 같은 `inputHash`·`tagVersion`으로 전달하면 ISBN이 일치하는 도서의
`tagCodes`, `tagScores`, `tagConfidence`도 payload에 함께 저장한다. sidecar에 없는 ISBN은
태그 결측으로 남기며, 원본에 없는 sidecar ISBN은 report에 기록하고 색인하지 않는다.
Qdrant에서는 index version별 staging collection에 upsert한 뒤 `books_active` alias를
교체하므로, 새 버전의 부분 실패가 기존 active index를 덮어쓰지 않는다. 배치 report에는
inputHash, embedding/feature/tag version, 차원, 성공·실패·재시도·재개·승격 결과를 기록한다.
테스트 provider는 결정적 hashing embedding이며 실제 GMS embedding provider는 같은
`TextEmbedder` protocol로 교체할 수 있다.

## 내부 추천 API

모델·태그·임베딩 index의 갱신, promote, runtime 반영과 alias 롤백 절차는
[`AI_MODEL_TAG_INDEX_RUNBOOK.md`](../docs/AI_MODEL_TAG_INDEX_RUNBOOK.md)를 따른다.

백엔드와 FastAPI 사이의 책임, DTO, 추천 계산 방식은
[`docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](../docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md)를
기준으로 검토한다.

`POST /internal/v1/recommendations`는 백엔드가 사용자 식별자, seed/exclude ISBN,
사용자 태그와 추천 가중치만 전달하면 사전 색인된 D4L 도서에서 후보를 검색하고 재랭킹해
추천 결과만 반환한다. 도서 약 100만 건의 임베딩·태그·D4L feature는 오프라인 배치로
생성·색인한다. 상세 계약은 [`docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](../docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md)를 따른다.

AI 서버는 원천 수집 API나 사용자 DB를 호출하지 않으며, 응답의 `isbn13`을 기준으로
백엔드가 canonical 도서 정보와 화면 데이터를 결합한다.

### 백엔드 연결

운영 Compose에서 백엔드와 AI가 같은 Docker 네트워크에 있으면 다음 주소를 사용한다.

```text
AI_RECOMMENDATION_URL=http://ai:8000
POST http://ai:8000/internal/v1/recommendations
GET  http://ai:8000/health
```

AI 포트는 외부에 공개하지 않으므로 백엔드 컨테이너에서 `127.0.0.1:8000`을 사용하지
않는다. 요청·응답 DTO의 상세 규격은
[`docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](../docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md)를
기준으로 한다. 백엔드는 `items[].isbn13`을 canonical `bookId`와 결합하며, AI는
도서 상세 정보나 사용자 DB를 반환·저장하지 않는다.

```json
{
  "requestId": "request-001",
  "userId": "user-001",
  "mode": "PERSONALIZED",
  "size": 5,
  "seedIsbns": ["9788950906030"],
  "excludeIsbns": [],
  "tags": [{"code": "FANTASY", "weight": 1.0}],
  "weights": {
    "semantic": 0.5,
    "tagMatch": 0.5,
    "coLoan": 0.0,
    "trending": 0.0,
    "steady": 0.0
  }
}
```

## 테스트

```bash
uv run pytest
```

