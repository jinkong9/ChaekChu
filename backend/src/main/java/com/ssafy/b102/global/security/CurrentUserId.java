package com.ssafy.b102.global.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 컨트롤러 파라미터에 붙이면 JWT 의 sub(users.id)를 Long 으로 넣어 준다.
 * <pre>public UserMeResponse me(@CurrentUserId Long userId)</pre>
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUserId {
}
