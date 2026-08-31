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

/** 비로그인 `/` = 랜딩, 로그인 상태면 홈으로 */
function RootRoute() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return accessToken ? <Navigate to="/home" replace /> : <LandingPage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      {/* OAuth 버튼이 랜딩에 직접 있어 별도 로그인 페이지 없음 — 옛 링크 호환용 리다이렉트 */}
      <Route path="/login" element={<Navigate to="/" replace />} />
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
  )
}
