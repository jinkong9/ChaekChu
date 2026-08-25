# raw

정보나루 `srchDtlList` 응답 원형(JSONL)을 저장한다. 대용량이므로 Git에 포함하지 않는다.

- 파일명: `dtl_raw_{YYYYMMDD}.jsonl`
- 한 줄 = 요청 1건: `{"collected_at", "request": {"isbn13"}, "response": <원본 응답>}`
