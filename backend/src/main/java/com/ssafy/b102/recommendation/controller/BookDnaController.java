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

	@Operation(summary = "내 Book DNA 조회", description = "서재의 READ/WISH·평점·완독일을 AI 프로필로 계산해 반환한다. AI 장애 시 DNA_UNAVAILABLE을 반환한다.")
	@GetMapping
	public BookDnaResponse mine(@CurrentUserId Long userId) {
		return service.getMine(userId);
	}
}
