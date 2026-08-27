import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'

type OAuthProvider = 'kakao' | 'google'

/** ONB-001 시작/로그인 — 카카오·Google OAuth만 지원 */
export default function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const startOAuth = async (provider: OAuthProvider) => {
    // MSW 목업에서는 provider callback을 대신해 authorize 응답으로 로그인 상태를 만든다.
    if (import.meta.env.VITE_ENABLE_MSW === 'true') {
      const res = await api.get(`/auth/oauth/${provider}/authorize`)
      login(res.data.accessToken, res.data.nickname, res.data.onboarded)
      navigate(res.data.onboarded ? '/' : '/onboarding')
      return
    }

    const baseUrl = (api.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
    window.location.assign(`${baseUrl}/auth/oauth/${provider}/authorize`)
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center gap-16 p-8">
      <div className="max-w-sm">
        <h1 className="text-3xl font-bold leading-snug">다음 한 권을,<br />이유와 함께</h1>
        <p className="text-gray-500 mt-3">읽은 책과 가벼운 행동만으로<br />신뢰할 수 있는 다음 책을 골라드려요</p>
      </div>
      <div className="w-96 bg-white border-2 border-primary rounded-xl p-7">
        <h2 className="text-xl font-bold mb-2">소셜 계정으로 시작하기</h2>
        <p className="text-sm text-gray-500 mb-5">카카오 또는 Google 계정으로만 로그인할 수 있어요.</p>
        <div className="flex flex-col gap-2.5">
          <button className="bg-[#FEE500] text-[#191919] rounded-lg py-3 font-bold" onClick={() => startOAuth('kakao')}>
            카카오로 시작하기
          </button>
          <button className="border-2 border-gray-300 text-gray-700 rounded-lg py-3 font-bold" onClick={() => startOAuth('google')}>
            Google로 시작하기
          </button>
          <p className="text-xs text-gray-400 text-center">최초 로그인 후 추천에 필요한 정보를 선택적으로 입력해요.</p>
        </div>
      </div>
    </main>
  )
}
