import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 공통 GNB 레이아웃 — 메뉴: 홈 / 내 서재 / BOOK DNA / 검색 */
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
  // 활성 메뉴만 잉크색·굵게 + 밑줄, 나머지는 회색
  const cls = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? 'whitespace-nowrap text-primary font-bold underline underline-offset-4 decoration-2'
      : 'whitespace-nowrap text-gray-400 hover:text-primary'
  return (
    // 세로 플렉스 — Outlet이 헤더를 뺀 나머지를 정확히 채운다.
    // 화면 높이를 calc(100vh - 헤더높이)로 빼서 쓰면 헤더 구성이 바뀔 때마다
    // 그 상수가 어긋나 바닥에 배경색 띠가 남는다.
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="flex min-h-[54px] shrink-0 items-center border-b-2 border-primary bg-white px-4 py-2 sm:px-8 sm:py-3">
        <Link to="/home" className="shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-primary sm:text-lg">책추책책추</Link>
        <nav className="ml-4 flex items-center gap-3 text-xs sm:ml-8 sm:gap-6 sm:text-sm">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={(state) => `${m.to === '/dna' ? 'hidden sm:inline' : ''} ${cls(state)}`}>{m.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="hidden text-sm text-gray-500 lg:inline">{nickname ?? '독자'}</span>
          <button className="whitespace-nowrap text-xs text-gray-400 underline sm:text-sm" onClick={() => { logout(); navigate('/') }}>로그아웃</button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
