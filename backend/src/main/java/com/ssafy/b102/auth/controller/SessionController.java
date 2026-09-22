package com.ssafy.b102.auth.controller;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import com.ssafy.b102.auth.dto.TokenResponse;
import com.ssafy.b102.auth.jwt.JwtTokenProvider;
import com.ssafy.b102.auth.session.RefreshTokenCookie;
import com.ssafy.b102.auth.session.RefreshTokenService;
import com.ssafy.b102.auth.session.RefreshTokenService.Rotation;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;

/**
 * API_SPEC §2.3·§2.4 — 세션 갱신·종료. 둘 다 Bearer 가 아니라 HttpOnly 쿠키(refresh_token)로 인증한다.
 *   POST /auth/refresh → 200 { accessToken, expiresInSeconds } + 회전된 쿠키   (무효면 401 + 쿠키 삭제)
 *   POST /auth/logout  → 204 + 쿠키 삭제, 그 계열의 리프레시 토큰 전부 폐기
 *
 * CSRF: 쿠키가 자동으로 붙는 경로라 SameSite=Lax 에 더해 Origin 헤더를 우리 출처(프론트 origin 또는 요청 자신의 origin)와 대조한다.
 * 브라우저는 POST 에 Origin 을 항상 보내므로, 다른 사이트에서 띄운 요청은 여기서 403 이다. Origin 이 없는 요청(curl 등)은 CSRF 대상이 아니라 통과.
 */
@Tag(name = "인증")
@RestController
@RequestMapping(ApiPaths.V1 + "/auth")
public class SessionController {

	private static final Logger log = LoggerFactory.getLogger(SessionController.class);

	private final RefreshTokenService refreshTokens;
	private final RefreshTokenCookie cookie;
	private final JwtTokenProvider jwt;
	private final String frontendOrigin;

	public SessionController(RefreshTokenService refreshTokens, RefreshTokenCookie cookie, JwtTokenProvider jwt,
		@Value("${app.frontend-origin}") String frontendOrigin) {
		this.refreshTokens = refreshTokens;
		this.cookie = cookie;
		this.jwt = jwt;
		this.frontendOrigin = stripSlash(frontendOrigin);
	}

	@Operation(summary = "액세스 토큰 갱신 — refresh_token 쿠키로 새 JWT 를 받는다", description = """
		액세스 토큰(15분)이 만료되면 프론트가 첫 401 에서 이 API 를 한 번 부르고 실패한 요청을 다시 보낸다. 앱 시작 때도 저장된 토큰 대신 이걸 먼저 부른다.
		Authorization 헤더는 필요 없다. 인증은 로그인 콜백이 심은 HttpOnly 쿠키 `refresh_token` 이다.

		성공: 200 `{ accessToken, expiresInSeconds }` + 새 `refresh_token` 쿠키(회전). 옛 쿠키 값은 즉시 무효가 된다.
		회전 직후 10초 안에 옛 값이 다시 오면(탭 두 개가 동시에 갱신) 액세스 토큰만 내고 쿠키는 그대로 둔다.
		10초를 넘겨 옛 값이 오면 도용으로 보고 그 로그인 계열 전체를 폐기한다 — 정상 사용자도 다시 로그인해야 한다.

		실패(쿠키 없음·모르는 값·폐기·14일 절대 만료·재사용 감지): 401 UNAUTHORIZED + 쿠키 삭제. 프론트는 이때만 로그아웃 처리한다.
		Origin 헤더가 있는데 우리 출처가 아니면 403 FORBIDDEN (CSRF).""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "새 액세스 토큰. Set-Cookie: refresh_token(회전) — 유예 안 재사용이면 Set-Cookie 없음"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED — 리프레시 토큰이 없거나 무효. Set-Cookie: refresh_token 삭제", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "403", description = "FORBIDDEN — Origin 이 우리 출처가 아님", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@SecurityRequirements
	@PostMapping("/refresh")
	public ResponseEntity<?> refresh(HttpServletRequest request) {
		requireOurOrigin(request);
		boolean secure = request.isSecure();
		Optional<String> raw = cookie.read(request);
		Optional<Rotation> rotation = raw.flatMap(refreshTokens::rotate);
		if (rotation.isEmpty()) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
				.header(HttpHeaders.SET_COOKIE, cookie.clear(secure).toString())
				.header("WWW-Authenticate", "Bearer")
				.body(ErrorResponse.of(ErrorCode.UNAUTHORIZED));
		}
		Rotation r = rotation.get();
		ResponseEntity.BodyBuilder ok = ResponseEntity.ok();
		r.issued().ifPresent(issued -> ok.header(HttpHeaders.SET_COOKIE, cookie.create(issued.token(), secure).toString()));
		return ok.body(new TokenResponse(jwt.issue(r.userId()), jwt.ttlSeconds()));
	}

	@Operation(summary = "로그아웃 — 리프레시 토큰 계열 폐기 + 쿠키 삭제", description = """
		`refresh_token` 쿠키의 로그인 계열을 서버에서 폐기하고 쿠키를 지운다. 이후 그 계열로는 갱신할 수 없다.
		이미 발급된 액세스 토큰은 남은 수명(최대 15분)까지는 유효하다 — 프론트가 메모리에서 지우면 끝.
		쿠키가 없거나 모르는 값이어도 204 — 이미 로그아웃된 상태와 구분할 이유가 없다. Authorization 헤더 불필요.""")
	@ApiResponses({
		@ApiResponse(responseCode = "204", description = "폐기 완료. Set-Cookie: refresh_token 삭제", content = @Content),
		@ApiResponse(responseCode = "403", description = "FORBIDDEN — Origin 이 우리 출처가 아님", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@SecurityRequirements
	@PostMapping("/logout")
	public ResponseEntity<Void> logout(HttpServletRequest request) {
		requireOurOrigin(request);
		cookie.read(request).ifPresent(refreshTokens::revoke);
		return ResponseEntity.noContent()
			.header(HttpHeaders.SET_COOKIE, cookie.clear(request.isSecure()).toString())
			.build();
	}

	/** Origin 이 있으면 프론트 origin 또는 이 요청 자신의 origin 이어야 한다(Swagger 처럼 백엔드와 같은 출처에서 부르는 경우). */
	private void requireOurOrigin(HttpServletRequest request) {
		String origin = request.getHeader(HttpHeaders.ORIGIN);
		if (origin == null || origin.isBlank() || "null".equals(origin)) {
			return;
		}
		String candidate = stripSlash(origin);
		String self = stripSlash(ServletUriComponentsBuilder.fromRequestUri(request).replacePath(null).replaceQuery(null)
			.build().toUriString());
		if (candidate.equalsIgnoreCase(frontendOrigin) || candidate.equalsIgnoreCase(self)) {
			return;
		}
		log.warn("세션 API 에 다른 출처의 요청 origin={}", candidate.replaceAll("[\\p{Cntrl}]", "_"));
		throw new BusinessException(ErrorCode.FORBIDDEN);
	}

	private static String stripSlash(String s) {
		return s == null ? "" : s.replaceAll("/+$", "");
	}
}
