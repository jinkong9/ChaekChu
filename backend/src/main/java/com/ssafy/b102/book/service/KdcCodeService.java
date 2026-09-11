package com.ssafy.b102.book.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.book.dto.KdcCodeResponse;
import com.ssafy.b102.book.dto.KdcListResponse;
import com.ssafy.b102.book.repository.KdcCodeRepository;
import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;

/**
 * API_SPEC §4.7 — KDC 분류 사전. 검색의 `kdc` 필터에 넣을 코드와 화면에 쓸 이름을 준다.
 *
 * `depth` 와 `parent` 는 함께 쓰지 않는다 — 둘은 다른 질문이다("그 단계 전체" vs "이 코드의 자식"). 둘 다 오면 400.
 * 둘 다 없으면 전체 949행을 준다(약 60KB). 프론트는 보통 depth=1 로 시작해 토큰을 펼칠 때 parent 로 한 단계씩 내려간다.
 */
@Service
public class KdcCodeService {

	/** 코드는 1~3자리 숫자. 자릿수가 곧 depth 라 그 밖의 값은 사전에 없다. */
	private static final Pattern CODE = Pattern.compile("^\\d{1,3}$");
	static final int MIN_DEPTH = 1;
	static final int MAX_DEPTH = 3;

	private final KdcCodeRepository repository;

	public KdcCodeService(KdcCodeRepository repository) {
		this.repository = repository;
	}

	@Transactional(readOnly = true)
	public KdcListResponse find(Integer depth, String rawParent) {
		String parent = rawParent == null ? "" : rawParent.trim();
		validate(depth, parent);

		List<KdcCodeResponse> items;
		if (!parent.isEmpty()) {
			items = repository.findByParent(parent);
		} else if (depth != null) {
			items = repository.findByDepth(depth);
		} else {
			items = repository.findAll();
		}
		return new KdcListResponse(items);
	}

	private static void validate(Integer depth, String parent) {
		List<Map<String, String>> fields = new ArrayList<>();
		if (depth != null && !parent.isEmpty()) {
			fields.add(field("depth", "depth 와 parent 는 함께 쓸 수 없습니다. 한 단계 전체는 depth, 어떤 코드의 자식은 parent 로 물어 주세요."));
		}
		if (depth != null && (depth < MIN_DEPTH || depth > MAX_DEPTH)) {
			fields.add(field("depth", "depth 는 1(대분류) · 2(중분류) · 3(소분류) 입니다."));
		}
		if (!parent.isEmpty() && !CODE.matcher(parent).matches()) {
			fields.add(field("parent", "parent 는 1~3자리 숫자 코드입니다(예: 8 · 81)."));
		}
		if (!fields.isEmpty()) {
			throw new BusinessException(ErrorCode.VALIDATION_FAILED, Map.of("fields", fields));
		}
	}

	/** LinkedHashMap — 응답 JSON 의 키 순서를 {field, reason} 으로 고정한다(GlobalExceptionHandler 와 동일). */
	private static Map<String, String> field(String field, String reason) {
		Map<String, String> entry = new LinkedHashMap<>();
		entry.put("field", field);
		entry.put("reason", reason);
		return entry;
	}
}
