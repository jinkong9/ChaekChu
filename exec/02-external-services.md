# 외부 서비스 정보

## 1. 서비스와 용도

| 서비스 | 프로젝트에서의 용도 | 필요한 준비 |
| --- | --- | --- |
| SSAFY GitLab | 비공개 저장소, Merge Request, 소스 checkout, commit status 및 webhook | 팀원 저장소 권한. Jenkins 연동 시 프로젝트 범위의 최소 권한 부여 |
| Jenkins | Merge Request·`dev` 검증 및 EC2 CD | EC2 호스트에서 운영. 관리자 화면은 SSH 터널로만 접근 |
| SSAFY EC2 | Nginx, Spring API, Python API, PostgreSQL, Elasticsearch 운영 | Ubuntu 24.04 서버·SSH 접근과 Docker 운영 권한 |
| 카카오 로그인 | 신규·기존 사용자의 OAuth 로그인 | 개발자 콘솔 앱 등록, 허용 도메인과 callback 주소 설정 |
| Google 로그인 | 신규·기존 사용자의 OAuth 로그인 | Google Cloud OAuth 동의 및 redirect URI 등록 |
| SSAFY GMS | 임베딩 생성 및 도서 태그 보강 등 오프라인 AI 작업 | 팀의 GMS 사용 승인과 모델 접근 권한. 비밀 자격 정보는 보호된 경로에서 전달 |
| 국립중앙도서관 API | ISBN 기반 도서 판본·서지 마스터 수집 | API 이용 신청과 수집 허용 범위 확인 |
| 정보나루 | 서지 보완, 대출 수요·함께 대출한 책 자료 | 데이터4라이브러리 이용 신청, 수집 범위·시점 확인 |
| YES24·알라딘·카카오 도서 API | 소개·표지·출간일·페이지 등 카탈로그 보강 | 각 제공처 정책·호출 한도에 맞는 접근 설정 |
| Let's Encrypt | 서비스 HTTPS 인증서 | 도메인 소유·DNS 및 갱신 작업 확인 |
| Elasticsearch·Qdrant | 자체 배포 검색·벡터 서비스. SaaS 외부 계정이 아닌 Compose 서비스 | 운영 compose·보안 설정 및 Qdrant 선택 profile 확인 |

도서 수집 데이터의 출처·용도·정규화 정책은 저장소의 `database/*_API.md`, `database/API_DATA_STANDARD.md`, `database/BOOK_DATA_USAGE_AND_RECOMMENDATION.md`를 기준으로 한다.

## 2. 연동 흐름

- 브라우저는 Nginx를 통해 Spring API만 호출한다. 추천 API와 데이터베이스 주소는 브라우저에 노출하지 않는다.
- Spring API는 카카오·Google OAuth 제공자와 통신하고 자체 access JWT와 refresh cookie를 발급한다.
- Spring API는 내부 네트워크에서 FastAPI를 호출한다. FastAPI는 필요할 때 Qdrant를 조회한다.
- 배치 작업은 외부 도서 API에서 자료를 수집·정규화해 PostgreSQL 또는 검색·벡터 인덱스로 적재한다.
- GitLab의 webhook은 Nginx를 거쳐 Jenkins에 전달되어 MR 검증과 `dev` 배포를 시작한다.

## 3. 계정·비밀 자격 정보 관리

외부 서비스 가입 주체, 콘솔 접근자, 앱 callback 등록, 사용 권한과 만료·갱신 책임은 팀 인계 시 확인한다. 실제 외부 인증 정보와 서버 접근 정보는 이 문서와 Git 이력에 넣지 않는다. 새 서버에는 `.env.example`의 설정 형식만 참고해 승인된 비밀 보관 경로에서 값을 주입한다.

## 4. SSAFY GitLab과 Jenkins

### GitLab 프로젝트

| 항목 | 기준 |
| --- | --- |
| 프로젝트 | https://lab.ssafy.com/s15-bigdata-recom-sub1/S15P21B102 (비공개) |
| 브랜치 트리거 | Merge Request와 dev push |
| webhook | https://j15b102.p.ssafy.io/gitlab-webhook/post |
| 이벤트 | Merge Request, dev 대상 push. SSL 검증 활성화 |
| checkout | Jenkins가 저장소를 가져와 MR 대상 병합 상태와 dev release를 검증 |

