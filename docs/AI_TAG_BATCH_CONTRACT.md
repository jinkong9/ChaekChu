# AI 도서 태그 생성·매핑 배치 계약

`#159`의 태그 배치는 ISBN이 중복 제거된 D4L snapshot을 입력으로 받아, 백엔드 사용자
태그와 같은 taxonomy code를 사용하는 JSONL sidecar를 생성한다. 원본 JSONL은 수정하지
않으며 sidecar와 report는 운영 artifact 저장소에 보관한다.

## 입력 경계

태그 생성에는 `isbn13`, `bookname`, `authors`, `publisher`, `pub_year`, `class_no`,
`class_nm`만 사용한다. `description`, `keywords`, 감상평, 사용자 개인정보와 API key는
입력이나 로그에 포함하지 않는다.

## taxonomy

현재 `TAXONOMY_VERSION=book-taxonomy-v1`이며 `FIC`, `ESSAY`, `SCIENCE`, `HISTORY`,
`ECONOMY`, `FANTASY`, `MYSTERY`, `ROMANCE`, `GROWTH`, `FAMILY`, `TIME_TRAVEL`,
`TRENDING`, `STEADY`, `NEW_BOOK` code를 사용한다. code와 화면 label은
`recommendation.tag_batch.TAXONOMY`에서 함께 관리한다.

## 생성 순서

1. `RuleBasedTagger`가 분류·서지 필드에서 확정 가능한 태그를 결정적으로 생성한다.
2. 규칙 태그 중 하나라도 `TAG_RULE_CONFIDENCE_THRESHOLD` 이상이면 GMS 호출을 생략하고
   규칙 결과만 사용한다. 기본 threshold는 `0.85`다.
3. 대출 이력으로 판정 가능한 `TRENDING`·`STEADY`는 로컬에서 생성한다. threshold 미만이거나
   규칙 태그가 없는 경우에만 선택적으로 `GmsTagProvider`를 호출해 애매한 태그를 오프라인에서 보강한다.
4. GMS code가 taxonomy에 없거나 confidence가 범위를 벗어나면 버린다.
5. 같은 code의 rule/GMS 결과는 confidence가 높은 결과를 사용하고, 동점이면 rule을 유지한다.
6. provider 실패·rate limit은 설정된 횟수만큼 재시도하며, rule 결과는 유지한다.

## sidecar 레코드

각 레코드는 `isbn13`, `inputHash`, `taxonomyVersion`, `tagVersion`, `status`, `tags`,
`tagCodes`, `tagScores`, `tagConfidence`, `lowConfidence`, `gmsError`, `gmsSkipped`,
`gmsSkipReason`을 가진다. `tags[]`의 각 항목은 `code`, `label`, `source`, `confidence`를
가진다. 규칙 기반으로 GMS를 생략한 레코드는 `gmsSkipped=true`,
`gmsSkipReason=RULE_CONFIDENT`를 가진다.

## 재시작·통계

`TagBatchRunner`는 같은 `inputHash`·`tagVersion`의 완료 레코드를 재사용하고 임시 파일을
원자적으로 교체한다. 선택적으로 `--cache` 또는 `TAG_CACHE_PATH`를 지정하면 정규화된 서지·대출
메타데이터 hash를 영속 cache key로 사용한다. cache는 ISBN과 현재 sidecar의 `tagVersion`을
key에 포함하지 않으므로, 같은 taxonomy·규칙·GMS 모델 설정의 후속 배치에서 다른 tagVersion으로도
재사용할 수 있다. cache에 저장되는 것은 태그 결과뿐이며 GMS 실패·빈 결과는 저장하지 않는다.

report에는 성공·결측·저신뢰·재개 행 수, 도서별 GMS 시도 수
(`gmsAttempts`), 실제 HTTP 요청 수(`gmsRequests`), 다건 요청 수(`gmsBatchRequests`),
GMS 실패 수, 생략 행 수(`gmsSkippedRows`), cache 적중 수(`cacheHitRows`), cache 신규 저장 수
(`cacheWriteRows`), 적용 threshold(`ruleConfidenceThreshold`), `outputHash`,
`sourceDataCommitted=false`를 남긴다. cache hit sidecar 레코드는 `cacheHit=true`,
`gmsSkipReason=CACHE_HIT`로 표시한다.

## GMS provider와 실행

`GmsTagProvider`는 OpenAI 호환 chat completions endpoint에 서지·분류 필드만 보내고,
단건 요청은 `{"tags":[{"code":"FANTASY","confidence":0.91}]}`, 다건 요청은
`{"books":[{"isbn13":"...","tags":[...]}]}` 형태의 JSON content만 읽는다.
허용 taxonomy 밖의 code, confidence 범위 밖의 값, 잘못된 응답은 저장하지 않는다. 요청
본문·응답 원문·API key는 예외 메시지나 로그에 포함하지 않는다. GMS 장애가 나면 설정된
횟수만큼 재시도하고, 다건 요청이 최종 실패하면 해당 batch를 단건 요청으로 fallback한다.
단건 fallback도 실패하면 rule tag 결과를 유지한다.

운영에서는 다음처럼 `tags` 명령을 실행한다. `TAG_API_URL`과 `TAG_API_KEY`가 모두
설정된 경우에만 GMS를 호출하고, 둘 다 없으면 rule-only sidecar를 생성한다.
GMS를 사용하는 경우에도 규칙 confidence가 threshold 이상인 도서는 호출하지 않는다.

```bash
uv run b102-recommendation --config config/local.toml tags \
  --input /home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz \
  --sidecar /home/ubuntu/pipeline_data/data4library/d4l_tags.v1.jsonl \
  --tag-version d4l-tags-v1 --max-retries 2 --batch-size 16
```

선택적 호출 threshold는 환경변수 또는 CLI 옵션으로 조정할 수 있다.

```bash
export TAG_RULE_CONFIDENCE_THRESHOLD=0.85
# 또는 tags 명령에 --rule-confidence-threshold 0.90 추가
export TAG_BATCH_SIZE=16
# 또는 tags 명령에 --batch-size 16 추가
export TAG_CACHE_PATH=/home/ubuntu/pipeline_data/data4library/tag-cache/d4l-tags.jsonl
# 또는 tags 명령에 --cache /home/ubuntu/pipeline_data/data4library/tag-cache/d4l-tags.jsonl 추가
```

```python
from recommendation.tag_batch import TagBatchRunner, TagGenerator

report = TagBatchRunner(
    generator=TagGenerator(gms_provider=optional_gms_provider),
    tag_version="d4l-tags-v1",
).run(input_path, output_path)
```
