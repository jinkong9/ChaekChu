import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { PopularBooksResponse, TagItem } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import bookshelf from '../assets/onboarding-bookshelf.webp'
import './OnboardingPage.css'

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
  // 생년월일은 30년을 뒤로 넘겨야 닿는 달력 대신 연·월·일을 바로 고른다.
  // 저장 형태는 그대로 'YYYY-MM-DD' 한 줄이라 profile.birthDate 를 쓰는 쪽은 아무것도 달라지지 않는다.
  const [birth, setBirth] = useState({ year: '', month: '', day: '' })
  const [genres, setGenres] = useState<string[]>([])
  const [picked, setPicked] = useState<Map<number, number | null>>(new Map()) // bookId -> rating

  // 장르 칩 — 태그 사전(DB tags)이 목록의 주인. 라벨의 '#'는 온보딩 화면에서만 뗀다 (§3.3)
  const { data: tagData } = useQuery({
    queryKey: ['tags', 'GENRE'],
    queryFn: async () => (await api.get<{ items: TagItem[] }>('/tags?kind=GENRE')).data.items,
    staleTime: Infinity,
  })
  const GENRES = (tagData ?? []).map((t) => t.label.replace(/^#/, ''))

  // Step 0 프로필 저장 뒤에만 조회 — 연령·성별이 있어야 세그먼트 인기가 나온다 (§4.2)
  const { data } = useQuery({
    queryKey: ['popular'],
    queryFn: async () => (await api.get<PopularBooksResponse>('/books/popular?size=12')).data,
    enabled: step === 2,
  })

  const TODAY = new Date()
  const THIS_YEAR = TODAY.getFullYear()
  const birthYears = Array.from({ length: THIS_YEAR - 1919 }, (_, i) => THIS_YEAR - i)
  // 오늘 이후는 고를 수 없다 — 올해를 고르면 이번 달까지, 이번 달을 고르면 오늘까지만 열린다
  const lastMonth = Number(birth.year) === THIS_YEAR ? TODAY.getMonth() + 1 : 12
  const birthMonths = Array.from({ length: lastMonth }, (_, i) => i + 1)
  const monthLength = birth.year && birth.month ? new Date(Number(birth.year), Number(birth.month), 0).getDate() : 31
  const lastDay = Number(birth.year) === THIS_YEAR && Number(birth.month) === TODAY.getMonth() + 1 ? TODAY.getDate() : monthLength
  const birthDays = Array.from({ length: lastDay }, (_, i) => i + 1)
  const pad = (n: number) => String(n).padStart(2, '0')

  const pickBirth = (part: Partial<typeof birth>) => {
    const next = { ...birth, ...part }
    // 연도를 바꿔 2월 29일이 사라지는 식의 어긋남은 그 자리에서 비운다
    const months = Number(next.year) === THIS_YEAR ? TODAY.getMonth() + 1 : 12
    if (Number(next.month) > months) next.month = ''
    const days = next.year && next.month
      ? (Number(next.year) === THIS_YEAR && Number(next.month) === TODAY.getMonth() + 1
          ? TODAY.getDate()
          : new Date(Number(next.year), Number(next.month), 0).getDate())
      : 31
    if (Number(next.day) > days) next.day = ''
    setBirth(next)
    // 세 칸이 다 차야 날짜 한 줄이 된다 — 덜 찬 동안은 빈 값이라 '다음'이 열리지 않는다
    const done = next.year !== '' && next.month !== '' && next.day !== ''
    setProfile((prev) => ({ ...prev, birthDate: done ? `${next.year}-${next.month}-${next.day}` : '' }))
  }

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
    // 홈으로 — 추천 진입은 홈 경유 단일 경로(GNB 확정 흐름). 첫 화면은 시그니처인 인기도서 링
    navigate('/home')
  }

  return (
    <main className={`onboarding onboarding--step-${step + 1}`}>
      {step === 0 && <img className="onboarding__illustration" src={bookshelf} alt="" aria-hidden="true" />}
      {step === 0 && <p className="onboarding__quote" aria-hidden="true">좋은 책이<br />좋은 하루를 만든다.<span>—</span></p>}
      <div className="onboarding__shell">
        <header className="onboarding__progress" aria-label={`온보딩 ${step + 1}단계, 총 ${STEP_COUNT}단계`}>
          <div className="onboarding__progress-labels">
            <span>STEP {step + 1} / {STEP_COUNT}</span>
          </div>
          <div className="onboarding__meter" role="presentation">
            <span style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }} />
          </div>
        </header>

        {step === 0 && <section className="onboarding__content onboarding__content--profile">
          <h1>어떻게 불러드릴까요?</h1>
          <p className="onboarding__lead">연령 · 성별은 첫 추천의 정확도를 높이는 데만 사용해요</p>
          <div className="onboarding__form">
            <div className="onboarding__form-row">
              <label htmlFor="onb-nickname">닉네임</label>
              <input id="onb-nickname" placeholder="2자 이상" autoComplete="nickname" value={profile.nickname}
                onChange={(event) => setProfile({ ...profile, nickname: event.target.value })} />
            </div>
            <div className="onboarding__form-row">
              <label htmlFor="onb-birth-year">생년월일</label>
              <div className="onboarding__birth">
                <select id="onb-birth-year" value={birth.year} onChange={(event) => pickBirth({ year: event.target.value })}>
                  <option value="">연도</option>
                  {birthYears.map((year) => <option key={year} value={String(year)}>{year}년</option>)}
                </select>
                <select aria-label="태어난 달" value={birth.month} onChange={(event) => pickBirth({ month: event.target.value })}>
                  <option value="">월</option>
                  {birthMonths.map((month) => <option key={month} value={pad(month)}>{month}월</option>)}
                </select>
                <select aria-label="태어난 날" value={birth.day} onChange={(event) => pickBirth({ day: event.target.value })}>
                  <option value="">일</option>
                  {birthDays.map((day) => <option key={day} value={pad(day)}>{day}일</option>)}
                </select>
              </div>
            </div>
            <div className="onboarding__form-row">
              <label htmlFor="onb-gender">성별</label>
              <select id="onb-gender" value={profile.gender}
                onChange={(event) => setProfile({ ...profile, gender: event.target.value })}>
                <option value="">응답 안 함</option><option value="F">여성</option><option value="M">남성</option>
              </select>
            </div>
          </div>
          <button className="onboarding__next" type="button" disabled={!canProfile} onClick={submitProfile}>
            다음 <span aria-hidden="true">→</span>
          </button>
          <p className="onboarding__hint">STEP 2에서는 어떤 책을 좋아하는지 물어볼게요.</p>
        </section>}

        {step === 1 && <section className="onboarding__content onboarding__content--genres">
          <h1>어떤 분야에 관심이 있으세요?</h1>
          <p className="onboarding__lead">대충 골라도 괜찮아요 — 최대 {MAX_GENRES}개</p>
          <div className="onboarding__genres" aria-label="관심 분야">
            {GENRES.map((genre) => {
              const selected = genres.includes(genre)
              return <button key={genre} type="button" aria-pressed={selected}
                disabled={!selected && genres.length >= MAX_GENRES}
                className={`onboarding__genre ${selected ? 'is-selected' : ''}`}
                onClick={() => toggleGenre(genre)}>{genre}</button>
            })}
          </div>
          <button className="onboarding__next" type="button" onClick={() => setStep(2)}>
            다음 <span aria-hidden="true">→</span>
          </button>
          <p className="onboarding__hint">STEP 3에서는 읽어본 책을 알려주세요.</p>
        </section>}

        {step === 2 && <section className="onboarding__content onboarding__content--books">
          <h1>읽어본 책이 있나요?</h1>
          <p className="onboarding__lead">
            {data?.segment ? `${data.segment.label}이 많이 읽은 책들이에요 — ` : '많이 읽힌 책들이에요 — '}
            별점까지 남기면 첫 추천이 더 정확해져요.<br />3권 권장, 0권도 시작 가능
          </p>
          <div className="onboarding__books">
            {(data?.items ?? []).map((book) => {
              const selected = picked.has(book.bookId)
              const rating = picked.get(book.bookId) ?? 0
              return <div className="onboarding__book" key={book.bookId}>
                <button className="onboarding__book-select" type="button" aria-pressed={selected}
                  aria-label={`${book.title} ${selected ? '선택 해제' : '선택'}`} onClick={() => toggleBook(book.bookId)}>
                  <span className={`onboarding__cover ${selected ? 'is-selected' : ''}`}>
                    {book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      : <span className="onboarding__cover-fallback">{book.title}</span>}
                    {selected && <span className="onboarding__check" aria-hidden="true">✓</span>}
                  </span>
                </button>
                <span className="onboarding__book-title" title={book.title}>{book.title}</span>
                <span className="onboarding__book-author" title={book.author ?? undefined}>{book.author}</span>
                {selected && <div className="onboarding__rating" aria-label={`${book.title} 별점`}>
                  {[1, 2, 3, 4, 5].map((value) =>
                    <button key={value} type="button" aria-label={`${value}점`} aria-pressed={rating === value}
                      className={rating >= value ? 'is-active' : ''} onClick={() => rate(book.bookId, value)}>★</button>)}
                </div>}
              </div>
            })}
          </div>
          <button className="onboarding__next" type="button" disabled={!canFinishBooks} onClick={finish}>
            완료하고 시작하기 <span aria-hidden="true">→</span>
          </button>
          <p className="onboarding__hint">
            {canFinishBooks ? '아무 책도 선택하지 않아도 추천을 시작할 수 있어요.' : '고른 책에 별점을 남기면 넘어갈 수 있어요.'}
          </p>
        </section>}
      </div>
    </main>
  )
}
