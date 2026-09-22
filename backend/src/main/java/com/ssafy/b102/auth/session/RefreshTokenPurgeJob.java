package com.ssafy.b102.auth.session;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 만료·폐기·교체된 리프레시 토큰 행을 매일 새벽에 지운다. 계열당 하루 수십 행이 쌓이므로 방치하면 표가 계속 자란다. */
@Component
public class RefreshTokenPurgeJob {

	private static final Logger log = LoggerFactory.getLogger(RefreshTokenPurgeJob.class);

	private final RefreshTokenService service;

	public RefreshTokenPurgeJob(RefreshTokenService service) {
		this.service = service;
	}

	@Scheduled(cron = "0 20 4 * * *", zone = "Asia/Seoul")
	public void purge() {
		try {
			int n = service.purge();
			log.info("리프레시 토큰 정리 rows={}", n);
		}
		catch (RuntimeException e) {
			log.warn("리프레시 토큰 정리 실패: {}", e.toString());
		}
	}
}
