-- V8 — Book DNA 프로필 저장 (2026-09-16). GET /users/me/dna 가 요청마다 FastAPI 를 동기 호출하던 것을,
--      서재가 바뀌지 않았으면 저장된 프로필로 답하고 AI 장애 때는 마지막 프로필을 대신 낸다(BOOK_DNA_API_CONTRACT §5·§6).
--
-- 왜
--   [1] 계약 §6 의 캐시 키(userId + libraryUpdatedAt + 버전들)를 구현할 곳이 없었다. 화면을 열 때마다 AI 가 최대 200권을 Qdrant 에서 다시 찍는다.
--   [2] 계약 §5 「AI 가 503/타임아웃이면 백엔드가 마지막 profile 을 쓴다」— 저장된 것이 없어 지금은 DNA_UNAVAILABLE 만 낸다.
--   [3] 사용자당 1행, 이력 없음. 추천 스냅샷(recommendations)과 달리 「무엇을 보여줬나」를 감사할 대상이 아니라 바뀌면 덮어쓴다.
--
-- library_fingerprint : AI 에 실제로 보낸 스냅샷(ISBN·상태·평점·완독일, ISBN 순) + 관심 태그 코드(정렬) 의 sha256 앞 32자. 서재나 관심사가 바뀌면 달라져 재계산된다.
--                       DB 의 count/max(updated_at) 가 아니라 보낸 것에서 만든다 — 스냅샷을 읽은 뒤 서재가 바뀌어도 옛 목록의 프로필이 새 지문으로 저장되지 않는다.
--                       AI 의 dnaVersion·tagVersion 은 응답에만 실려 와 미리 알 수 없으므로 버전 변경은 TTL(app.recommendation.dna.cache-ttl)로 따라간다.
-- profile             : AI 내부 응답의 profile 객체 그대로(jsonb). 공개 DTO 변환은 백엔드(BookDnaService)가 한다. 컬럼으로 풀지 않는다 — 읽는 곳이 백엔드 하나다.
-- unresolved_isbns    : AI 인덱스(추천 후보 약 45만 권)에 없어 계산에서 빠진 ISBN13 배열. 공개 응답 books[].analyzed 에 쓴다.
-- generated_at        : AI 가 계산한 시각. 장애 때 대신 낼 때도 이 값을 그대로 보내 프론트가 오래됨을 안다.

CREATE TABLE user_dna_profiles (
    user_id             BIGINT       NOT NULL,
    library_fingerprint VARCHAR(64)  NOT NULL,
    request_id          VARCHAR(128) NOT NULL,
    dna_version         VARCHAR(64)  NOT NULL,
    model_version       VARCHAR(128) NOT NULL,
    index_version       VARCHAR(128) NOT NULL,
    tag_version         VARCHAR(128) NOT NULL,
    profile             JSONB        NOT NULL,
    unresolved_isbns    JSONB        NOT NULL DEFAULT '[]'::jsonb,
    generated_at        TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_udp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
