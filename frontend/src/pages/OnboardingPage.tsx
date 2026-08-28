import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { BookSummary } from '../api/types'
import { useAuthStore } from '../stores/authStore'

const GENRES = ['소설', '에세이', '인문', '역사', '과학', '예술', '자기계발', '경제·경영', '사회', '시', '여행', '기술·IT']

/** ONB-002 온보딩 3단 — Step 0 프로필(닉네임·생년월일·성별, 8/27 확정: OAuth 후 필수 수집)
 *  → Step 1 분야(0개 허용) → Step 2 읽은 책+별점(0권 허용) */
export default function OnboardingPage() {
  const navigate = useNavigate()
  const setNickname = useAuthStore((s) => s.setNickname)
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding)
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [profile, setProfile] = useState({ nickname: '', birthDate: '', gender: '' })
  const [genres, setGenres] = useState<string[]>([])
  const [picked, setPicked] = useState<Map<number, number | null>>(new Map()) // bookId -> rating

  const { data } = useQuery({
    queryKey: ['popular'],
    queryFn: async () => (await api.get<{ items: BookSummary[] }>('/books/popular')).data.items,
  })

  const canProfile = profile.nickname.trim().length >= 2 && profile.birthDate !== ''

  const submitProfile = async () => {
    // 성별은 응답 안 함 허용 — 빈 값이면 null 전송
    await api.post('/users/me/profile', { ...profile, gender: profile.gender || null })
    setNickname(profile.nickname.trim())
    setStep(1)
  }

  const toggleGenre = (g: string) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < 5 ? [...prev, g] : prev))
  const toggleBook = (id: number) => {
    const next = new Map(picked)
    if (next.has(id)) next.delete(id)
    else next.set(id, null)
    setPicked(next)
  }
  const rate = (id: number, rating: number) => setPicked(new Map(picked).set(id, rating))

  const finish = async () => {
    await api.post('/users/me/preferences', {
      genres,
      books: [...picked.entries()].map(([bookId, rating]) => ({ bookId, rating })),
    })
    completeOnboarding()
    navigate('/home')
  }

  const inp = 'w-full border-2 border-primary rounded-lg px-3 py-2.5'

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center p-8">
      <div className="w-[720px] bg-white border-2 border-primary rounded-xl p-8">
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-gray-400">Step {step + 1} / 3</span>
          <div className="w-48 h-2 bg-gray-100 rounded-full"><div className="h-2 bg-primary rounded-full" style={{ width: `${((step + 1) / 3) * 100}%` }} /></div>
        </div>

        {step === 0 && (
          <>
            <h1 className="text-2xl font-bold mt-3">먼저, 어떻게 불러드릴까요?</h1>
            <p className="text-gray-500 text-sm">연령·성별은 첫 추천의 정확도를 높이는 데만 사용해요</p>
            <div className="mt-5 flex flex-col gap-2.5 max-w-sm">
              <input className={inp} placeholder="닉네임 (2자 이상)" value={profile.nickname}
                onChange={(e) => setProfile({ ...profile, nickname: e.target.value })} />
              <label className="text-xs text-gray-400 -mb-2">생년월일</label>
              <input className={inp} type="date" max={new Date().toISOString().slice(0, 10)} value={profile.birthDate}
                onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })} />
              <select className={inp} value={profile.gender} onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>
                <option value="">성별 · 응답 안 함</option>
                <option value="F">여성</option>
                <option value="M">남성</option>
              </select>
            </div>
            <div className="mt-8 flex justify-end">
              <button className="bg-primary text-white rounded-lg px-10 py-3 font-bold disabled:opacity-40"
                disabled={!canProfile} onClick={submitProfile}>다음</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="text-2xl font-bold mt-3">어떤 분야에 끌리세요?</h1>
            <p className="text-gray-500 text-sm">대충 골라도 괜찮아요 — 최대 5개</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {GENRES.map((g) => (
                <button key={g} onClick={() => toggleGenre(g)}
                  className={`rounded-full px-5 py-2 border-2 ${genres.includes(g) ? 'bg-primary text-white border-primary' : 'border-gray-300'}`}>{g}</button>
              ))}
            </div>
            <div className="mt-8 flex justify-between items-center">
              <button className="text-gray-400 underline" onClick={() => setStep(2)}>건너뛰기</button>
              <button className="bg-primary text-white rounded-lg px-10 py-3 font-bold" onClick={() => setStep(2)}>다음</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-2xl font-bold mt-3">읽어본 책이 있나요?</h1>
            <p className="text-gray-500 text-sm">별점까지 남기면 첫 추천이 더 정확해져요 · 3권 권장, 0권도 시작 가능</p>
            <div className="mt-5 grid grid-cols-4 gap-3">
              {(data ?? []).map((bk) => {
                const selected = picked.has(bk.bookId)
                return (
                  <div key={bk.bookId}>
                    <button onClick={() => toggleBook(bk.bookId)}
                      className={`w-full rounded-lg p-2 text-left border-2 ${selected ? 'border-primary bg-gray-50' : 'border-gray-200'}`}>
                      <div className="h-24 bg-gray-200 rounded" />
                      <p className="mt-1.5 text-sm font-bold truncate">{bk.title}</p>
                      <p className="text-xs text-gray-400 truncate">{bk.author}</p>
                    </button>
                    {selected && (
                      <div className="flex gap-0.5 mt-1 justify-center">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} onClick={() => rate(bk.bookId, n)}
                            className={`text-lg leading-none ${(picked.get(bk.bookId) ?? 0) >= n ? 'text-primary' : 'text-gray-300'}`}>★</button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-8 flex justify-between items-center">
              <button className="text-gray-400 underline" onClick={finish}>건너뛰기</button>
              <button className="bg-primary text-white rounded-lg px-10 py-3 font-bold" onClick={finish}>
                추천 받기{picked.size > 0 && ` (${picked.size}권 선택)`}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
