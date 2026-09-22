package com.ssafy.b102.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §2.3 POST /auth/refresh 응답. 리프레시 토큰은 본문에 없다 — Set-Cookie 로만 간다. */
@Schema(description = "새 액세스 토큰. 프론트는 메모리에만 두고 Authorization: Bearer 로 쓴다")
public record TokenResponse(
	@Schema(description = "서비스 JWT (HS256, sub=userId)", example = "eyJhbGciOiJIUzI1NiJ9…") String accessToken,
	@Schema(description = "액세스 토큰 수명(초). 운영 900", example = "900") long expiresInSeconds
) {
}
