import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'

/** 랜딩 시안 A·B·C가 함께 쓰는 재료. 로그인 분기·제목 넘김·배경 책을 시안마다 복사해 두면
 *  한쪽만 고쳐져 조용히 어긋난다 — 겉모습만 시안별로 다르게 둔다. */

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

/** 제목을 넘기는 자리(index). 롤링(A·B)과 달리 C는 제목과 표지를 함께 바꿔야 해서
 *  DOM 대신 상태로 든다. reduced motion 이면 첫 권에서 멈춘다. */
export function useTitleCycle(length: number) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (length <= 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setIndex((i) => i + 1), 2200)
    return () => clearInterval(timer)
  }, [length])

  // 책이 늦게 도착해 목록이 짧아져도 자리를 벗어나지 않게 여기서 접는다
  return length > 0 ? index % length : 0
}

export type LandingBook = { title: string; coverUrl: string }

/** 랜딩 배경에 쓸 책 — 비로그인이라 인증이 필요한 API 대신 홈 링이 폴백으로 쓰는
 *  정적 스냅샷을 읽는다 (features/popular-ring/usePopularRingData.ts).
 *  세그먼트를 가로질러 한 권씩 집어 한 독자 그룹의 취향으로 화면이 쏠리지 않게 한다.
 *  못 받으면 빈 배열 — 시안은 종이만 남기고 버틴다. */
const SNAPSHOT_URL = '/data/popular-ring.json'

export function useLandingBooks(count: number, maxTitleLength = Number.MAX_SAFE_INTEGER) {
  const [books, setBooks] = useState<LandingBook[]>([])

  useEffect(() => {
    let alive = true
    fetch(SNAPSHOT_URL, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { segments?: { items?: { title?: string, coverUrl?: string }[] }[] }) => {
        if (!alive) return
        const picked: LandingBook[] = []
        const seen = new Set<string>()
        outer: for (let rank = 0; rank < 20; rank++) {
          for (const segment of data.segments ?? []) {
            const item = segment.items?.[rank]
            if (!item?.coverUrl || !item.title || seen.has(item.coverUrl)) continue
            if (item.title.length > maxTitleLength) continue
            seen.add(item.coverUrl)
            picked.push({ title: item.title, coverUrl: item.coverUrl })
            if (picked.length >= count) break outer
          }
        }
        setBooks(picked)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [count, maxTitleLength])

  return books
}
