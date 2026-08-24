# YES24 수집 메타데이터

| 파일 | 역할 | Git 포함 |
| --- | --- | --- |
| `collection_run_YYYYMMDD.json` | 실행 범위·건수·상태·산출물 요약 | 포함 |
| `yes24_seed_checkpoint.json` | 국내·외국도서 후보 수집의 다음 카테고리·페이지 | 포함 |
| `yes24_seed_ebook_checkpoint.json` | eBook 후보 수집의 다음 페이지 | 포함 |

체크포인트의 `apiCalls`는 해당 수집기 실행이 기록한 목록 호출 수이며 YES24 계정 전체 사용량이 아니다. 계정 단위의 정확한 당일 사용량은 YES24 Developers의 이용 현황에서 확인한다.

API 키, 요청 헤더, `.env` 값은 메타데이터에 기록하지 않는다.

