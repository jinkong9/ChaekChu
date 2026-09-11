import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 로그인 필수 라우트 — 미로그인 시 랜딩으로, 미온보딩 시 온보딩으로.
 *  requireOnboarded=false 면 토큰만 본다 — 온보딩 화면 자체가 이 옵션으로 감싸인다(§9-12: 프로필·취향 POST 가 토큰 없이 나가지 않게). */
export default function ProtectedRoute({ requireOnboarded = true }: { requireOnboarded?: boolean }) {
  const { accessToken, onboarded } = useAuthStore()
  if (!accessToken) return <Navigate to="/" replace />
  if (requireOnboarded && !onboarded) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
