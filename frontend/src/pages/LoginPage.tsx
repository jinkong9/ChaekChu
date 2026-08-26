import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'

/** ONB-001 시작/로그인 — 가입 시 출생연도(필수)·성별(응답 안 함 허용): 게이트 권장안 기준, 확정 시 조정 */
export default function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('signup')
  const [form, setForm] = useState({ email: '', password: '', nickname: '', birthYear: '', gender: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const submit = async () => {
    const url = mode === 'signup' ? '/auth/signup' : '/auth/login'
    const res = await api.post(url, form)
    login(res.data.accessToken, res.data.nickname, res.data.onboarded)
    navigate(res.data.onboarded ? '/' : '/onboarding')
  }
  const canSubmit = mode === 'login' ? form.email && form.password : form.email && form.password && form.nickname && form.birthYear

  const inp = 'w-full border-2 border-primary rounded-lg px-3 py-2.5'
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center gap-16 p-8">
      <div className="max-w-sm">
        <h1 className="text-3xl font-bold leading-snug">다음 한 권을,<br />이유와 함께</h1>
        <p className="text-gray-500 mt-3">읽은 책과 가벼운 행동만으로<br />신뢰할 수 있는 다음 책을 골라드려요</p>
      </div>
      <div className="w-96 bg-white border-2 border-primary rounded-xl p-7">
        <div className="flex gap-2 mb-4">
          <button className={`flex-1 rounded-lg py-2 font-bold ${mode === 'signup' ? 'bg-primary text-white' : 'border-2 border-gray-300 text-gray-400'}`} onClick={() => setMode('signup')}>회원가입</button>
          <button className={`flex-1 rounded-lg py-2 font-bold ${mode === 'login' ? 'bg-primary text-white' : 'border-2 border-gray-300 text-gray-400'}`} onClick={() => setMode('login')}>로그인</button>
        </div>
        <div className="flex flex-col gap-2.5">
          <input className={inp} placeholder="이메일" value={form.email} onChange={set('email')} />
          <input className={inp} type="password" placeholder="비밀번호" value={form.password} onChange={set('password')} />
          {mode === 'signup' && (
            <>
              <input className={inp} placeholder="닉네임" value={form.nickname} onChange={set('nickname')} />
              <div className="flex gap-2">
                <select className={inp} value={form.birthYear} onChange={set('birthYear')}>
                  <option value="">출생연도 (필수)</option>
                  {Array.from({ length: 50 }, (_, i) => 2010 - i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className={inp} value={form.gender} onChange={set('gender')}>
                  <option value="">성별 · 응답 안 함</option>
                  <option value="F">여성</option>
                  <option value="M">남성</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">연령·성별은 첫 추천의 정확도를 높이는 데만 사용해요</p>
            </>
          )}
          <button className="bg-primary text-white rounded-lg py-3 font-bold disabled:opacity-40" disabled={!canSubmit} onClick={submit}>
            {mode === 'signup' ? '가입하고 시작하기' : '로그인'}
          </button>
        </div>
      </div>
    </main>
  )
}
