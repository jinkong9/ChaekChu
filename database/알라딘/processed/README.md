# 정제 결과 (processed)

`raw/parts/`를 병합하고 중복을 제거한 결과를 저장하는 위치다. **내용물은 Git에 포함하지 않는다.**

```text
{output-dir}/processed/items_normalized_{scope}.jsonl
```

`--mode merge` 또는 수집 모드의 마지막 단계에서 생성된다. 처리 내용은 다음과 같다.

| 단계 | 처리 |
| --- | --- |
| 병합 | `raw/parts/`의 모든 `.jsonl`을 파일명 순으로 이어붙임 |
| 중복 제거 | `--dedup-key`(기본 `itemId`) 기준. 분야·리스트 조회가 겹쳐 같은 상품이 여러 파트에 들어오기 때문 |
| 통계 | 필드별 결측·`0`값 집계 후 `reports/`에 리포트 생성 |

이 단계에서는 **타입 변환과 값 정규화를 하지 않는다.** 원본 필드를 그대로 둔 채 중복만 제거한 상태다.

빈 문자열·`0`의 `NULL` 변환, ISBN 검증, `categoryName` 계층 분해, `title`·`author` 파싱 등 실제 정규화는 적재 파이프라인에서 수행하며 규칙은 [`ALADIN_OPENAPI.md`](../ALADIN_OPENAPI.md)의 정규화 절에 정리되어 있다.

`{scope}`는 `--scope` 옵션으로 지정하며 기본값은 `all`이다. 수집 범위를 나눠 실행할 때 리포트가 서로 덮어쓰이지 않도록 구분하는 용도다.
