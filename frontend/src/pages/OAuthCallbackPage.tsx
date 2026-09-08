import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'

/** AUTH-002 OAuth 콜백 착지 — 서버가 302로 보낸 fragment(#accessToken=…&onboarded=…)를 읽는다.
 *
 *  토큰이 쿼리가 아니라 fragment에 있는 이유: 서버 로그·Referer에 남지 않게 (BE AuthController §2.2).
 *  처리 순서: 파싱 → 저장 → 주소에서 fragment 제거(뒤로가기·새로고침 흔적 방지)
 *  → GET /users/me로 닉네임·온보딩 상태를 서버 기준으로 확정 → 홈/온보딩 분기 */
export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // StrictMode 이중 실행 방지 — 토큰 파싱·이동은 1회만
    ran.current = true

    const params = new URLSearchParams(window.location.hash.slice(1))
    const token = params.get('accessToken')
    const onboarded = params.get('onboarded') === 'true'
    history.replaceState(null, '', window.location.pathname)

    if (!token) {
      navigate('/?error=oauth_failed', { replace: true })
      return
    }
    login(token, null, onboarded)
    api.get('/users/me')
      .then((res) => {
        const me = res.data as { nickname: string | null; onboardingStatus: 'PENDING' | 'COMPLETED' | 'SKIPPED' }
        const done = me.onboardingStatus !== 'PENDING'
        login(token, me.nickname, done)
        navigate(done ? '/home' : '/onboarding', { replace: true })
      })
      .catch(() => {
        // /users/me가 잠깐 실패해도 토큰은 유효할 수 있다 — fragment의 onboarded로 진행
        navigate(onboarded ? '/home' : '/onboarding', { replace: true })
      })
  }, [navigate, login])

  return (
    <main className="eo-page">
      <div className="eo-state">
        <span className="eo-progress" />
        <p className="eo-body">로그인 확인 중</p>
      </div>
    </main>
  )
}
