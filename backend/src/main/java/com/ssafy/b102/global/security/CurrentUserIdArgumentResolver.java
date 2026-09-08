package com.ssafy.b102.global.security;

import org.springframework.core.MethodParameter;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import com.ssafy.b102.global.error.BusinessException;
import com.ssafy.b102.global.error.ErrorCode;

public class CurrentUserIdArgumentResolver implements HandlerMethodArgumentResolver {

	@Override
	public boolean supportsParameter(MethodParameter parameter) {
		return parameter.hasParameterAnnotation(CurrentUserId.class)
			&& Long.class.equals(parameter.getParameterType());
	}

	@Override
	public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
		NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
		Authentication auth = SecurityContextHolder.getContext().getAuthentication();
		if (auth instanceof JwtAuthenticationToken jwt) {
			try {
				return Long.valueOf(jwt.getToken().getSubject());
			}
			catch (NumberFormatException e) {
				throw new BusinessException(ErrorCode.UNAUTHORIZED);
			}
		}
		// permitAll 경로에서 @CurrentUserId 를 붙였을 때만 여기 온다. 인증 경로는 필터가 먼저 401 을 낸다.
		throw new BusinessException(ErrorCode.UNAUTHORIZED);
	}
}