개발자는 저장소 프로젝트 멤버로 초대한다. Jenkins checkout과 commit status 갱신에는 서로 다른 최소 권한의 프로젝트 범위 접근을 쓴다. 상태 갱신 권한은 SSAFY GitLab의 보호 브랜치 정책에 맞춰야 하며, 권한을 과도하게 넓히지 않는다. webhook은 Jenkins에서 자동 등록하지 않고 GitLab 프로젝트 설정에서 한 번 등록해 중복을 피한다.

### Jenkins 작업

Jenkins는 EC2 호스트의 systemd 서비스이며 멀티브랜치 job 이름은 b102다. MR-*와 dev를 처리하고 일반 브랜치 push는 job 이름 필터에서 제외한다. MR 빌드는 dev에 MR head를 합친 결과를 검증한다.

| 검증 대상 | 실행 환경·내용 |
| --- | --- |
| Frontend | Node 24 컨테이너에서 npm ci, lint, production build |
| Backend | Temurin JDK 21 컨테이너, 임시 PostgreSQL·Elasticsearch를 띄운 뒤 Gradle test |
| AI | Python 3.12 컨테이너에서 패키지 설치·pytest |
| Data | Python 3.12 컨테이너에서 API 수집기 단위 검사 |
| Deploy | shell syntax, ShellCheck, Compose render, Python compile |

변경 경로에 따라 필요한 컴포넌트만 검증하고, MR이 검증한 commit과 dev merge 결과가 같으면 검증을 재사용할 수 있다. Frontend·AI·data·deploy 검증은 병렬 처리하고 backend는 운영 서버 자원 보호를 위해 뒤에서 단독 실행한다. 빌드 가능한 메모리가 부족하면 CI는 시작 전에 중단한다.

CD는 Jenkins의 deploy (dev) stage가 수행한다. /etc/b102/cd-enabled가 있을 때만 dev의 SHA를 배포하고, 없으면 CI 성공으로 끝낸다. 배포 시 작업공간의 SHA를 사용해 Compose 이미지를 만들고 deploy/scripts/deploy.sh로 전달한다. Jenkins UI는 외부에 게시하지 않으며 운영자가 SSH tunnel을 통해 접근한다. Jenkins 사용자가 Docker 그룹에 속하면 호스트 root 수준 권한을 갖게 되므로 저장소에 Jenkinsfile을 변경할 수 있는 인원은 신뢰된 팀원으로 제한한다.

## 5. SSAFY EC2와 공개 진입점

| 항목 | 저장소에 기록된 운영값 |
| --- | --- |
| 주소 | j15b102.p.ssafy.io |
| OS·규격 | Ubuntu 24.04, 4 vCPU, 16 GiB RAM, 309 GB |
| 서비스 | HTTPS 443, HTTP 80, SSH 22 |
| 웹 health | https://j15b102.p.ssafy.io/nginx-health |
| 내부 API health | 127.0.0.1:18080/actuator/health/readiness |
| 배포·백업 상태 | /var/lib/b102 및 /var/lib/b102/backups |

운영 서비스와 정보나루·카카오 수집기는 같은 EC2에 있지만, 수집기는 database/_pipeline/deploy/의 별도 systemd 작업으로 관리한다. 컨테이너 외부에서 공개되는 서비스 진입점은 Nginx 80·443이다. PostgreSQL, Elasticsearch, Qdrant, Spring 관리 포트는 host loopback에만 게시하며 FastAPI는 Compose network 안에만 노출한다.

Nginx는 /api/v1/, /swagger-ui/, /v3/api-docs를 backend로 전달하고 나머지 경로는 SPA에 제공한다. TLS는 Let's Encrypt webroot challenge 방식이며 인증서 발급 후 TLS_ENABLED를 켠다. 저장소에는 매일 백업과 인증서 갱신 작업이 정의되어 있다. 실제 DNS·보안 그룹·인증서 만료 상태는 인계 시 운영 담당자가 확인한다.

Compose 기본 메모리 제한은 web 128 MiB, backend 1536 MiB, AI 1 GiB, PostgreSQL 3 GiB, Elasticsearch 4 GiB다. Qdrant는 선택 profile이지만 Jenkins 자동 배포 명령은 recsys profile을 전달하고 5 GiB 제한을 쓴다. 서버는 16 GiB라 Jenkins build와 수집기 작업이 겹치면 CI 메모리 가드가 빌드를 제한할 수 있다.

