package com.ssafy.b102.book.controller;

import java.time.Duration;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.book.dto.KdcListResponse;
import com.ssafy.b102.book.service.KdcCodeService;
import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/** API_SPEC §4.7 — KDC 분류 사전. 검색(`GET /books/search?kdc=`)에 넣을 코드와 화면에 쓸 이름을 준다. 로그인 필요(●). */
@Tag(name = "분류 사전", description = """
	KDC 분류 949개(대분류 10 · 중분류 100 · 소분류 839). 원천은 V2 `kdc_codes` 로, 내용이 바뀌지 않는 고정 표다.
	`code` 의 자릿수가 곧 단계이고 그대로 `GET /books/search?kdc=` 에 넣을 수 있다 — `8`(문학) → `81`(한국문학) → `813`(소설).
	검색 결과의 `classNo`("813.62")는 소수점까지라 그대로 쓰면 안 되고, 앞자리만 잘라 쓴다.""")
@RestController
@RequestMapping(ApiPaths.V1 + "/kdc")
public class KdcController {

	/** 고정 표라 하루는 다시 묻지 않아도 된다. 사전이 바뀌는 일은 배포 수준의 사건이다. */
	private static final CacheControl CACHE = CacheControl.maxAge(Duration.ofDays(1)).cachePublic();

	private final KdcCodeService kdcCodeService;

	public KdcController(KdcCodeService kdcCodeService) {
		this.kdcCodeService = kdcCodeService;
	}

	@Operation(summary = "KDC 분류 사전", description = """
		`depth` 와 `parent` 중 하나만 쓴다(둘 다 오면 400, 둘 다 없으면 전체 949행 ≈ 60KB).

		| 쓰임 | 요청 | 결과 |
		| --- | --- | --- |
		| 앱 시작 — 대분류 칩 10개 | `?depth=1` | 총류·철학·…·역사 |
		| 토큰을 펼칠 때 — 그 아래 한 단계 | `?parent=8` | `80`~`89` 중분류 10개 |
		| 더 깊이 | `?parent=81` | `810`~`818` 소분류 |
		| 전체 | (없음) | 949행 |

		소분류(`depth=3`) 코드로 `parent` 를 물으면 자식이 없어 `items: []` 다(404 가 아니다).
		응답에 `Cache-Control: max-age=86400` 이 붙어 브라우저가 하루 동안 다시 묻지 않는다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "분류 목록. code 오름차순, 없으면 items []"),
		@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED — depth 와 parent 동시 사용, depth 가 1~3 밖, parent 가 1~3자리 숫자 아님. details.fields[{field, reason}]", content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping
	public ResponseEntity<KdcListResponse> find(
		@Parameter(description = "1 대분류 · 2 중분류 · 3 소분류. parent 와 함께 쓰지 않는다", example = "1")
		@RequestParam(required = false) Integer depth,
		@Parameter(description = "부모 코드 1~3자리. 그 코드의 자식 한 단계를 준다", example = "8")
		@RequestParam(required = false) String parent) {
		return ResponseEntity.ok().cacheControl(CACHE).body(kdcCodeService.find(depth, parent));
	}
}
