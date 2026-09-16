package com.ssafy.b102.recommendation.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;
import com.ssafy.b102.recommendation.repository.UserDnaProfileRepository;
import com.ssafy.b102.recommendation.repository.UserDnaProfileRepository.LibraryStamp;
import com.ssafy.b102.recommendation.repository.UserDnaProfileRepository.Row;

/**
 * Book DNA 프로필의 저장·조회와 서재 지문 — 계약 §6 캐시 키의 백엔드 구현.
 *
 * 계약의 캐시 키는 「서재 상태 + dnaVersion·indexVersion·tagVersion」인데, AI 의 버전은 응답에만 실려 와서 부르지 않고는 알 수 없다.
 * 그래서 서재 지문(행수 · 마지막 변경 시각 · 관심 태그)이 같고 저장 시각이 TTL 안이면 저장된 프로필을 쓰고,
 * TTL 이 지나면 AI 를 다시 불러 배치 promote 로 바뀐 인덱스·태그 버전을 따라간다.
 * 저장은 REQUIRES_NEW — 부르는 쪽이 읽기 전용 트랜잭션이어도 되고, 저장이 실패해도 응답은 나가야 한다(추천 스냅샷과 같은 이유).
 */
@Service
public class BookDnaProfileStore {

	/** 저장된 프로필 한 건. profile 은 AI 응답의 profile 객체 그대로(null 일 수 있다 — INSUFFICIENT_DATA 를 빈 객체로 준 옛 응답). */
	public record StoredProfile(String fingerprint, String requestId, String dnaVersion, String modelVersion,
		String indexVersion, String tagVersion, AiBookDnaResponse.Profile profile, List<String> unresolvedIsbns,
		Instant generatedAt) {

		public static StoredProfile of(String fingerprint, String requestId, AiBookDnaResponse ai, Instant generatedAt) {
			return new StoredProfile(fingerprint, requestId, orUnknown(ai.dnaVersion()), orUnknown(ai.modelVersion()),
				orUnknown(ai.indexVersion()), orUnknown(ai.tagVersion()), ai.profile(), ai.unresolvedIsbns(), generatedAt);
		}

		/** 서재 지문이 같고 TTL 안이면 AI 를 부르지 않아도 된다. */
		public boolean isFresh(String currentFingerprint, Instant now, Duration ttl) {
			return fingerprint.equals(currentFingerprint) && !generatedAt.plus(ttl).isBefore(now);
		}

		private static String orUnknown(String version) {
			return version == null || version.isBlank() ? "unknown" : version;
		}
	}

	private static final Logger log = LoggerFactory.getLogger(BookDnaProfileStore.class);
	private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
	};

	private final UserDnaProfileRepository repository;
	private final ObjectMapper objectMapper;

	public BookDnaProfileStore(UserDnaProfileRepository repository, ObjectMapper objectMapper) {
		this.repository = repository;
		this.objectMapper = objectMapper;
	}

	/** 서재 지문 — 행수 · 마지막 변경 시각 · 관심 태그(정렬) 의 sha256 앞 32자. 서재나 관심사가 바뀌면 달라진다. */
	public String fingerprint(long userId, List<String> declaredTags) {
		LibraryStamp stamp = repository.libraryStamp(userId);
		String material = stamp.count() + "|" + (stamp.lastUpdatedAt() == null ? "-" : stamp.lastUpdatedAt().toString())
			+ "|" + String.join(",", declaredTags.stream().sorted().toList());
		return sha256Hex(material).substring(0, 32);
	}

	/** 저장된 프로필. 저장 JSON 을 읽을 수 없으면(형식이 바뀐 옛 행) 없는 것으로 보고 경고만 남긴다 — 다시 계산하면 덮어쓴다. */
	public Optional<StoredProfile> find(long userId) {
		Optional<Row> row = repository.find(userId);
		if (row.isEmpty()) {
			return Optional.empty();
		}
		try {
			return Optional.of(toStored(row.get()));
		}
		catch (JsonProcessingException e) {
			log.warn("저장된 Book DNA 프로필을 읽지 못해 다시 계산한다 userId={}: {}", userId, e.getOriginalMessage());
			return Optional.empty();
		}
	}

	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void save(long userId, StoredProfile stored) {
		repository.upsert(userId, new Row(stored.fingerprint(), stored.requestId(), stored.dnaVersion(),
			stored.modelVersion(), stored.indexVersion(), stored.tagVersion(),
			json(stored.profile()), json(stored.unresolvedIsbns()), stored.generatedAt()));
	}

	private StoredProfile toStored(Row row) throws JsonProcessingException {
		AiBookDnaResponse.Profile profile = row.profileJson() == null ? null
			: objectMapper.readValue(row.profileJson(), AiBookDnaResponse.Profile.class);
		List<String> unresolved = row.unresolvedJson() == null ? List.of()
			: objectMapper.readValue(row.unresolvedJson(), STRING_LIST);
		return new StoredProfile(row.fingerprint(), row.requestId(), row.dnaVersion(), row.modelVersion(),
			row.indexVersion(), row.tagVersion(), profile, unresolved, row.generatedAt());
	}

	private String json(Object value) {
		try {
			return objectMapper.writeValueAsString(value);
		}
		catch (JsonProcessingException e) {
			throw new IllegalStateException("Book DNA 프로필을 JSON 으로 바꿀 수 없습니다", e);
		}
	}

	private static String sha256Hex(String material) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			return HexFormat.of().formatHex(digest.digest(material.getBytes(StandardCharsets.UTF_8)));
		}
		catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}
}
