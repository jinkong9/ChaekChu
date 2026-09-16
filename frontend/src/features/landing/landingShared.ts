import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'

/** 랜딩이 쓰는 재료 — 로그인 분기와 롤링 제목. 로그인 분기는 dev 의 랜딩에 있던 것을
 *  그대로 옮겨 온 것이라 동작이 같아야 한다. */

/** 책 제목은 겹화살괄호로 감싼다 — 겹낫표(『』)도 규정상 맞지만, 표지에 크게 찍으면
 *  여는 기호가 'ㅋ'으로 읽힌다. 둘 다 문장부호 규정이 책 제목에 인정하는 기호다. */
export const LANDING_TITLES = ['《데미안》', '《노르웨이의 숲》', '《아몬드》', '《1984》', '《채식주의자》',
  '《어린 왕자》', '《파친코》', '《미드나잇 라이브러리》', '《물고기는 존재하지 않는다》', '《불편한 편의점》']

/** OAuth — 응답의 onboarded로 신규/기존 자동 분기 (mock: kakao=신규, google=기존).
 *  실 서버 모드에서는 authorize URL로 리다이렉트 — LoginPage(이어진님)의 startOAuth 패턴과 동일 */
export function useLandingOAuth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const login = useAuthStore((s) => s.login)
  const oauthFailed = searchParams.get('error') === 'oauth_failed'

  const oauth = async (provider: 'kakao' | 'google') => {
    if (import.meta.env.VITE_ENABLE_MSW === 'true') {
      const res = await api.get(`/auth/oauth/${provider}/authorize`)
      login(res.data.accessToken, res.data.nickname, res.data.onboarded)
      navigate(res.data.onboarded ? '/home' : '/onboarding')
      return
    }
    const baseUrl = (api.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
    window.location.assign(`${baseUrl}/auth/oauth/${provider}/authorize`)
  }

  return { oauth, oauthFailed }
}

/** 롤링 책 제목 — 첫 항목을 끝에 복제해 무한 루프, 복제 도달 시 transition 끄고 순간 리셋.
 *  step은 시안 CSS의 한 칸 높이와 같은 CSS 길이여야 한다 ('1.42em', 'var(--창-높이)' 등).
 *  어긋나면 글자가 칸에 반씩 걸린다. */
export function useRollingTitles(step: string) {
  const ulRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const ul = ulRef.current
    if (!ul || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let idx = 0
    const timer = setInterval(() => {
      idx++
      ul.style.transform = `translateY(calc(${step} * ${-idx}))`
      if (idx === LANDING_TITLES.length) {
        setTimeout(() => {
          ul.style.transition = 'none'
          ul.style.transform = 'translateY(0)'
          idx = 0
          requestAnimationFrame(() => requestAnimationFrame(() => { ul.style.transition = '' }))
        }, 700)
      }
    }, 2200)
    return () => clearInterval(timer)
  }, [step])

  return ulRef
}
