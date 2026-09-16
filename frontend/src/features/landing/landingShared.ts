import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'

/** 랜딩이 쓰는 재료 — 로그인 분기와 롤링 제목. 로그인 분기는 dev 의 랜딩에 있던 것을
 *  그대로 옮겨 온 것이라 동작이 같아야 한다. */

/** 스냅샷을 못 읽었을 때 쓰는 제목. 화면이 비는 것보다 낫다 —
 *  기호 없이 제목만 둔다(지면에서 제목 자체가 가장 큰 글자라 따로 감쌀 필요가 없다). */
const FALLBACK_TITLES = ['데미안', '노르웨이의 숲', '아몬드', '1984', '채식주의자',
  '어린 왕자', '파친코', '종의 기원', '불편한 편의점', '소년이 온다']

/** 지금 많이 읽는 책 — 비로그인이라 인증이 필요한 API 대신 홈 링이 폴백으로 쓰는
 *  정적 스냅샷을 읽는다 (features/popular-ring/usePopularRingData.ts).
 *  세그먼트를 가로질러 한 권씩 집어 한 독자 그룹의 취향으로 목록이 쏠리지 않게 한다. */
const SNAPSHOT_URL = '/data/popular-ring.json'

type Snapshot = { segments?: { items?: { title?: string }[] }[] }

/** 스냅샷에서 제목을 고른다. maxLength 는 공백을 포함한 글자 수 — 한 줄에 크게
 *  앉히는 자리라 긴 제목이 들어오면 칸을 넘는다. */
function pickTitles(data: Snapshot, count: number, maxLength: number) {
  const picked: string[] = []
  const seen = new Set<string>()
  // rank 를 바깥에 두어 각 세그먼트의 1위끼리, 2위끼리 차례로 집는다
  outer: for (let rank = 0; rank < 20; rank++) {
    for (const segment of data.segments ?? []) {
      const title = segment.items?.[rank]?.title
      if (!title || title.length > maxLength || seen.has(title)) continue
      seen.add(title)
      picked.push(title)
      if (picked.length >= count) break outer
    }
  }
  return picked
}

export function usePopularTitles(count: number, maxLength: number) {
  const [titles, setTitles] = useState(() => FALLBACK_TITLES.filter((t) => t.length <= maxLength))

  useEffect(() => {
    let alive = true
    fetch(SNAPSHOT_URL, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Snapshot) => {
        const picked = pickTitles(data, count, maxLength)
        // 한 권도 못 건지면 폴백을 그대로 둔다 — 빈 목록이면 띠가 멈춘다
        if (alive && picked.length > 0) setTitles(picked)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [count, maxLength])

  return titles
}

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
 *  step 은 시안 CSS의 한 칸 높이와 같은 CSS 길이여야 한다 ('1.42em', 'var(--창-높이)' 등).
 *  count 는 복제본을 뺀 실제 제목 수 — 목록이 스냅샷으로 늦게 바뀌므로 상수로 두면
 *  그때부터 엉뚱한 자리에서 되감긴다. */
export function useRollingTitles(step: string, count: number) {
  const ulRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const ul = ulRef.current
    if (!ul || count <= 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // 목록이 바뀌면 처음으로 돌려놓고 다시 센다
    let idx = 0
    ul.style.transition = 'none'
    ul.style.transform = 'translateY(0)'
    requestAnimationFrame(() => requestAnimationFrame(() => { ul.style.transition = '' }))

    const timer = setInterval(() => {
      idx++
      ul.style.transform = `translateY(calc(${step} * ${-idx}))`
      if (idx === count) {
        setTimeout(() => {
          ul.style.transition = 'none'
          ul.style.transform = 'translateY(0)'
          idx = 0
          requestAnimationFrame(() => requestAnimationFrame(() => { ul.style.transition = '' }))
        }, 700)
      }
    }, 2200)
    return () => clearInterval(timer)
  }, [step, count])

  return ulRef
}
