package com.ssafy.b102.recommendation.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.recommendation.dto.BookDnaResponse;
import com.ssafy.b102.recommendation.service.BookDnaService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** BOOK DNA 공개 API. 프론트는 AI 주소가 아닌 백엔드만 호출한다. */
@Tag(name = "Book DNA", description = "사용자 서재 기반 독서 성향 프로필")
@RestController
@RequestMapping(ApiPaths.V1 + "/users/me/dna")
public class BookDnaController {

	private final BookDnaService service;

	public BookDnaController(BookDnaService service) {
		this.service = service;
	}

	@Operation(summary = "내 Book DNA 조회", description = "서재의 READ/WISH·평점·완독일을 AI 프로필로 계산해 반환한다. 프로필은 저장해 두고 서재·관심 태그가 바뀌지 않았으면(24h 안) AI 를 부르지 않는다. AI 장애 시 저장된 마지막 프로필을 generatedAt 그대로 반환하고, 저장된 것이 없을 때만 503 DNA_UNAVAILABLE. books[].analyzed=false 는 AI 인덱스에 없어 계산에서 빠진 책.")
	@GetMapping
	public BookDnaResponse mine(@CurrentUserId Long userId) {
		return service.getMine(userId);
	}
}
