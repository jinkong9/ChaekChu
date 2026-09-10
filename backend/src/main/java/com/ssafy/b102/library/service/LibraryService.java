package com.ssafy.b102.library.service;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.library.dto.LibraryItemResponse;
import com.ssafy.b102.library.dto.LibraryListResponse;
import com.ssafy.b102.library.entity.LibraryItem;
import com.ssafy.b102.library.entity.ShelfStatus;
import com.ssafy.b102.library.repository.LibraryItemRepository;

/** 서재 — API_SPEC §6. 본인 행만 다룬다(userId 는 JWT 에서). */
@Service
public class LibraryService {

	private final LibraryItemRepository libraryItemRepository;

	public LibraryService(LibraryItemRepository libraryItemRepository) {
		this.libraryItemRepository = libraryItemRepository;
	}

	/** §6.1 — status 가 null 이면 전체. updatedAt 내림차순, 페이지 없음. 서재가 비었으면 빈 목록. */
	@Transactional(readOnly = true)
	public LibraryListResponse getMine(Long userId, ShelfStatus status) {
		List<LibraryItem> items = status == null
			? libraryItemRepository.findByUser_IdOrderByUpdatedAtDesc(userId)
			: libraryItemRepository.findByUser_IdAndStatusOrderByUpdatedAtDesc(userId, status);
		return new LibraryListResponse(items.stream().map(LibraryItemResponse::from).toList());
	}
}
