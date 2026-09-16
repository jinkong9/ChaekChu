package com.ssafy.b102.recommendation.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * app.recommendation.dna.* — Book DNA(GET /users/me/dna) 전용 설정. 주소·연결 시간은 RecommendationProperties 를 그대로 쓴다.
 *
 * readTimeout : AI 가 최대 200권을 ISBN 별로 Qdrant 에서 찍으므로 추천(10초)보다 길게 둔다. 기본 15초.
 * cacheTtl    : 저장된 프로필을 서재 지문이 같아도 이 시간이 지나면 다시 계산한다. AI 의 인덱스·태그 버전은 응답에만 실려 와
 *               미리 물을 수 없어, 배치 promote 뒤 프로필이 새 버전을 따라가는 유일한 길이다. 기본 24시간.
 */
@ConfigurationProperties(prefix = "app.recommendation.dna")
public record BookDnaProperties(Duration readTimeout, Duration cacheTtl) {

	public BookDnaProperties {
		readTimeout = readTimeout == null ? Duration.ofSeconds(15) : readTimeout;
		cacheTtl = cacheTtl == null ? Duration.ofHours(24) : cacheTtl;
	}
}
