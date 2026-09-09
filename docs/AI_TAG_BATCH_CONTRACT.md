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
2. 선택적으로 `GmsTagProvider`를 주입해 애매한 태그를 오프라인에서 보강한다.
3. GMS code가 taxonomy에 없거나 confidence가 범위를 벗어나면 버린다.
4. 같은 code의 rule/GMS 결과는 confidence가 높은 결과를 사용하고, 동점이면 rule을 유지한다.
5. provider 실패·rate limit은 설정된 횟수만큼 재시도하며, rule 결과는 유지한다.

## sidecar 레코드

각 레코드는 `isbn13`, `inputHash`, `taxonomyVersion`, `tagVersion`, `status`, `tags`,
`tagCodes`, `tagScores`, `tagConfidence`, `lowConfidence`, `gmsError`를 가진다. `tags[]`의
각 항목은 `code`, `label`, `source`, `confidence`를 가진다.

## 재시작·통계

`TagBatchRunner`는 같은 `inputHash`·`tagVersion`의 완료 레코드를 재사용하고 임시 파일을
원자적으로 교체한다. report에는 성공·결측·저신뢰·재개 행 수, GMS 시도·실패 수,
`outputHash`, `sourceDataCommitted=false`를 남긴다. 동일 입력·taxonomy·tag version에서
같은 결과를 재현할 수 있다.

```python
from recommendation.tag_batch import TagBatchRunner, TagGenerator

report = TagBatchRunner(
    generator=TagGenerator(gms_provider=optional_gms_provider),
    tag_version="d4l-tags-v1",
).run(input_path, output_path)
```
