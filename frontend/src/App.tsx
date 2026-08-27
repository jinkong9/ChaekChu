import { Routes, Route } from 'react-router'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import TunePage from './pages/TunePage'
import SearchPage from './pages/SearchPage'
import BookDetailPage from './pages/BookDetailPage'
import LibraryPage from './pages/LibraryPage'
import DnaPage from './pages/DnaPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
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
