package com.ssafy.b102.recommendation.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.recommendation.config.BookDnaProperties;
import com.ssafy.b102.recommendation.config.RecommendationProperties;
import com.ssafy.b102.recommendation.dto.AiBookDnaRequest;
import com.ssafy.b102.recommendation.dto.AiBookDnaResponse;

/**
 * 같은 Compose 네트워크의 FastAPI Book DNA endpoint를 호출하는 어댑터.
 * read timeout 은 추천과 따로 둔다(app.recommendation.dna.read-timeout) — 최대 200권을 ISBN 별로 Qdrant 에서 찍어 더 오래 걸린다.
 */
@Component
public class AiBookDnaClient {

	private static final Logger log = LoggerFactory.getLogger(AiBookDnaClient.class);
	private final RestClient restClient;

	public AiBookDnaClient(RestClient.Builder builder, RecommendationProperties properties, BookDnaProperties dnaProperties) {
		SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(properties.connectTimeout());
		requestFactory.setReadTimeout(dnaProperties.readTimeout());
		this.restClient = builder.baseUrl(properties.url()).requestFactory(requestFactory).build();
	}

	public AiBookDnaResponse profile(AiBookDnaRequest request) {
		try {
			AiBookDnaResponse response = restClient.post()
				.uri("/internal/v1/dna/profile")
				.body(request)
				.retrieve()
				.body(AiBookDnaResponse.class);
			if (response == null) {
				throw new BusinessException(ErrorCode.DNA_UNAVAILABLE);
			}
			return response;
		}
		catch (BusinessException e) {
			throw e;
		}
		catch (RestClientException e) {
			log.warn("AI Book DNA 호출 실패 requestId={}: {}", request.requestId(), e.getMessage());
			throw new BusinessException(ErrorCode.DNA_UNAVAILABLE);
		}
	}
}
