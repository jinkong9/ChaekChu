package com.ssafy.b102.recommendation.controller;

import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.b102.global.security.CurrentUserId;
import com.ssafy.b102.global.web.ApiPaths;
import com.ssafy.b102.recommendation.dto.WorldCupPickRequest;
import com.ssafy.b102.recommendation.dto.WorldCupSessionResponse;
import com.ssafy.b102.recommendation.service.BookWorldCupService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@Tag(name = "Book DNA 월드컵", description = "익명 책 소개를 이용하는 서버 저장형 이상형 월드컵")
@RestController
@RequestMapping(ApiPaths.V1 + "/users/me/dna/world-cup/sessions")
public class BookWorldCupController {
	private final BookWorldCupService service;

	public BookWorldCupController(BookWorldCupService service) {
		this.service = service;
	}

	@Operation(summary = "익명 책 월드컵 시작", description = "대출 상위 500권 중 16권을 뽑아 소개문만 반환한다. 제목·저자·표지·ISBN은 우승 전 노출하지 않는다.")
	@PostMapping
	public ResponseEntity<WorldCupSessionResponse> create(@CurrentUserId Long userId) {
		return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.create(userId));
	}

	@Operation(summary = "월드컵 선택", description = "현재 대진의 choiceId를 선택한다. 최종 우승 전까지 익명 소개만 반환하고, 완료 응답에서만 canonical 책 정보를 공개한다.")
	@PostMapping("/{sessionId}/picks")
	public ResponseEntity<WorldCupSessionResponse> pick(@CurrentUserId Long userId,
		@PathVariable UUID sessionId, @Valid @RequestBody WorldCupPickRequest request) {
		return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.pick(userId, sessionId, request));
	}
}
