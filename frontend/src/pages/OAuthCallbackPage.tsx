import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** AUTH-002 OAuth 콜백 착지 (API_SPEC §2.2·§2.3).
 *
 *  서버 콜백은 302 로 여기 보내면서 HttpOnly 쿠키 `refresh_token` 을 심는다. 토큰은 URL 에서 읽지 않는다 —
 *  App 의 AuthRestore 가 라우트를 그리기 전에 POST /auth/refresh 로 액세스 토큰을 받고 GET /users/me 로 닉네임·온보딩 상태를 맞춰 두므로,
 *  이 화면이 렌더될 때는 스토어가 이미 결정돼 있다. 여기서는 (아직 서버가 붙여 보내는) fragment 를 주소에서 지우고 분기만 한다.
 *  fragment 를 읽지 않는 이유: 링크에 남의 토큰을 심어 보내는 로그인 CSRF 를 막고, 토큰이 URL 에 있을 이유를 없애기 위해서다
 *  (서버가 AUTH_CALLBACK_TOKEN_IN_FRAGMENT=false 로 바꾸면 fragment 자체가 사라진다). */
export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // StrictMode 이중 실행 방지
    ran.current = true

    history.replaceState(null, '', window.location.pathname)
    const { accessToken, onboarded } = useAuthStore.getState()
    if (!accessToken) {
      // 쿠키가 안 심어졌거나(제공자 실패·state 불일치는 서버가 /?error= 로 보낸다) 갱신이 401 — 랜딩에 실패 표시
      navigate('/?error=oauth_failed', { replace: true })
      return
    }
    navigate(onboarded ? '/home' : '/onboarding', { replace: true })
  }, [navigate])

  return (
    <main className="eo-page">
      <div className="eo-state">
        <span className="eo-progress" />
        <p className="eo-body">로그인 확인 중</p>
      </div>
    </main>
  )
}
