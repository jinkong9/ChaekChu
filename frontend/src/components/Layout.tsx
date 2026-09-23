import { Suspense } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'
import { logoutSession } from '../api/session'
import FinishReadModal from './FinishReadModal'
import RouteFallback from './RouteFallback'

/** 공통 GNB 레이아웃 — 메뉴: 홈 / 내 서재 / BOOK DNA / 검색
 *  DESIGN.md Global navigation — 종이 위 한 줄, 화면 전체에서 규칙선은 이 헤더 밑 하나뿐이다.
 *  높이 54px는 홈(popular-ring.css)의 `calc(100svh - 54px)`와 짝이라 바꾸면 모바일 홈이 어긋난다. */
const MENU = [
  { to: '/home', label: '홈' },
  { to: '/library', label: '내 서재' },
  { to: '/dna', label: 'BOOK DNA' },
  { to: '/search', label: '검색' },
]

export default function Layout() {
  const nickname = useAuthStore((s) => s.nickname)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  // 활성 메뉴는 새 색이 아니라 잉크 농도·굵기·2px 밑줄로만 구분한다
  const cls = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap border-b-2 pb-0.5 transition-colors duration-150 ${
      isActive
        ? 'border-ink font-bold text-ink'
        : 'border-transparent text-ink-faint hover:text-ink'
    }`
  return (
    // 세로 플렉스 — Outlet이 헤더를 뺀 나머지를 정확히 채운다.
    // 화면 높이를 calc(100vh - 헤더높이)로 빼서 쓰면 헤더 구성이 바뀔 때마다
    // 그 상수가 어긋나 바닥에 배경색 띠가 남는다.
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex min-h-[54px] shrink-0 items-center border-b border-rule-soft bg-paper px-4 sm:px-7">
        <Link to="/home" className="shrink-0 whitespace-nowrap text-[15px] font-bold tracking-[-0.03em] text-ink sm:text-base">책추책책추</Link>
        <nav className="ml-5 flex items-center gap-4 text-[13px] sm:ml-9 sm:gap-7">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={(state) => `${m.to === '/dna' ? 'hidden sm:inline-block' : ''} ${cls(state)}`}>{m.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <span className="hidden text-[11px] text-ink-muted lg:inline">{nickname ?? '독자'}</span>
          {/* 서버의 리프레시 계열을 먼저 폐기(§2.4) — 그래야 다른 탭·새로고침이 다시 로그인 상태로 살아나지 않는다 */}
          <button className="eo-link" onClick={async () => { await logoutSession(); logout(); navigate('/') }}>로그아웃</button>
        </div>
      </header>
      {/* 라우트 청크를 받는 동안에도 헤더는 남는다 — Routes 바깥에 두면 GNB 까지 사라진다 */}
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      {/* 완독 기록 모달 — 상세·서재 어디서 READ 로 바꿔도 여기 한 곳에서 뜬다 */}
      <FinishReadModal />
    </div>
  )
}
