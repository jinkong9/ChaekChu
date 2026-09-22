package com.ssafy.b102.global.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** @Scheduled 활성화. 지금 쓰는 곳: RefreshTokenPurgeJob(매일 04:20 KST). 테스트 컨텍스트에서도 켜지지만 cron 은 그 시각에만 돈다. */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