## 6. 로그인 제공자

### 카카오 로그인

- 인가·토큰 교환·사용자 정보 조회는 카카오 OAuth endpoint를 사용한다.
- 운영 callback 등록 기준은 https://j15b102.p.ssafy.io/api/v1/auth/oauth/kakao/callback 이다.
- 서비스에는 카카오 회원 식별자만 사용하며 별도 프로필 동의 항목을 요구하지 않는 설정이다.
- 새 사용자는 OAuth 성공 때 생성되고 온보딩 대기 상태가 된다.

### Google 로그인

- Google OpenID Connect로 사용자 subject를 확인한다.
- 운영 callback 등록 기준은 https://j15b102.p.ssafy.io/api/v1/auth/oauth/google/callback 이다.
- 요청 scope는 openid이며 앱은 로그인 제공자의 access token을 서비스 DB에 보관하지 않는다.

### 브라우저 로그인 흐름

1. Frontend가 Spring의 /api/v1/auth/oauth/{provider}/authorize로 전체 페이지 이동한다.
2. Backend가 state를 만들고 HttpOnly cookie에 넣은 뒤 제공자 로그인으로 redirect한다.
3. 제공자가 callback에 code와 state를 보내면 서버가 cookie와 state를 비교하고 사용자 subject를 확인한다.
4. 성공 시 자체 access JWT를 fragment로 포함한 /oauth/callback으로 이동시키고, refresh cookie를 설정한다. Frontend callback은 access token을 메모리 상태에 저장한 뒤 주소 fragment를 지운다.
5. access JWT는 운영 기본 15분, refresh token은 14일 절대 만료다. refresh token은 HttpOnly·Secure·SameSite=Lax cookie이며 회전·재사용 감지를 적용한다.
6. 로그인 실패나 state 검증 실패는 랜딩 화면의 OAuth 오류 상태로 돌아간다.

OAuth console에는 실제 운영 도메인, 위 callback path, 개발 local callback 주소를 환경별로 등록해야 한다. OAuth client 등록 변경은 인증 담당자가 관리한다.

## 7. SSAFY GMS

GMS는 운영 사용자 요청을 직접 처리하는 추천 서버가 아니라, 오프라인 embedding·도서 태그 생성 작업에서 사용한다.

| 작업 | GMS route | 모델 설정 예 | 결과 저장·사용 |
| --- | --- | --- | --- |
| 도서 텍스트 embedding | /gmsapi/api.openai.com/v1/embeddings | text-embedding-3-small, 1536 dimensions | 배치가 Qdrant staging index를 만들고 운영 alias로 승격 |
| 도서 태그 생성 | /gmsapi/api.openai.com/v1/chat/completions | gpt-4o-mini | 태그 sidecar를 만들고 배치 검증 후 Qdrant tag payload·index에 반영 |

기본 endpoint prefix는 https://gms.ssafy.io/gmsapi/api.openai.com 이다. 배치에서는 요청 묶음 크기, timeout, 규칙 태그 confidence threshold, 캐시와 예상 사용량 상한을 조절한다. 규칙이 충분히 확신하는 도서는 외부 호출을 건너뛸 수 있다. endpoint 정책·허용 모델·사용량 한도는 작업 전에 SSAFY GMS 운영 공지를 확인한다.

온라인 추천 요청 흐름은 Backend → 내부 FastAPI → Qdrant이며, 일반 사용자 요청마다 위 GMS endpoint를 호출하는 구조가 아니다. 활성 Qdrant index가 없으면 AI API는 명시적인 fallback 응답을 반환한다.

## 8. 도서 데이터 제공처와 실제 사용 범위

