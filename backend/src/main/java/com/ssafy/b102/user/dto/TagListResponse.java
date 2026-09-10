package com.ssafy.b102.user.dto;

import java.util.List;

import com.ssafy.b102.user.entity.Tag;

import io.swagger.v3.oas.annotations.media.Schema;

/** API_SPEC §10-0 (1) GET /tags — 태그 사전. 프론트가 GENRES·SUGGESTED_TAGS 하드코딩을 서버 목록으로 바꿀 때 쓴다. */
@Schema(description = "태그 사전 (GET /tags)")
public record TagListResponse(
	@Schema(description = "tag_code 순. 지금은 온보딩 장르 12개(GENRE). 추천 태그(THEME·SIGNAL)는 추천 구현 때 추가된다")
	List<Item> items
) {

	@Schema(description = "태그 하나")
	public record Item(
		@Schema(description = "불변 코드. POST /users/me/preferences 의 genres 에 그대로 보낼 수 있다", example = "FICTION") String code,
		@Schema(description = "표시명. GET /users/me 의 interestTags 와 같은 형태", example = "#소설") String label,
		@Schema(description = "GENRE | THEME | SIGNAL", example = "GENRE") String kind,
		@Schema(description = "사용자가 직접 고를 수 있는 태그인지. V1 은 전부 true", example = "true") boolean selectable
	) {
		public static Item from(Tag tag) {
			return new Item(tag.getCode(), tag.getLabel(), tag.getKind(), true);
		}
	}
}
