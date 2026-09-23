import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RouteFallback from './components/RouteFallback'
import { useAuthStore } from './stores/authStore'
import LandingPage from './pages/LandingPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import { api } from './api/client'
import { refreshSession } from './api/session'

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

/** 앱 시작 시 세션 복원 (API_SPEC §2.3) — 액세스 토큰은 저장하지 않으므로 먼저 POST /auth/refresh 로 받는다.
 *  쿠키가 살아 있으면(14일) 토큰을 받고 GET /users/me 로 닉네임·온보딩 상태를 서버 기준으로 맞춘다(명세 §9 #3: onboardingStatus 가 진실).
 *  401 이면 로그인하지 않은 것 — 저장된 닉네임도 지운다.
 *  끝나기 전에는 라우트를 그리지 않는다: 토큰 없는 첫 렌더에 랜딩이 깜빡이고 보호 라우트가 랜딩으로 튕기는 것을 막는다.
 *  OAuth 콜백 착지도 이 뒤에 렌더되므로 콜백 페이지는 스토어만 보고 분기한다. */
function AuthRestore({ children }: { children: ReactNode }) {
  const sessionReady = useAuthStore((s) => s.sessionReady)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return // StrictMode 이중 실행 방지 — 갱신은 한 번만
    ran.current = true
    const { login, logout, markSessionReady } = useAuthStore.getState()
    ;(async () => {
      const token = await refreshSession()
      if (token) {
        try {
          const res = await api.get('/users/me')
          login(token, res.data.nickname, res.data.onboardingStatus !== 'PENDING')
        } catch {
          /* /users/me 가 잠깐 실패해도 토큰은 유효하다 — 저장된 닉네임·온보딩으로 진행 */
        }
      } else {
        logout()
      }
      markSessionReady()
    })()
  }, [])
  if (!sessionReady) return <RouteFallback />
  return children
}

/** 비로그인 `/` = 랜딩, 로그인 상태면 홈으로 */
function RootRoute() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return accessToken ? <Navigate to="/home" replace /> : <LandingPage />
}

export default function App() {
  return (
    <AuthRestore>
    <Routes>
      <Route path="/" element={<RootRoute />} />
      {/* OAuth 버튼이 랜딩에 직접 있어 별도 로그인 페이지 없음 — 옛 링크 호환용 리다이렉트 */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* OAuth 콜백 착지 — 서버 302가 refresh_token 쿠키를 심고 보내는 곳. 토큰은 AuthRestore 가 갱신으로 받는다 */}
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
    </AuthRestore>
  )
}