| 제공처 | endpoint 또는 API | 프로젝트 내 데이터 역할 |
| --- | --- | --- |
| 국립중앙도서관 | ISBN 서지정보 API | ISBN 기반 판본·서지 Master Catalog의 원천 |
| 도서관 정보나루 | data4library.kr/api/srchDtlList 및 대출 관련 API | 서지 결측 보완, 대출 수요·함께 대출된 도서 자료. 서지 보강 호출의 loaninfoYN=N은 대출 통계를 의미하지 않음 |
| 카카오 책 검색 | https://dapi.kakao.com/v3/search/book | 소개·표지·ISBN 정보 보강. 검색어 기반 자료는 편향을 보존해 해석 |
| YES24 | https://apis.yes24.com/v1/goods/itemDetail | ISBN별 표지·상품 소개·목차·쪽수·출간 정보 보강 |
| 알라딘 | https://www.aladin.co.kr/ttb/api/ | 검색·목록·ISBN 단건 상세의 추가 서지·커버 자료. 확장 상세값의 결측이 높아 보조 소스로 취급 |
| Google Books | https://www.googleapis.com/books/v1/volumes | 한국어 책 설명 확보율을 조사한 수집·평가용 소스. 현재 최종 Catalog 보강 우선순위에서는 제외 판단 유지 |

최종 데이터 정책은 국립중앙도서관과 정보나루의 ISBN13 합집합을 L0 Catalog로 두고, YES24·알라딘·카카오를 보강 자료로 쓴다. 대출 수요는 정보나루 월별 스냅샷과 별도 원장 입력으로 계산하며 판매량·온라인 평점을 공공 대출량으로 해석하지 않는다. ISBN13이 주요 JOIN 기준이다.

제공처별 API 사용·필드 매핑·결측 및 중복 처리 기준은 다음 저장소 문서가 상세 기준이다.

- database/국립중앙도서관/NATIONAL_LIBRARY_ISBN_API.md
- database/정보나루/DATA4LIBRARY_API.md
- database/카카오/KAKAO_BOOK_SEARCH_API.md
- database/yes24/YES24_API.md
- database/알라딘/ALADIN_OPENAPI.md
- database/google_books/GOOGLE_BOOKS_API.md
- database/API_DATA_STANDARD.md

대용량 원본과 정제 결과는 Git에 넣지 않고 저장소 밖 project_personal/ 또는 서버 pipeline_data 경로에 둔다. 각 provider의 rate limit과 이용 조건은 재수집 전에 제공처 공식 안내를 확인한다.

## 9. 미사용 또는 자체 운영 서비스

- Redis는 기술 검토 문서에 선택 cache로 등장하지만 현재 운영 Compose에는 없다.
- PostgreSQL·Elasticsearch·Qdrant는 외부 SaaS 계정이 아니라 EC2의 자체 Compose 서비스다.
- 소셜 로그인 외 별도의 결제·지도 SaaS 연동은 현재 기능 경로에서 확인되지 않는다.
- Jenkins는 서비스 이용자 데이터 처리 서비스가 아니라 GitLab CI/CD를 보완하는 호스트 자동화 서비스다.

## 10. 계정·운영 인계

| 인계 항목 | 확인할 내용 |
| --- | --- |
| GitLab | 비공개 저장소 접근자, webhook 소유자, CI 상태 갱신 권한 |
| Jenkins | 관리자와 복구 담당, SSH tunnel 경로, CD gate 변경 승인자 |
| EC2·DNS | 서버 접속 담당, 보안 그룹·UFW, 도메인 소유자 |
| OAuth | 카카오·Google 앱 소유자, 등록된 origin/callback, 운영 변경 절차 |
| GMS·도서 API | 승인 계정, 모델·쿼터, rate limit, 호출비 관리 담당 |
| 데이터 | 원본 파일 외부 경로, 적재 시각, 출처·재배포 조건 |
| 복구 | 백업 접근 담당, 보존 기간, 복구 승인 및 실제 restore 절차 |

이 문서는 연동 종류와 책임만 설명한다. 외부 인증값, 계정 비밀번호, webhook 비밀값, 서버 접속 비밀 자료는 문서·Git 이력에 기록하지 않고 운영자가 별도 보호 경로로 인계한다.

## 11. 인계 확인 항목

- [ ] SSAFY GitLab 저장소 접근과 Jenkins webhook 담당자
- [ ] EC2·도메인·DNS·SSH 운영 담당자
- [ ] 카카오 및 Google OAuth 앱의 callback 주소와 소유자
- [ ] GMS 사용 권한과 허용 모델·예산 담당자
- [ ] 국립중앙도서관·정보나루·도서 API 이용 조건과 호출 제한
- [ ] TLS 인증서 갱신 담당자
- [ ] 운영 백업 보관 위치·보존 기간·복구 승인 절차
