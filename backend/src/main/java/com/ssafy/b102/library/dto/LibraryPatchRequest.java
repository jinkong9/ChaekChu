package com.ssafy.b102.library.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * API_SPEC §6.3 PATCH /library/{libraryItemId} — 부분 갱신. 보낸 필드만 바꾼다.
 * 「키를 안 보냄(유지)」과 「null 을 보냄(지움)」을 구분해야 해서 record 가 아니라 setter 에서 전송 여부를 기록하는 클래스다.
 * 프론트는 JSON.stringify 가 undefined 키를 떨어뜨리므로 바꿀 필드만 넣어 보내면 된다.
 */
@Schema(description = "서재 항목 부분 갱신 (PATCH /library/{libraryItemId}). 키를 빼면 유지, null 을 보내면 지운다(rating·reviewText·finishedDate)")
public class LibraryPatchRequest {

	@Schema(description = "WISH | READ (대소문자 무관). READ 로 바꾸며 finishedDate 가 없으면 오늘(Asia/Seoul), WISH 로 바꾸면 finishedDate=null", allowableValues = {"WISH", "READ"}, example = "READ", nullable = true)
	private String status;

	/**
	 * Integer 가 아니라 String 인 이유: Jackson 이 Integer 필드에 "" 를 null 로 조용히 바꿔(빈 문자열 → 삭제로 오인) 별점이 지워진다.
	 * 문자열로 받아 서비스가 빈 값은 400, 숫자면 1~5 검사. JSON 숫자 4 도 문자열 "4" 로 들어온다.
	 */
	@Schema(description = "별점 1~5 정수. null 이면 삭제", type = "integer", example = "4", nullable = true)
	private String rating;
	private boolean ratingSent;

	@Schema(description = "한 줄 감상 ≤300자. 앞뒤 공백 제거, 빈 문자열·null 이면 삭제", example = "전개가 빠르다.", nullable = true)
	private String reviewText;
	private boolean reviewTextSent;

	@Schema(description = "완독일 yyyy-MM-dd. READ 항목에 한해 반영(WISH 면 무시). null 이면 완독일을 지운다(온보딩 seed 처럼)", example = "2026-09-01", nullable = true)
	private String finishedDate;
	private boolean finishedDateSent;

	public String getStatus() {
		return status;
	}

	public void setStatus(String status) {
		this.status = status;
	}

	public String getRating() {
		return rating;
	}

	@JsonSetter(nulls = Nulls.SET)
	public void setRating(String rating) {
		this.rating = rating;
		this.ratingSent = true;
	}

	@JsonIgnore
	public boolean isRatingSent() {
		return ratingSent;
	}

	public String getReviewText() {
		return reviewText;
	}

	@JsonSetter(nulls = Nulls.SET)
	public void setReviewText(String reviewText) {
		this.reviewText = reviewText;
		this.reviewTextSent = true;
	}

	@JsonIgnore
	public boolean isReviewTextSent() {
		return reviewTextSent;
	}

	public String getFinishedDate() {
		return finishedDate;
	}

	@JsonSetter(nulls = Nulls.SET)
	public void setFinishedDate(String finishedDate) {
		this.finishedDate = finishedDate;
		this.finishedDateSent = true;
	}

	@JsonIgnore
	public boolean isFinishedDateSent() {
		return finishedDateSent;
	}
}
