import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 공통 GNB 레이아웃 — 메뉴: 홈 / 추천 / 내 서재 / BOOK DNA / 검색 */
const MENU = [
  { to: '/home', label: '홈' },
  { to: '/recommend', label: '추천' },
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
    <div className="min-h-screen bg-cream">
      <header className="flex items-center px-8 py-3 border-b-2 border-primary bg-white">
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
