package com.ssafy.b102.library.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

/** API_SPEC §6.2 POST /library — 두 필드만 받는다(09-10 확정). 별점·감상은 응답의 libraryItemId 로 PATCH. */
@Schema(description = "서재에 담기 (POST /library)")
public record LibraryAddRequest(
	@Schema(description = "도서 식별자(내부 id). 없으면 404 BOOK_NOT_FOUND", example = "88123", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "bookId 는 필수입니다.")
	String bookId,

	@Schema(description = "WISH(찜) | READ(읽음). 대소문자 무관. READ 면 완독일을 오늘(Asia/Seoul)로 채운다", allowableValues = {"WISH", "READ"}, example = "WISH", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "status 는 필수입니다.")
	String status
) {
}
