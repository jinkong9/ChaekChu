package com.ssafy.b102.auth.session;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.b102.auth.jwt.JwtProperties;
import com.ssafy.b102.auth.session.RefreshTokenService.Issued;
import com.ssafy.b102.auth.session.RefreshTokenService.Rotation;
import com.ssafy.b102.user.entity.OAuthProvider;
import com.ssafy.b102.user.entity.User;
import com.ssafy.b102.user.repository.UserRepository;

/**
 * API_SPEC §2.3 리프레시 토큰 회전·재사용 감지·만료 — 시계를 손으로 돌려 유예(10초)와 절대 만료(14일)를 재현한다.
 * DB 는 실제 PostgreSQL(V12 refresh_tokens), 각 테스트는 롤백.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RefreshTokenServiceTest {

	/** 테스트가 시각을 앉히는 시계. */
	static final class MutableClock extends Clock {
		private Instant now = Instant.parse("2026-09-22T00:00:00Z");

		void advance(Duration d) {
			now = now.plus(d);
		}

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return now;
		}
	}

	@Autowired RefreshTokenRepository repository;
	@Autowired UserRepository userRepository;

	MutableClock clock;
	RefreshTokenService service;
	long userId;

	@BeforeEach
	void setUp() {
		clock = new MutableClock();
		// 유예 10초 · 절대 만료 14일 — 운영 기본값 그대로
		JwtProperties props = new JwtProperties("test-only-secret-not-for-production-0123456789abcdef", 900, 14L * 86_400, 10);
		service = new RefreshTokenService(repository, props, clock);
		User user = userRepository.save(User.fromOAuth(OAuthProvider.KAKAO, "rt-" + System.nanoTime()));
		userId = user.getId();
	}

	@Test
	@DisplayName("발급 → 회전: 새 토큰이 나오고 계열의 절대 만료는 그대로, 옛 토큰은 유예 뒤 재사용하면 계열 전체가 폐기된다")
	void rotate_issuesNewTokenAndDetectsReuseAfterGrace() {
		Issued first = service.issue(userId);
		assertThat(first.token()).hasSizeGreaterThanOrEqualTo(43);          // 32바이트 base64url
		assertThat(first.expiresAt()).isEqualTo(clock.instant().plus(Duration.ofDays(14)));

		clock.advance(Duration.ofMinutes(15));
		Rotation r1 = service.rotate(first.token()).orElseThrow();
		assertThat(r1.userId()).isEqualTo(userId);
		Issued second = r1.issued().orElseThrow();
		assertThat(second.token()).isNotEqualTo(first.token());
		assertThat(second.expiresAt()).isEqualTo(first.expiresAt());        // 회전해도 절대 만료는 고정

		// 유예(10초)를 넘겨 옛 토큰이 다시 오면 도용 — 계열 폐기, 새 토큰도 함께 죽는다
		clock.advance(Duration.ofSeconds(11));
		assertThat(service.rotate(first.token())).isEmpty();
		assertThat(service.rotate(second.token())).isEmpty();
	}

	@Test
	@DisplayName("회전 직후 유예 안의 옛 토큰 재사용은 탭 경합 — 액세스 토큰은 주되 새 쿠키는 없고, 새 토큰은 계속 유효하다")
	void rotate_withinGrace_isTolerated() {
		Issued first = service.issue(userId);
		Issued second = service.rotate(first.token()).orElseThrow().issued().orElseThrow();

		clock.advance(Duration.ofSeconds(9));
		Optional<Rotation> replay = service.rotate(first.token());
		assertThat(replay).isPresent();
		assertThat(replay.get().userId()).isEqualTo(userId);
		assertThat(replay.get().issued()).isEmpty();                        // 쿠키는 다른 탭이 이미 받았다

		// 계열은 살아 있다 — 현재 토큰으로 정상 회전
		assertThat(service.rotate(second.token())).isPresent();
	}

	@Test
	@DisplayName("절대 만료(14일)가 지나면 회전해 온 토큰이라도 거부한다")
	void rotate_afterAbsoluteExpiry_rejected() {
		Issued first = service.issue(userId);
		clock.advance(Duration.ofDays(13));
		Issued second = service.rotate(first.token()).orElseThrow().issued().orElseThrow();
		clock.advance(Duration.ofDays(1).plusSeconds(1));
		assertThat(service.rotate(second.token())).isEmpty();
	}

	@Test
	@DisplayName("모르는 값·빈 값·너무 긴 값은 조회 없이 거부")
	void rotate_unknownOrMalformed_rejected() {
		assertThat(service.rotate("nope")).isEmpty();
		assertThat(service.rotate("")).isEmpty();
		assertThat(service.rotate(null)).isEmpty();
		assertThat(service.rotate("x".repeat(200))).isEmpty();
	}

	@Test
	@DisplayName("revoke(로그아웃): 계열 전체 폐기 — 회전 전 토큰도 후 토큰도 다시 못 쓴다. 모르는 토큰은 조용히 지나간다")
	void revoke_killsWholeFamily() {
		Issued first = service.issue(userId);
		Issued second = service.rotate(first.token()).orElseThrow().issued().orElseThrow();

		service.revoke(second.token());
		assertThat(service.rotate(second.token())).isEmpty();
		assertThat(service.rotate(first.token())).isEmpty();
		service.revoke("unknown-token");                                    // 예외 없음
	}

	@Test
	@DisplayName("로그인 두 번 = 계열 두 개 — 한쪽을 폐기해도 다른 기기의 세션은 산다")
	void families_areIndependent() {
		Issued phone = service.issue(userId);
		Issued laptop = service.issue(userId);
		service.revoke(phone.token());
		assertThat(service.rotate(phone.token())).isEmpty();
		assertThat(service.rotate(laptop.token())).isPresent();
	}

	@Test
	@DisplayName("purge: 만료됐거나 폐기·교체 뒤 하루 지난 행만 지운다 — 현재 토큰과 방금 교체된 행은 남는다")
	void purge_deletesOnlyStaleRows() {
		Issued first = service.issue(userId);
		Issued second = service.rotate(first.token()).orElseThrow().issued().orElseThrow();   // first 는 교체됨(방금)
		Issued other = service.issue(userId);
		service.revoke(other.token());                                                          // other 는 폐기됨(방금)

		assertThat(service.purge()).isZero();                                                   // 전부 하루 안

		clock.advance(Duration.ofDays(1).plusMinutes(1));
		int deleted = service.purge();
		assertThat(deleted).isEqualTo(2);                                                       // first(교체) · other(폐기)
		assertThat(service.rotate(second.token())).isPresent();                                  // 현재 토큰은 살아 있다
	}
}
