package com.ssafy.b102.user.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** API_SPEC §3.3 POST /users/me/preferences. 「건너뛰기」는 빈 배열 두 개로 온다 — 그래도 COMPLETED. */
@Schema(description = "온보딩 2단계 — 초기 취향(관심 장르 + 읽은 책·별점). 빈 배열이어도 온보딩 완료로 처리한다")
public record PreferencesRequest(
	@Schema(description = "관심 장르 0~5개. 온보딩 화면 라벨('소설') 또는 태그 라벨('#소설') 또는 코드('FICTION') 모두 허용, 사전에 없는 값은 무시",
		example = "[\"소설\", \"에세이\", \"과학\"]")
	@Size(max = 5, message = "관심 장르는 최대 5개입니다.")
	List<String> genres,

	@Schema(description = "읽은 책과 별점. 서재에 READ + 완독일 없음(서비스 이전에 읽은 책) + source=ONBOARDING 으로 저장")
	@Valid
	List<BookPick> books
) {

	public PreferencesRequest {
		genres = genres == null ? List.of() : genres;
		books = books == null ? List.of() : books;
	}

	@Schema(description = "고른 책 하나")
	public record BookPick(
		@Schema(description = "도서 식별자(내부 id). 없으면 404 BOOK_NOT_FOUND", example = "88123", requiredMode = Schema.RequiredMode.REQUIRED)
		@NotBlank(message = "bookId 는 필수입니다.")
		String bookId,

		@Schema(description = "별점 1~5 정수. 고른 책마다 필수(계약 §4.1.2)", example = "5", requiredMode = Schema.RequiredMode.REQUIRED)
		@NotNull(message = "별점은 필수입니다.")
		@Min(value = 1, message = "별점은 1~5 입니다.")
		@Max(value = 5, message = "별점은 1~5 입니다.")
		Integer rating
	) {
	}
}
