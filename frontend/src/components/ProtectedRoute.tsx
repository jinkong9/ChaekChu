import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 로그인 필수 라우트 — 미로그인 시 로그인으로, 미온보딩 시 온보딩으로 */
export default function ProtectedRoute() {
  const { accessToken, onboarded } = useAuthStore()
  if (!accessToken) return <Navigate to="/login" replace />
  if (!onboarded) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
