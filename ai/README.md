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

uv run uvicorn recommendation.api:app --host 0.0.0.0 --port 8000
```

기본 출력은 `ai/output/<command>.json`에, 로그는 `ai/logs/recommendation.log`에
생성된다. `--output`으로 명령별 출력 위치를 덮어쓸 수 있다.

## 재현성 계약

- Python은 3.12 계열만 지원한다.
- 설정의 `seed`와 입력 파일이 같으면 `artifactHash`와 JSON 산출물이 같다.
- JSON은 키 정렬과 고정 구분자를 사용해 직렬화한다.
- 산출물에는 실행 시각이나 절대 경로를 넣지 않는다.
- 설정 오류에는 환경 변수 값이나 비밀값을 출력하지 않는다.

실제 feature, 평가 지표, 추천 알고리즘은 후속 Jira 작업에서 각 command handler를
확장한다. CLI와 결과 envelope는 호환성을 위해 유지한다.

`validate`는 EC2 `d4l_usage.jsonl` 원천 스냅샷의 `d4l-usage-v1` 계약을 검사한다.
필수 식별자·제목·대출량의 오류, ISBN 중복, 관계 목록·월별 대출 이력의 타입과 범위
오류는 차단하고, 소개문·키워드·분류처럼 nullable인 결측은 경고와 예시로 남긴다.

## 내부 추천 API

백엔드와 FastAPI 사이의 책임, DTO, 추천 계산 방식은
[`docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](../docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md)를
기준으로 검토한다.

`POST /internal/v1/recommendations`는 백엔드가 사용자 식별자, seed/exclude ISBN,
사용자 태그와 추천 가중치만 전달하면 사전 색인된 D4L 도서에서 후보를 검색하고 재랭킹해
추천 결과만 반환한다. 도서 약 100만 건의 임베딩·태그·D4L feature는 오프라인 배치로
생성·색인한다. 상세 계약은 [`docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md`](../docs/AI_FASTAPI_RECOMMENDATION_CONTRACT.md)를 따른다.

AI 서버는 원천 수집 API나 사용자 DB를 호출하지 않으며, 응답의 `isbn13`을 기준으로
백엔드가 canonical 도서 정보와 화면 데이터를 결합한다.

## 테스트

```bash
uv run pytest
```

