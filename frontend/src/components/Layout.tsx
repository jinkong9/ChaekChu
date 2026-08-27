import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 공통 GNB 레이아웃 — 메뉴: 추천 / 탐색 / 내 서재 / BOOK DNA(P1) */
export default function Layout() {
  const nickname = useAuthStore((s) => s.nickname)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const cls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'font-bold border-b-2 border-primary' : 'text-gray-500'
  return (
    <div className="min-h-screen bg-cream">
      <header className="flex items-center gap-6 px-8 py-3 border-b-2 border-primary bg-white">
        <Link to="/" className="font-display text-xl text-accent">책추책책추</Link>
        <nav className="flex gap-5">
          <NavLink to="/" end className={cls}>추천</NavLink>
          <NavLink to="/search" className={cls}>탐색</NavLink>
          <NavLink to="/library" className={cls}>내 서재</NavLink>
          <NavLink to="/dna" className={cls}>BOOK DNA</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="w-64 border-2 border-primary rounded-full px-4 py-1.5 text-sm text-gray-400">제목·저자 검색</div>
          <span className="text-sm text-gray-500">{nickname ?? '게스트'}</span>
          <button className="text-sm text-gray-400 underline" onClick={() => { logout(); navigate('/login') }}>로그아웃</button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
