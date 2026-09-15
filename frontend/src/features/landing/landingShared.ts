import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'

/** 랜딩 시안 A·B가 함께 쓰는 재료. 로그인 분기와 롤링 제목을 시안마다 복사해 두면
 *  한쪽만 고쳐져 조용히 어긋난다 — 겉모습만 시안별로 다르게 둔다. */

export const LANDING_TITLES = ['『데미안』', '『노르웨이의 숲』', '『아몬드』', '『1984』', '『채식주의자』',
  '『어린 왕자』', '『파친코』', '『미드나잇 라이브러리』', '『물고기는 존재하지 않는다』', '『불편한 편의점』']

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
 *  lineEm은 시안 CSS의 한 칸 높이(em)와 같아야 한다. 어긋나면 글자가 잘린다. */
export function useRollingTitles(lineEm: number) {
  const ulRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const ul = ulRef.current
    if (!ul || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let idx = 0
    const timer = setInterval(() => {
      idx++
      ul.style.transform = `translateY(${-idx * lineEm}em)`
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
  }, [lineEm])

  return ulRef
}
