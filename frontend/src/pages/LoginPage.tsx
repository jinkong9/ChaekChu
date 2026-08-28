import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'

/** ONB-001 로그인 — Google·Kakao OAuth만 (8/27 확정). 이메일/비번 가입 폐기.
 *  실제 연동 시 버튼은 서버의 authorize URL로 이동, 콜백에서 토큰 수령.
 *  프로필(닉네임·생년월일·성별)은 로그인 직후 온보딩 Step 0에서 입력 */
export default function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const oauth = async (provider: 'kakao' | 'google') => {
    // mock: 즉시 로그인 처리. 실 구현은 window.location.href = `${API}/oauth2/authorization/${provider}`
    const res = await api.post(`/auth/oauth/${provider}`)
    login(res.data.accessToken, res.data.nickname, res.data.onboarded)
    navigate(res.data.onboarded ? '/home' : '/onboarding')
  }

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center gap-16 p-8">
      <div className="max-w-sm">
        <h1 className="text-3xl font-bold leading-snug">다음 한 권을,<br />이유와 함께</h1>
        <p className="text-gray-500 mt-3">읽은 책과 가벼운 행동만으로<br />신뢰할 수 있는 다음 책을 골라드려요</p>
      </div>
      <div className="w-96 bg-white border-2 border-primary rounded-xl p-7">
        <h2 className="font-bold text-lg text-center">시작하기</h2>
        <p className="text-sm text-gray-400 text-center mt-1">가입과 로그인이 하나예요</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <button
            className="rounded-lg py-3 font-bold flex items-center justify-center gap-2"
            style={{ background: '#FEE500', color: '#191919' }}
            onClick={() => oauth('kakao')}
          >
            <span aria-hidden>💬</span> 카카오로 시작하기
          </button>
          <button
            className="rounded-lg py-3 font-bold border-2 border-gray-300 bg-white flex items-center justify-center gap-2"
            onClick={() => oauth('google')}
          >
            <span aria-hidden className="font-display">G</span> Google로 시작하기
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-4 text-center">
          첫 로그인이면 닉네임·생년월일·성별을 이어서 물어봐요.<br />연령·성별은 첫 추천의 정확도를 높이는 데만 사용해요.
        </p>
      </div>
    </main>
  )
}
