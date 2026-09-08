import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuthStore } from './stores/authStore'
import LandingPage from './pages/LandingPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import RecommendPage from './pages/RecommendPage'
import TunePage from './pages/TunePage'
import SearchPage from './pages/SearchPage'
import BookDetailPage from './pages/BookDetailPage'
import LibraryPage from './pages/LibraryPage'
import DnaPage from './pages/DnaPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import { api } from './api/client'

/** 앱 시작 시 세션 복원 — 저장된 토큰이 있으면 GET /users/me로 닉네임·온보딩 상태를
 *  서버 기준으로 다시 맞춘다 (명세 §9 #3: 새로고침·다기기 일관성, onboardingStatus가 진실).
 *  401이면 api 인터셉터가 logout 처리한다. */
function AuthRestore() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const login = useAuthStore((s) => s.login)
  const ran = useRef(false)
  useEffect(() => {
    if (!accessToken || ran.current) return
    ran.current = true
    api.get('/users/me')
      .then((res) => login(accessToken, res.data.nickname, res.data.onboardingStatus !== 'PENDING'))
      .catch(() => {})
  }, [accessToken, login])
  return null
}

/** 비로그인 `/` = 랜딩, 로그인 상태면 홈으로 */
function RootRoute() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return accessToken ? <Navigate to="/home" replace /> : <LandingPage />
}

export default function App() {
  return (
    <>
    <AuthRestore />
    <Routes>
      <Route path="/" element={<RootRoute />} />
      {/* OAuth 버튼이 랜딩에 직접 있어 별도 로그인 페이지 없음 — 옛 링크 호환용 리다이렉트 */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* OAuth 콜백 착지 — 서버 302가 fragment 토큰을 들고 오는 곳 */}
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="home" element={<HomePage />} />
          <Route path="recommend" element={<RecommendPage />} />
          <Route path="tune" element={<TunePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="books/:bookId" element={<BookDetailPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="dna" element={<DnaPage />} />
        </Route>
      </Route>
    </Routes>
    </>
  )
}
