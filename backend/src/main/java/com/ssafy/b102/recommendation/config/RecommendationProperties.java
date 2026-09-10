package com.ssafy.b102.recommendation.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 백엔드가 호출하는 FastAPI 연결 설정. 운영에서는 AI_RECOMMENDATION_URL=http://ai:8000 을 주입한다. */
@ConfigurationProperties(prefix = "app.recommendation")
public record RecommendationProperties(
	String url,
	Duration connectTimeout,
	Duration readTimeout,
	Integer defaultSize,
	Integer maxSize
) {

	public RecommendationProperties {
		url = url == null || url.isBlank() ? "http://localhost:8000" : url;
		connectTimeout = connectTimeout == null ? Duration.ofSeconds(2) : connectTimeout;
		readTimeout = readTimeout == null ? Duration.ofSeconds(10) : readTimeout;
		defaultSize = defaultSize == null ? 5 : defaultSize;
		maxSize = maxSize == null ? 10 : maxSize;
	}
}
