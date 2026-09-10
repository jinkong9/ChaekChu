package com.ssafy.b102.recommendation.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;
import com.ssafy.b102.recommendation.config.RecommendationProperties;
import com.ssafy.b102.recommendation.dto.AiRecommendationRequest;
import com.ssafy.b102.recommendation.dto.AiRecommendationResponse;

/** Spring Boot 컨테이너에서 같은 Compose 네트워크의 FastAPI를 호출하는 어댑터. */
@Component
public class AiRecommendationClient {

	private static final Logger log = LoggerFactory.getLogger(AiRecommendationClient.class);
	private final RestClient restClient;

	public AiRecommendationClient(RestClient.Builder builder, RecommendationProperties properties) {
		SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(properties.connectTimeout());
		requestFactory.setReadTimeout(properties.readTimeout());
		this.restClient = builder.baseUrl(properties.url()).requestFactory(requestFactory).build();
	}

	public AiRecommendationResponse recommend(AiRecommendationRequest request) {
		try {
			AiRecommendationResponse response = restClient.post()
				.uri("/internal/v1/recommendations")
				.body(request)
				.retrieve()
				.body(AiRecommendationResponse.class);
			if (response == null) {
				throw new BusinessException(ErrorCode.RECOMMENDATION_UNAVAILABLE);
			}
			return response;
		}
		catch (BusinessException e) {
			throw e;
		}
		catch (RestClientException e) {
			log.warn("AI 추천 호출 실패 requestId={}: {}", request.requestId(), e.getMessage());
			throw new BusinessException(ErrorCode.RECOMMENDATION_UNAVAILABLE);
		}
	}
}
