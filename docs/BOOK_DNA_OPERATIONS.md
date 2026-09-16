# Book DNA 운영 가이드

> 관련 Jira: `S15P21B102-184`, `S15P21B102-186`
> 기준 계약: [BOOK_DNA_API_CONTRACT.md](./BOOK_DNA_API_CONTRACT.md)

## 구성

프론트엔드는 백엔드의 `GET /api/v1/users/me/dna`만 호출한다. 백엔드는 인증된
사용자의 서재를 seed로 만들어 FastAPI의 `POST /internal/v1/dna/profile`을 호출하고,
FastAPI는 Qdrant에 미리 적재된 책 DNA를 조합해 profile을 반환한다.

Book DNA 조회 시 GMS를 호출하지 않는다. GMS는 배치 단계의 도서 태그·임베딩 생성에만
사용되며, 운영 중인 profile 조회는 Qdrant 조회와 결정적 계산으로 처리한다.

## 버전 설정

AI 컨테이너에는 다음 세 버전을 함께 설정한다.

```dotenv
AI_MODEL_VERSION=gms-text-embedding-3-small-20260909-1000
AI_INDEX_VERSION=d4l-small-candidates-450k-20260915-034700
AI_TAG_VERSION=d4l-tags-candidates-450k-20260915-034700
```

`AI_INDEX_VERSION`과 `AI_TAG_VERSION`은 반드시 같은 배치의 artifact를 가리켜야 한다.
새 배치를 활성화할 때는 Qdrant promotion 결과를 확인한 뒤 AI 컨테이너를 재생성한다.

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  --profile recsys up -d --force-recreate --wait ai

docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  exec -T ai env | grep -E '^(AI_MODEL_VERSION|AI_INDEX_VERSION|AI_TAG_VERSION|QDRANT_URL)='
```

컨테이너 내부의 `QDRANT_URL`은 `http://qdrant:6333`이어야 한다. 호스트에서 배치 CLI를
실행할 때만 `http://127.0.0.1:6333`을 사용한다.

## 캐시 규칙

Book DNA profile 캐시 키는 다음 조합을 사용한다.

```text
userId + libraryUpdatedAt + dnaVersion + indexVersion + tagVersion
```

- 서재가 바뀌면 해당 사용자의 profile만 재계산한다.
- index/tag 버전이 바뀌면 전체 profile의 재계산 대상이 되지만, 책 임베딩을 다시 만들지는 않는다.
- FastAPI 장애 시 백엔드는 마지막 성공 profile을 사용할 수 있다.
- profile 조회 로그에는 requestId, 버전, seed 권수, 처리 시간만 남긴다.

## 배포 후 점검

### 1. AI health

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  exec -T ai python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).read().decode())'
```

응답의 `indexVersion`이 배포한 버전과 같은지 확인한다.

### 2. 백엔드 공개 API

```bash
curl -sS -H "Authorization: Bearer $JWT" \
  http://127.0.0.1:18080/api/v1/users/me/dna | jq '{dnaVersion, modelVersion, indexVersion, tagVersion, readCount, profile: .profile.status}'
```

정상적인 독서 기록이 있으면 `profile.status`는 `READY`여야 한다. 기록이 부족한
사용자는 오류가 아니라 `INSUFFICIENT_DATA`와 빈 지표를 받는다.

### 3. 개인정보·키 점검

- 프론트엔드가 FastAPI 주소나 Qdrant 주소를 직접 호출하지 않는지 확인한다.
- GMS·Qdrant 키가 응답, 로그, 저장소에 포함되지 않았는지 확인한다.
- 공개 응답에 `userId`를 노출하지 않는다.

## 장애 대응

| 증상 | 확인 | 조치 |
| --- | --- | --- |
| `503` 또는 DNA 화면 오류 | AI health, 컨테이너 로그 | 마지막 profile 캐시 또는 안내 화면 사용 |
| `indexVersion` 불일치 | AI 컨테이너 env | `.env` 수정 후 `--force-recreate ai` |
| 모든 profile이 `INSUFFICIENT_DATA` | 백엔드 서재 조회·READ 상태 | seed 전달과 `libraryUpdatedAt` 확인 |
| Qdrant 조회 실패 | Qdrant health·API key hash | 컨테이너 간 URL과 키를 점검 |

새 배치의 태그·임베딩 생성은 별도의 배치 run으로 수행하고, 성공 report와
`PROMOTED` 상태를 확인한 뒤에만 운영 버전을 변경한다. 운영 중 API 요청으로 GMS를
호출해 누락된 책을 즉석 생성하지 않는다.
