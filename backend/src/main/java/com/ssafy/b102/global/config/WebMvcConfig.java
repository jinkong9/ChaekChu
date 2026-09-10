package com.ssafy.b102.global.config;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.ssafy.b102.global.security.CurrentUserIdArgumentResolver;
import com.ssafy.b102.library.entity.ShelfStatus;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
		resolvers.add(new CurrentUserIdArgumentResolver());
	}

	/**
	 * ?status=wish 같은 쿼리 파라미터도 본문과 같은 규칙(ShelfStatus.from — 대소문자 무관)으로 읽는다.
	 * Spring 기본 enum 변환은 대문자만 받아 GET 과 POST/PATCH 가 서로 다른 값을 허용하게 되기 때문.
	 * 모르는 값은 IllegalArgumentException → MethodArgumentTypeMismatchException → 400 VALIDATION_FAILED fields[status].
	 */
	@Override
	public void addFormatters(FormatterRegistry registry) {
		registry.addConverter(String.class, ShelfStatus.class, source -> {
			ShelfStatus status = ShelfStatus.from(source);
			if (status == null) {
				throw new IllegalArgumentException("status 는 WISH 또는 READ 입니다: " + source);
			}
			return status;
		});
	}
}
