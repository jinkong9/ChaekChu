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
      ? 'text-primary font-bold underline underline-offset-4 decoration-2'
      : 'text-gray-400 hover:text-primary'
  return (
    // 세로 플렉스 — Outlet이 헤더를 뺀 나머지를 정확히 채운다.
    // 화면 높이를 calc(100vh - 헤더높이)로 빼서 쓰면 헤더 구성이 바뀔 때마다
    // 그 상수가 어긋나 바닥에 배경색 띠가 남는다.
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="flex shrink-0 items-center px-8 py-3 border-b-2 border-primary bg-white">
        <Link to="/home" className="text-lg font-bold tracking-tight text-primary">책추책책추</Link>
        <nav className="ml-8 flex items-center gap-6 text-sm">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={cls}>{m.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500">{nickname ?? '독자'}</span>
          <button className="text-sm text-gray-400 underline" onClick={() => { logout(); navigate('/') }}>로그아웃</button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
