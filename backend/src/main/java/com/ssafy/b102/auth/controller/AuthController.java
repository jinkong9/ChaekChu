package com.ssafy.b102.auth.controller;

import java.net.URI;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.web.util.UriComponentsBuilder;

import com.ssafy.b102.auth.oauth.OAuthProperties;
import com.ssafy.b102.auth.oauth.OAuthStateCookie;
import com.ssafy.b102.auth.service.OAuthLoginService;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.user.entity.OAuthProvider;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;

/**
 * API_SPEC §2 — OAuth 만 지원(카카오·Google). 자체 가입·비밀번호 없음. 로그아웃 엔드포인트 없음(클라이언트가 토큰 삭제).
 *   GET /auth/oauth/{provider}/authorize → 302 제공자 로그인 화면 (state 는 HttpOnly 쿠키)
 *   GET /auth/oauth/{provider}/callback  → 302 {FRONTEND_ORIGIN}/oauth/callback#accessToken=…&onboarded=…
 *                                          실패는 302 {FRONTEND_ORIGIN}/?error=oauth_failed
 */
@Tag(name = "인증", description = """
	OAuth 로그인만 지원한다(카카오·Google). 자체 회원가입·비밀번호·로그아웃 API 는 없다 — 로그아웃은 클라이언트가 토큰을 지우면 끝.
	최초 OAuth 로그인이 곧 회원가입이며 onboardingStatus=PENDING 으로 생성된다. 이후 모든 API 는 `Authorization: Bearer <accessToken>`.
	서비스 JWT: HS256 · sub=userId · 만료 24시간 · 갱신 토큰 없음(만료 시 재로그인). 만료·위조는 401 → 프론트는 즉시 로그아웃.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/auth/oauth")
public class AuthController {

	private static final Logger log = LoggerFactory.getLogger(AuthController.class);
	static final String CALLBACK_PATH = "/oauth/callback";
	static final String ERROR_QUERY = "oauth_failed";

	private final OAuthLoginService loginService;
	private final OAuthStateCookie stateCookie;
	private final OAuthProperties oauthProps;
	private final String frontendOrigin;

	public AuthController(OAuthLoginService loginService, OAuthStateCookie stateCookie, OAuthProperties oauthProps,
		@Value("${app.frontend-origin}") String frontendOrigin) {
		this.loginService = loginService;
		this.stateCookie = stateCookie;
		this.oauthProps = oauthProps;
		this.frontendOrigin = frontendOrigin;
	}

	@Operation(summary = "OAuth 로그인 시작 — 제공자 로그인 화면으로 302", description = """
		브라우저를 카카오/Google 로그인 화면으로 보낸다. 프론트는 `window.location.assign()` 으로 **전체 페이지 이동**한다(XHR 아님).
		서버가 CSRF 방지용 `state` 를 만들어 HttpOnly 쿠키(`oauth_state`, 10분, Path=/api/v1/auth/oauth)에 심고 같은 값을 제공자에 넘긴다.
		콜백 주소는 `{요청 origin}/api/v1/auth/oauth/{provider}/callback` — 제공자 콘솔에 등록된 값과 글자 단위로 같아야 한다.
		Swagger 의 Try it out 은 302 를 따라가므로 여기서는 동작 확인용으로만 쓰고, 실제 로그인은 브라우저 주소창에서 진행한다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "302", description = "Location: 제공자 인가 URL(response_type=code, client_id, redirect_uri, state[, scope]). Set-Cookie: oauth_state", content = @Content),
		@ApiResponse(responseCode = "400", description = "UNSUPPORTED_PROVIDER — provider 가 kakao/google 이 아님. details.provider 에 받은 값", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@SecurityRequirements
	@GetMapping("/{provider}/authorize")
	public ResponseEntity<Void> authorize(
		@Parameter(description = "OAuth 제공자. `kakao` | `google` (대소문자 무관)", example = "kakao") @PathVariable String provider,
		HttpServletRequest request) {
		OAuthProvider p = parseProvider(provider);
		String state = stateCookie.newState();
		String location = loginService.authorizationUrl(p, redirectUri(p, request), state);
		return ResponseEntity.status(HttpStatus.FOUND)
			.header(HttpHeaders.LOCATION, location)
			.header(HttpHeaders.SET_COOKIE, stateCookie.create(state, request.isSecure()).toString())
			.build();
	}

	@Operation(summary = "OAuth 콜백 — 제공자가 브라우저를 되돌려 보내는 주소 (프론트가 직접 호출하지 않음)", description = """
		처리 순서: ① `state` 파라미터 = `oauth_state` 쿠키 검증 → ② 인가 코드를 제공자 토큰으로 교환 → ③ 제공자 사용자 식별자(카카오 `id` / Google `sub`)로
		사용자 조회, 없으면 **PENDING 상태로 생성(=가입)** → ④ 서비스 JWT 발급 → ⑤ 프론트로 302.

		성공: `302 {FRONTEND_ORIGIN}/oauth/callback#accessToken=<jwt>&onboarded=true|false`
		토큰은 URL **fragment(#)** 에 넣어 서버 로그·Referer 에 남지 않게 한다. 프론트 콜백 페이지가 읽어 저장하고 주소에서 지운 뒤 `GET /users/me` 로 닉네임을 받는다.
		`onboarded` = onboardingStatus != PENDING — false 면 온보딩 화면으로.

		실패(state 불일치·code 없음·사용자가 동의 취소·제공자 통신 실패 등): 전부 `302 {FRONTEND_ORIGIN}/?error=oauth_failed`. 500 을 내지 않는다.
		제공자 access token 은 저장하지 않는다. 닉네임·성별·출생연도도 OAuth 로 받지 않고 온보딩(POST /users/me/profile)에서 입력받는다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "302", description = "성공: Location = {FRONTEND_ORIGIN}/oauth/callback#accessToken=…&onboarded=… / 실패: {FRONTEND_ORIGIN}/?error=oauth_failed. 두 경우 모두 oauth_state 쿠키 삭제(Max-Age=0)", content = @Content),
		@ApiResponse(responseCode = "400", description = "UNSUPPORTED_PROVIDER — provider 가 kakao/google 이 아님", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@SecurityRequirements
	@GetMapping("/{provider}/callback")
	public ResponseEntity<Void> callback(
		@Parameter(description = "OAuth 제공자. `kakao` | `google`", example = "kakao") @PathVariable String provider,
		@Parameter(description = "제공자가 발급한 인가 코드. 1회용, 수 분 내 만료") @RequestParam(required = false) String code,
		@Parameter(description = "authorize 때 서버가 발급한 값. `oauth_state` 쿠키와 같아야 한다") @RequestParam(required = false) String state,
		@Parameter(description = "제공자 오류 코드(예: access_denied — 사용자가 동의 취소). 있으면 실패 리다이렉트") @RequestParam(required = false) String error,
		HttpServletRequest request) {

		OAuthProvider p = parseProvider(provider);
		String clearCookie = stateCookie.clear(request.isSecure()).toString();

		if (error != null) {
			log.warn("OAuth {} 제공자 오류: {}", p, error);
			return redirect(errorLocation(), clearCookie);
		}
		if (code == null || code.isBlank() || state == null || state.isBlank()) {
			log.warn("OAuth {} 콜백에 code/state 없음", p);
			return redirect(errorLocation(), clearCookie);
		}
		String expected = stateCookie.read(request).orElse(null);
		if (expected == null || !expected.equals(state)) {
			log.warn("OAuth {} state 불일치 (cookie={}, param={})", p, expected != null, state.length());
			return redirect(errorLocation(), clearCookie);
		}

		try {
			OAuthLoginService.LoginResult result = loginService.login(p, code, redirectUri(p, request));
			log.info("OAuth {} 로그인 userId={} created={} onboarded={}", p, result.userId(), result.created(), result.onboarded());
			return redirect(successLocation(result), clearCookie);
		}
		catch (RuntimeException e) {
			log.warn("OAuth {} 로그인 실패: {}", p, e.toString());
			return redirect(errorLocation(), clearCookie);
		}
	}

	private static OAuthProvider parseProvider(String raw) {
		return OAuthProvider.fromPath(raw)
			.orElseThrow(() -> new BusinessException(ErrorCode.UNSUPPORTED_PROVIDER,
				Map.of("provider", raw == null ? "" : raw)));
	}

	/** 콜백 주소 = base + /api/v1/auth/oauth/{provider}/callback. base 는 설정값, 없으면 현재 요청의 origin. */
	private String redirectUri(OAuthProvider p, HttpServletRequest request) {
		String base = oauthProps.hasRedirectBaseUrl()
			? oauthProps.redirectBaseUrl().replaceAll("/+$", "")
			: ServletUriComponentsBuilder.fromContextPath(request).build().toUriString();
		return base + ApiPaths.V1 + "/auth/oauth/" + p.pathName() + "/callback";
	}

	private String successLocation(OAuthLoginService.LoginResult r) {
		// 토큰은 fragment(#) 에 — 서버 로그·Referer 에 남지 않는다. JWT 는 base64url 이라 그대로 넣어도 안전하다.
		return UriComponentsBuilder.fromUriString(frontendOrigin)
			.path(CALLBACK_PATH)
			.fragment("accessToken=" + r.accessToken() + "&onboarded=" + r.onboarded())
			.build()
			.toUriString();
	}

	private String errorLocation() {
		return UriComponentsBuilder.fromUriString(frontendOrigin)
			.path("/")
			.queryParam("error", ERROR_QUERY)
			.build()
			.toUriString();
	}

	private static ResponseEntity<Void> redirect(String location, String setCookie) {
		return ResponseEntity.status(HttpStatus.FOUND)
			.location(URI.create(location))
			.header(HttpHeaders.SET_COOKIE, setCookie)
			.build();
	}
}
