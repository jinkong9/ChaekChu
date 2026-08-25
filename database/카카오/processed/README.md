# 정규화 결과 (processed)

완료된 `raw/parts/*.jsonl`을 병합하고 다음 순서로 중복을 제거한다.

```text
유효한 ISBN-13 → 유효한 ISBN-10 → 제목+저자+출판사+출간일
```

두 카카오 수집기는 `scripts/kakao_book_common.py`의 같은 규칙을 사용하며 결과를 두 단계로 분리한다.

| 파일 | 내용 |
| --- | --- |
| `books_merged_{date}.jsonl` | API 원본 필드와 `_source_*`를 유지한 병합·중복 제거 결과 |
| `books_normalized_{date}.jsonl` | ISBN 체크섬 검증, ISBN-10→13 변환, 결측 표현 통일 결과 |

제목 쿼터 수집 결과는 각각 `books_merged_quota_{date}.jsonl`, `books_normalized_quota_{date}.jsonl`로 저장한다.

가격 결측은 `null`, 문자열은 `""`, 배열은 `[]`로 표현한다. 전체 결과는 `.gitignore`로 제외하고 이 README와 `samples/`의 소형 검토본만 저장소에 포함한다.

현재 변환 산출물은 다음과 같다.

| 파일 | 레코드 수 | 용도 |
| --- | ---: | --- |
| `books_merged_quota_20260824.jsonl` | 254,640 | API 원본 필드 기반 분석·재정규화 |
| `books_normalized_quota_20260824.jsonl` | 254,640 | ISBN JOIN과 팀 개발에 사용하는 기본 파일 |

대용량 파일은 Git이 아닌 팀 공유 저장소로 전달하고 `metadata/data_manifest.json`의 SHA-256으로 무결성을 확인한다.
