import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { BookSummary } from '../api/types'
import { useAuthStore } from '../stores/authStore'

const GENRES = ['소설', '에세이', '인문', '역사', '과학', '예술', '자기계발', '경제·경영', '사회', '시', '여행', '기술·IT']
const MAX_GENRES = 5
const STEP_COUNT = 3

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
  const canFinishBooks = [...picked.values()].every((rating) => rating != null)

  const submitProfile = async () => {
    // 성별은 응답 안 함 허용 — 빈 값이면 null 전송
    await api.post('/users/me/profile', {
      nickname: profile.nickname.trim(),
      birthYear: Number(profile.birthDate.slice(0, 4)),
      gender: profile.gender || null,
    })
    setNickname(profile.nickname.trim())
    setStep(1)
  }

  const toggleGenre = (g: string) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < MAX_GENRES ? [...prev, g] : prev))
  const toggleBook = (id: number) => {
    const next = new Map(picked)
    if (next.has(id)) next.delete(id)
    else next.set(id, null)
    setPicked(next)
  }
  const rate = (id: number, rating: number) => setPicked(new Map(picked).set(id, rating))

  const finish = async () => {
    if (!canFinishBooks) return
    await api.post('/users/me/preferences', {
      genres,
      books: [...picked.entries()].map(([bookId, rating]) => ({ bookId, rating: rating as number })),
    })
    completeOnboarding()
    navigate('/recommend')
  }

  return (
    // 로그인 전 단계라 GNB가 없다 — 종이 한 장 위에 단계만 올린다
    <main className="eo-page flex min-h-screen flex-col">
      <div className="eo-shell eo-shell--reading flex w-full flex-1 flex-col">
        <header>
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] uppercase tracking-[0.08em] tabular-nums text-ink-faint">Step {step + 1} / {STEP_COUNT}</p>
            <span className="text-[10px] tabular-nums text-ink-faint">{Math.round(((step + 1) / STEP_COUNT) * 100)}%</span>
          </div>
          <div className="eo-meter mt-2.5" role="presentation">
            <span style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }} />
          </div>
        </header>

        {step === 0 && (
          <section className="mt-9">
            <h1 className="eo-headline">먼저, 어떻게 불러드릴까요?</h1>
            <p className="eo-body mt-3.5 max-w-[46ch]">연령·성별은 첫 추천의 정확도를 높이는 데만 사용해요</p>
            <div className="mt-8 flex max-w-sm flex-col gap-6">
              <div>
                <label className="eo-fieldlabel" htmlFor="onb-nickname">닉네임</label>
                <input id="onb-nickname" className="eo-field w-full" placeholder="2자 이상" value={profile.nickname}
                  onChange={(e) => setProfile({ ...profile, nickname: e.target.value })} />
              </div>
              <div>
                <label className="eo-fieldlabel" htmlFor="onb-birth">생년월일</label>
                <input id="onb-birth" className="eo-field w-full" type="date" max={new Date().toISOString().slice(0, 10)} value={profile.birthDate}
                  onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })} />
              </div>
              <div>
                <label className="eo-fieldlabel" htmlFor="onb-gender">성별</label>
                <select id="onb-gender" className="eo-field w-full" value={profile.gender}
                  onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>
                  <option value="">응답 안 함</option>
                  <option value="F">여성</option>
                  <option value="M">남성</option>
                </select>
              </div>
            </div>
            <div className="mt-10 flex justify-end">
              <button className="eo-button" disabled={!canProfile} onClick={submitProfile}>다음</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="mt-9">
            <h1 className="eo-headline">어떤 분야에 끌리세요?</h1>
            <p className="eo-body mt-3.5">대충 골라도 괜찮아요 — 최대 {MAX_GENRES}개</p>
            <div className="mt-8 flex flex-wrap gap-2">
              {GENRES.map((g) => {
                const on = genres.includes(g)
                const full = genres.length >= MAX_GENRES
                return (
                  <button key={g} type="button" onClick={() => toggleGenre(g)} disabled={!on && full} aria-pressed={on}
                    className={`eo-tag eo-tag--lg ${on ? 'is-on' : ''} ${!on && full ? 'opacity-35' : ''}`}>{g}</button>
                )
              })}
            </div>
            <div className="mt-10 flex items-center justify-between">
              <button className="eo-link" onClick={() => setStep(2)}>건너뛰기</button>
              <button className="eo-button" onClick={() => setStep(2)}>다음</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-9">
            <h1 className="eo-headline">읽어본 책이 있나요?</h1>
            <p className="eo-body mt-3.5 max-w-[48ch]">별점까지 남기면 첫 추천이 더 정확해져요 · 3권 권장, 0권도 시작 가능</p>
            <div className="eo-books eo-books--roomy mt-8">
              {(data ?? []).map((bk) => {
                const selected = picked.has(bk.bookId)
                const rating = picked.get(bk.bookId) ?? 0
                return (
                  <div key={bk.bookId}>
                    {/* 고른 상태는 테두리 대신 표지 농도와 제목 굵기로 — 색을 새로 들이지 않는다 */}
                    <button type="button" onClick={() => toggleBook(bk.bookId)} aria-pressed={selected}
                      className={`eo-tile w-full ${selected ? '' : 'opacity-60'}`}>
                      {bk.coverUrl
                        ? <img className="eo-cover" src={bk.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        : <span className="eo-cover-fallback">{bk.title}</span>}
                      <span className={`eo-tile__title ${selected ? 'underline decoration-1 underline-offset-4' : ''}`}>{bk.title}</span>
                      <span className="eo-tile__author">{bk.author}</span>
                    </button>
                    {/* 별점 자리는 고르지 않았을 때도 비워 두어 그리드가 흔들리지 않게 한다 */}
                    <div className="mt-2 flex h-6 items-center gap-0.5">
                      {selected && [1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => rate(bk.bookId, n)}
                          aria-label={`별점 ${n}점`} aria-pressed={rating === n}
                          className={`text-[15px] leading-none ${rating >= n ? 'text-ink' : 'text-rule-soft'}`}>★</button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-10 flex items-center justify-between">
              <button className="eo-link" onClick={finish}>건너뛰기</button>
              <button className="eo-button" disabled={!canFinishBooks} onClick={finish}>
                추천 받기{picked.size > 0 && ` · ${picked.size}권`}
              </button>
            </div>
            {!canFinishBooks && <p className="eo-body mt-3 text-right text-[11px]">고른 책에 별점을 남기면 넘어갈 수 있어요</p>}
          </section>
        )}
      </div>
    </main>
  )
}
