import { lazy, Suspense, useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RouteFallback from './components/RouteFallback'
import { useAuthStore } from './stores/authStore'
import LandingPage from './pages/LandingPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import { api } from './api/client'

/* 라우트별 청크. 처음 열리는 두 곳(랜딩·OAuth 착지)만 즉시 필요하고, 나머지는
 * 그 화면으로 갈 때 받는다. 한 덩어리로 묶어 두면 랜딩만 보러 온 사람도
 * 서재·BOOK DNA·검색 코드를 전부 내려받는다. */
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const RecommendPage = lazy(() => import('./pages/RecommendPage'))
const TunePage = lazy(() => import('./pages/TunePage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const BookDetailPage = lazy(() => import('./pages/BookDetailPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const DnaPage = lazy(() => import('./pages/DnaPage'))

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
      {/* 온보딩은 토큰만 요구한다 — 온보딩 완료 여부까지 보면 자기 자신으로 되돌아오는 고리가 생긴다 */}
      <Route element={<ProtectedRoute requireOnboarded={false} />}>
        <Route path="/onboarding" element={<Suspense fallback={<RouteFallback />}><OnboardingPage /></Suspense>} />
      </Route>
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
