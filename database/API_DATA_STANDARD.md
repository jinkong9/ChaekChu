# 외부 API 데이터 저장 표준

`database` 폴더에는 외부 API별 원본 데이터, 정제 결과, 수집 코드, 품질 리포트를 API 단위로 보관한다.

새로운 API를 추가할 때는 `database/국립중앙도서관`을 기준으로 아래 구조를 사용한다.

```text
database/
└── {API명}/
    ├── {API_SPEC}.md   # API 설명, 요청/응답, 필드 매핑, 실제 값, 저장 정책
    ├── .gitignore      # 대용량 생성 결과물 제외
    ├── scripts/        # 수집·정제·검증 코드
    ├── raw/            # API 원본 응답. 기본적으로 Git 제외
    ├── processed/      # 정제·병합 결과. 기본적으로 Git 제외
    ├── samples/        # 검토 가능한 소형 샘플
    ├── reports/        # 품질·결측·중복 리포트
    └── metadata/       # 수집 구간·캐시·미해결 구간·실행 메타데이터
```

## 공통 파일 규칙

| 구분 | 권장 파일명 | 저장 내용 |
| --- | --- | --- |
| 원본 응답 | `raw/{resource}_raw_{date}.jsonl` | API 응답을 가능한 한 원형에 가깝게 저장 |
| 정제 결과 | `processed/{resource}_normalized_{date}.jsonl` | 타입 변환·정규화·중복 처리 결과 |
| 샘플 | `samples/sample_{resource}.jsonl` | 실제 값이 포함된 소형 샘플 |
| 가독성 샘플 | `samples/sample_{resource}.pretty.json` | 사람이 읽기 좋게 들여쓴 JSON 배열 |
| 품질 요약 | `reports/data_quality_summary_{scope}.txt` | 건수·결측·이상값·중복 요약 |
| 필드 리포트 | `reports/missing_report_{scope}.csv` | 필드별 결측률과 실제 예시 |
| 수집 계획 | `metadata/range_plan.json` | 기간·페이지·예상 건수 등 실행 계획 |
| 수집 캐시 | `metadata/range_count_cache.json` | API 건수 조회 캐시 |
| 실패 기록 | `metadata/unresolved_ranges.json` | 재시도·미해결 구간과 원인 |

## 반드시 README에 포함할 내용

1. 공식 API URL과 인증 방식
2. 요청 파라미터와 실제 요청 예시
3. 응답 래퍼와 실제 레코드 예시
4. 필드별 자료형·결측 표현·실제 값
5. 우리 서비스에서의 역할과 저장 위치
6. JOIN 키와 정규화 규칙
7. 결측·중복·이상값 처리 방식
8. 수집 코드 실행 방법
9. 대용량 결과물을 저장하지 않는 이유와 외부 데이터 위치

## 저장 원칙

- API 키·비밀번호·개인정보는 커밋하지 않는다.
- 원본과 정제본을 같은 파일에 섞지 않는다.
- 대용량 결과물은 Git에 올리지 않고 `--output-dir` 등 외부 경로에 저장한다.
- `samples/`에는 실제 응답 구조를 확인할 수 있는 작은 샘플만 넣는다.
- 품질 리포트에는 전체 데이터의 건수, 생성 시각, 대상 범위를 기록한다.
- 다른 API와 JOIN할 식별자는 원본값과 정규화값을 모두 보존한다.

국립중앙도서관 폴더가 이 규칙을 적용한 기준 예시다.
