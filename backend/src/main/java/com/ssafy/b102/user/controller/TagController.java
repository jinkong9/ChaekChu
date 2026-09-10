package com.ssafy.b102.user.controller;

import java.util.Comparator;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.error.ErrorResponse;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.user.dto.TagListResponse;
import com.ssafy.b102.user.repository.TagRepository;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/** API_SPEC §10-0 (1) — 태그 사전 조회. 사전의 주인은 DB(V1_1__seed_tags.sql), 프론트 상수는 사본이다. */
@Tag(name = "태그", description = "관심·추천 태그 사전. 온보딩 장르 선택지와 취향 조절 태그의 원천 목록")
@RestController
@RequestMapping(ApiPaths.V1 + "/tags")
public class TagController {

	private final TagRepository tagRepository;

	public TagController(TagRepository tagRepository) {
		this.tagRepository = tagRepository;
	}

	@Operation(summary = "태그 사전 전체", description = """
		서버가 아는 태그 전부(`tag_code` 순). 온보딩 1단계 장르 선택지는 `kind = GENRE` 12개이고 라벨은 `#소설` 형태다 — 화면에 '#' 없이
		보이려면 프론트가 떼어 쓴다. `POST /users/me/preferences` 의 `genres` 에는 `code`·`label`·'#' 없는 라벨 어느 것이든 보낼 수 있다.
		추천 조절용 태그(THEME·SIGNAL, 예: #신간 #지금뜨는)는 아직 사전에 없어 프론트 SUGGESTED_TAGS 상수를 유지한다 — 추천 구현 때 seed 가 추가되면 이 목록으로 옮긴다.
		하루에 바뀌지 않는 값이라 앱 시작 시 한 번 받아 캐시하면 된다.""")
	@ApiResponses({
		@ApiResponse(responseCode = "200", description = "태그 목록"),
		@ApiResponse(responseCode = "401", description = "UNAUTHORIZED", content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
	})
	@GetMapping
	@Transactional(readOnly = true)
	public TagListResponse list() {
		return new TagListResponse(tagRepository.findAll().stream()
			.sorted(Comparator.comparing(com.ssafy.b102.user.entity.Tag::getCode))
			.map(TagListResponse.Item::from)
			.toList());
	}
}
