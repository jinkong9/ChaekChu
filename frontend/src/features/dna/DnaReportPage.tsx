/** BOOK DNA 분석 리포트.
 *
 *  한 지면을 세 단으로 읽는다.
 *  ① 히어로 — 독서타입 선언과 성향 5지표(무엇이 나왔나)
 *  ② 분석 패널 — 장르 레이더 · 키워드 · 한 줄 요약 · 독서타입(왜 그렇게 나왔나)
 *  ③ 독서 습관 — 두께 · 출간 연도 · 언어권 · 작가(어떻게 읽나)
 *  ④ 콘텐츠 2장 — 가챠 · 월드컵(그래서 뭘 해 볼까)
 *
 *  선언 → 근거 → 다음 걸음의 순서다. 근거를 보기 전에 놀거리가 끼어들면
 *  리포트가 아니라 콘텐츠 모음으로 읽힌다.
 *
 *  지표·레이더·키워드·타입은 FastAPI profile 응답을 사용하고, 화면의 색은
 *  실제 서재 책 표지에서 뽑는다(DESIGN.md). */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useDna } from '../../lib/useDna'
import { isDnaUnavailable, type DnaBookResponse, type DnaScore } from '../../api/dna'
import { tagLabel, useTags } from '../../lib/useTags'
import type { DnaBook } from './dnaTypes'
import { displayTone, extractCoverColor } from './spectrum'
import { axisLabel, profileFromApi, type DnaProfile } from './dnaProfile'
import { useGachaWindow } from './useGachaPool'
import { buildHabits, type Habit } from './habits'
import Radar from './DnaRadar'
import DnaEvidenceB from './DnaEvidenceB'
import DnaConstellation from './DnaConstellation'
import ReadingTypeField from './ReadingTypeField'
import BookWorldCup from './BookWorldCup'
import BookGacha from './BookGacha'
import { GachaMachineArt } from './GachaMachine'
import { coverAtWidth } from '../../lib/coverUrl'
import './dna-report.css'

/** 이 화면이 쓰는 색의 개수 — 지표 5줄에 하나씩 배정하고, 앞의 4개를 히어로 원에 쓴다 */
const TONE_COUNT = 5

/** 서재 전체의 표지에서 색을 뽑아 화면의 팔레트 다섯 개를 만든다.
 *
 *  별점 상위 다섯 권만 보면 그 다섯이 전부 흰 표지일 때 화면이 통째로 회색이 된다.
 *  그래서 전부 뽑아 무채색(폴백)을 걷어내고, 색상환 순서로 늘어놓은 뒤 고르게 다섯을 집는다.
 *  아직 계산 전이면 null — 그동안은 CSS 폴백(종이·잉크)이 자리를 지킨다. */
function useCoverTones(books: DnaBook[]): string[] | null {
  const [tones, setTones] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    setTones(null)
    Promise.all(books.map((b) => extractCoverColor(b.coverUrl))).then((cs) => {
      if (!alive || cs.length === 0) return
      const colored = cs.filter((c) => c.s >= 0.15).sort((a, b) => a.h - b.h)
      const src = colored.length > 0 ? colored : cs
      const step = (src.length - 1) / Math.max(1, TONE_COUNT - 1)
      // 채움·막대에 칠할 색이라 명도를 접는다(displayTone) — 파스텔 표지가 뽑히면 레이더가 종이색에 묻힌다
      setTones(Array.from({ length: TONE_COUNT }, (_, i) => displayTone(src[Math.round(i * step)])))
    })
    return () => {
      alive = false
    }
  }, [books])
  return tones
}

/* ── 히어로 한가운데 ─────────────────────────────────── */

/** 히어로 한가운데 — 이 화면의 시그니처.
 *  활자 이중나선(DnaConstellation) 위에 독서타입 선언 한 문장이 놓인다. */
function Centerpiece({ tones, profile }: { tones: string[] | null; profile: DnaProfile }) {
  return (
    <div className="dnar-figure">
      <DnaConstellation tones={tones} />
      <div className="dnar-figure__caption">
        <p className="dnar-figure__line">
          당신은
          <br />
          {profile.type.phrase}
          <br />
          <b>{profile.type.name}</b>입니다.
        </p>
        <span className="dnar-figure__code">{profile.type.code}</span>
      </div>
    </div>
  )
}

/** 두 새 시안은 같은 분석값을 다른 편집 방식으로 보여 준다. */
function HeroBasis({ basis }: { basis: Basis }) {
  return (
    <p className="dnar-hero-alt__basis">
      완독 {basis.readCount}권{basis.basedOnCount < basis.readCount ? ` 중 ${basis.basedOnCount}권` : ''} 분석 · {computedAgo(basis.generatedAt)}
      {basis.unanalyzedCount > 0 && <span> · {basis.unanalyzedCount}권은 분석 데이터 준비 중</span>}
    </p>
  )
}

function HeroB({ profile, tones, basis }: { profile: DnaProfile; tones: string[] | null; basis: Basis }) {
  return (
    <section className="dnar-hero-b" aria-label="BOOK DNA B안">
      <div className="dnar-hero-b__intro">
        <span className="dnar-eyebrow">BOOK DNA · READING PORTRAIT</span>
        <h1 className="dnar-hero-b__title">
          읽은 책이 모여<br />
          <em>당신의 문장</em>이 됩니다.
        </h1>
        <p className="dnar-hero-b__sub">당신의 읽는 세계를 더 깊이, 더 넓게.<br />한 권씩 쌓인 기록에서 지금의 취향을 발견합니다.</p>
        <HeroBasis basis={basis} />
      </div>
      <div className="dnar-hero-b__portrait">
        <div className="dnar-hero-b__topline"><span>YOUR READING TYPE</span><span>{profile.type.code}</span></div>
        <p className="dnar-hero-b__phrase">{profile.type.phrase}</p>
        <h2 className="dnar-hero-b__type">{profile.type.name}<span>입니다.</span></h2>
        <p className="dnar-hero-b__summary">{profile.oneLine}</p>
        <div className="dnar-hero-b__metrics">
          {profile.metrics.map((metric, i) => (
            <div className="dnar-hero-b__metric" key={metric.key}>
              <span>{metric.key}</span>
              <span className="dnar-hero-b__track"><span style={{ width: `${metric.value}%`, background: tones?.[i] ?? 'var(--eo-ink)' }} /></span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** C안 히어로의 글자 짜임 — 왼쪽 제호와 오른쪽 타입 이름이 부딪히는 문제를 네 가지로 풀어 본다.
 *  serif  오른쪽을 한글 세리프로 (본문 독서타입 이름과 같은 얼굴)
 *  small  왼쪽 제호를 워드마크 크기로 낮춰 주인공을 오른쪽에 넘긴다
 *  ko     왼쪽을 한글 헤드라인으로 갈아 끼운다 (제호는 사라진다)
 *  both   세리프 + 제호 축소 */
export type HeroCType = 'serif' | 'small' | 'ko' | 'both' | null

function HeroC({ profile, tones, basis, typeVariant }: { profile: DnaProfile; tones: string[] | null; basis: Basis; typeVariant: HeroCType }) {
  const serif = typeVariant === 'serif' || typeVariant === 'both'
  const small = typeVariant === 'small' || typeVariant === 'both'
  return (
    <section className="dnar-hero-c" aria-label="BOOK DNA C안">
      <div className="dnar-hero-c__main">
        <div className="dnar-hero-c__intro">
          <span className="dnar-eyebrow">MY READING ANALYSIS</span>
          {typeVariant === 'ko' ? (
            <h1 className="dnar-hero-c__title is-ko">
              당신이 읽은 것들이
              <br />
              쓴 이름
            </h1>
          ) : (
            <h1 className={`dnar-hero-c__title ${small ? 'is-small' : ''}`}>
              BOOK
              <br />
              DNA
            </h1>
          )}
          <p className="dnar-hero-c__sub">흩어져 있던 글자들이 모여<br />당신의 독서타입을 씁니다.</p>
          <HeroBasis basis={basis} />
        </div>
        <div className="dnar-hero-c__visual">
          <ReadingTypeField typeName={profile.type.name} tones={tones} serif={serif} />
          <div className="dnar-hero-c__caption">
            <span>YOUR READING TYPE · {profile.type.code}</span>
            <p>{profile.type.phrase}</p>
          </div>
        </div>
      </div>
      <div className="dnar-hero-c__metrics">
        {profile.metrics.map((metric, i) => (
          <div className="dnar-hero-c__metric" key={metric.key}>
            <div><span>{metric.key}</span><strong>{metric.value}%</strong></div>
            <span className="dnar-hero-c__track"><span style={{ width: `${metric.value}%`, background: tones?.[i] ?? 'var(--eo-ink)' }} /></span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── 더 깊이 보는 테스트 4장 ──────────────────────────── */

/** 카드마다 다른 작은 선 그림 — 아이콘이 아니라 그 테스트가 무엇을 보는지의 도식 */
const TEST_ART: Record<string, ReactNode> = {
  worldcup: (
    <>
      {/* 두 표지가 서로 기울어 맞붙고, 가운데 얇은 선이 대진을 가른다 */}
      <rect x="30" y="8" width="24" height="34" rx="1" fill="currentColor" opacity=".3"
        transform="rotate(-7 42 25)" />
      <rect x="66" y="8" width="24" height="34" rx="1" fill="currentColor" opacity=".3"
        transform="rotate(7 78 25)" />
      <line x1="60" y1="4" x2="60" y2="42" stroke="currentColor" strokeWidth="1" opacity=".5" />
    </>
  ),
}

/** 지금 열려 있는 콘텐츠 두 장. 후보를 어디서 뽑는지가 서로 다르다 —
 *  가챠는 책 전체에서(우연), 월드컵은 내 서재에서(선택). 그래서 카드 설명도 그 차이를 말한다. */
const TESTS = [
  {
    id: 'gacha',
    kicker: 'Random Draw',
    name: '완전 랜덤 책 가챠',
    desc: '취향을 접어 두고 아무 책이나 한 권 뽑아, 그게 취향에서 얼마나 먼지 알려드려요.',
    from: '소설 전체에서 뽑아요',
  },
  {
    id: 'worldcup',
    kicker: 'Book World Cup',
    name: '책 이상형 월드컵',
    desc: '서재의 책을 두 권씩 맞붙여 지금 가장 손이 가는 한 권을 찾아드려요.',
    from: '내 서재에서 골라요',
  },
] as const

/** 가챠 대화상자 — 후보(소설 전체)는 열 때 서버에서 받는다. 받아 오는 동안에도 상자는 떠 있어야 해서
 *  BookGacha 를 감싸 그 기다림만 맡는다. */
function GachaDialog({ axes, read, onClose }: { axes: DnaProfile['axes']; read: ReadonlySet<string>; onClose: () => void }) {
  const { data, isError } = useGachaWindow(true, read)
  return (
    <BookGacha
      pool={data?.books ?? []}
      total={data?.total ?? 0}
      read={read}
      // 받아 왔는데 빈손인 경우도 실패로 본다 — 기다리는 문구를 띄운 채 손잡이를 잠가 두면 고장으로 보인다
      failed={isError || (data != null && data.books.length === 0)}
      axes={axes}
      onClose={onClose}
    />
  )
}

/* ── 독서 습관 ───────────────────────────────────────── */

/** 줄마다 다른 선 그림 — 무엇을 센 값인지 한눈에 가르는 표식이다 */
const HABIT_ART: Record<string, ReactNode> = {
  // 시계 — 출간 연도
  recency: (
    <>
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9 5v4.3l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  // 펜촉 — 작가
  author: (
    <>
      <path d="M12.5 2.8 15.2 5.5 6.6 14.1 3 15l.9-3.6 8.6-8.6Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <line x1="10.8" y1="4.5" x2="13.5" y2="7.2" stroke="currentColor" strokeWidth="1.1" />
    </>
  ),
  // 올라가는 선 — 읽는 속도
  pace: (
    <path d="M2.5 13.5 6.5 9l3 2.6 5.5-6.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  // 별 — 별점
  rating: (
    <path d="M9 2.6l2 4.2 4.5.6-3.3 3.2.8 4.6L9 13l-4 2.2.8-4.6L2.5 7.4 7 6.8l2-4.2Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  ),
  // 쌓인 책 세 권 — 찜해 둔 책
  wish: (
    <>
      <rect x="2.5" y="4" width="13" height="3.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="2.5" y="8.4" width="13" height="3.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" opacity=".6" />
      <line x1="4" y1="14.4" x2="14" y2="14.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".35" />
    </>
  ),
}

/** 완독 기록에서 센 네 줄. 표본이 얇은 줄은 habits.ts 가 아예 만들지 않으므로 여기서는 받은 것만 그린다. */
function Habits({ habits, readCount, capped }: { habits: Habit[]; readCount: number; capped: boolean }) {
  return (
    <section className="dnar-habits">
      <div className="dnar-sechead">
        <div>
          <span className="dnar-eyebrow">Reading Habits</span>
          <h2 className="dnar-title dnar-habits__title">독서 습관</h2>
        </div>
        <span className="dnar-utility">
          완독 {readCount}권의 기록에서{capped ? ' (최근 200권 기준)' : ''}
        </span>
      </div>
      <dl className="dnar-habits__list">
        {habits.map((h) => (
          <div key={h.id} className="dnar-habit">
            <svg className="dnar-habit__art" viewBox="0 0 18 18" aria-hidden="true">
              {HABIT_ART[h.id]}
            </svg>
            <div className="dnar-habit__text">
              <dt className="dnar-habit__label">{h.label}</dt>
              <dd className="dnar-habit__detail">{h.detail}</dd>
            </div>
            <span className="dnar-habit__value">{h.value}</span>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ── 화면 ────────────────────────────────────────────── */

/** 프로필이 무엇에서 계산됐나 — 히어로 지표 아래 한두 줄로 보인다. */
interface Basis {
  /** 서재의 READ 수(온보딩 seed 포함) — 서버 readCount */
  readCount: number
  /** 그중 AI 인덱스에 있어 실제 계산에 쓰인 수 — 서버 profile.basedOnCount */
  basedOnCount: number
  /** 인덱스에 없어 빠진 책 수. books[].analyzed === false 를 세고, 그 필드가 없는 옛 응답이면 readCount - basedOnCount 로 대신한다 */
  unanalyzedCount: number
  /** 프로필 계산 시각(UTC ISO). 저장된 프로필로 답할 때는 옛 시각이라 "언제 계산된 결과인지"를 함께 보인다 */
  generatedAt: string
}

/** 계산 시각을 사람 말로 — 방금·N분 전·N시간 전·N일 전. 서버가 저장된 프로필(§3.4)을 줄 때 generatedAt 이 옛 시각이다. */
function computedAgo(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return '방금 계산'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}분 전 계산`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전 계산`
  return `${Math.floor(hour / 24)}일 전 계산`
}

/** 서버 응답에서 근거 숫자를 뽑는다. analyzed 가 없는 옛 응답에도 동작한다. */
function basisOf(data: { readCount: number; generatedAt: string; books: DnaBookResponse[]; profile: { basedOnCount: number } }): Basis {
  // READ 만 센다 — 문장이 "완독 N권 중 M권" 이라 찜(WISH)이 섞이면 수가 안 맞는다
  const flagged = data.books.filter((b) => b.status === 'READ' && b.analyzed === false).length
  const gap = Math.max(0, data.readCount - data.profile.basedOnCount)
  return {
    readCount: data.readCount,
    basedOnCount: data.profile.basedOnCount,
    unanalyzedCount: flagged > 0 ? flagged : gap,
    generatedAt: data.generatedAt,
  }
}

function Report({ books, records, profile, keywords, tones, basis, declaredTags, topGenres }: {
  books: DnaBook[]
  /** 서버 응답 그대로 — 쪽수·출간 연도·분류처럼 화면 타입(DnaBook)이 버린 값을 독서 습관이 쓴다 */
  records: DnaBookResponse[]
  /** 점수를 가진 원본 키워드 — 새 안이 칩 농도를 점수로 정한다 */
  keywords: DnaScore[]
  profile: DnaProfile
  tones: string[] | null
  basis: Basis
  /** 온보딩에서 내가 고른 관심 태그 (공개 taxonomy code) */
  declaredTags: string[]
  /** 실제로 많이 읽은 축 (같은 taxonomy) — 고른 것과 읽은 것을 맞대 본다 */
  topGenres: string[]
}) {
  // 아직 화면이 없는 카드는 죽은 버튼 대신 준비 중임을 그 자리에서 알린다
  const [pending, setPending] = useState<string | null>(null)

  /* 열려 있는 콘텐츠는 주소에 둔다(?play=gacha).
     useState 로 들고 있으면 대화상자가 히스토리에 없어서, 뒤로가기가 대화상자가 아니라
     이 페이지를 떠나 버린다. 주소에 두면 뒤로가기는 대화상자만 닫고 리포트에 남는다.
     새로고침·링크 공유로 바로 열리는 것은 덤이다. */
  const [params, setParams] = useSearchParams()
  /** 근거 구역(레이더~독서 습관) 안 — 상단 시안과 같이 주소에 둔다 */
  const bodyVariant = params.get('body') === 'b' ? 'b' : 'a'
  const selectBody = (variant: 'a' | 'b') => {
    if (bodyVariant === variant) return
    const next = new URLSearchParams(params)
    if (variant === 'a') next.delete('body')
    else next.set('body', variant)
    setParams(next, { replace: true })
  }

  /** C안 안에서 글자 짜임을 다시 고른다(?htype=) */
  const rawType = params.get('htype')
  const heroCType = (['serif', 'small', 'ko', 'both'] as const).find((v) => v === rawType) ?? null
  const selectHeroType = (variant: HeroCType) => {
    const next = new URLSearchParams(params)
    if (variant === null) next.delete('htype')
    else next.set('htype', variant)
    setParams(next, { replace: true })
  }

  const heroVariant = params.get('hero')
  const selectedHero = heroVariant === 'b' || heroVariant === 'c' ? heroVariant : 'a'
  const selectHero = (variant: 'a' | 'b' | 'c') => {
    if (selectedHero === variant) return
    const next = new URLSearchParams(params)
    if (variant === 'a') next.delete('hero')
    else next.set('hero', variant)
    setParams(next)
  }
  const navigate = useNavigate()
  const raw = params.get('play')
  const open = (TESTS.some((t) => t.id === raw) ? raw : null) as 'gacha' | 'worldcup' | null
  /** 이 대화상자를 우리가 열었는지 — 링크로 바로 들어온 것을 뒤로가기로 닫으면 사이트 밖으로 나간다 */
  const pushed = useRef(false)

  const openPlay = (id: 'gacha' | 'worldcup') => {
    const next = new URLSearchParams(params)
    next.set('play', id)
    pushed.current = true
    setParams(next)
  }
  const closePlay = useCallback(() => {
    if (pushed.current) {
      // 우리가 쌓은 칸을 걷어낸다 — replace 로 지우면 뒤로가기 한 번이 헛돈다
      pushed.current = false
      navigate(-1)
      return
    }
    const next = new URLSearchParams(params)
    next.delete('play')
    setParams(next, { replace: true })
  }, [navigate, params, setParams])
  // 콘텐츠 후보는 실제 응답의 사용자 서재다. 세 콘텐츠 모두 표지를 보여 주고 고르게 하므로
  // 표지가 없는 책은 후보에서 뺀다 — 빈 자리가 대진표에 섞이면 고를 수가 없다
  const pool = useMemo(() => books.filter((b) => b.coverUrl !== ''), [books])
  const canPlay = pool.length >= 4
  // 가챠만 후보가 다르다 — '완전 랜덤'이니 내 서재가 아니라 소설 전체에서 뽑는다
  const habits = useMemo(() => buildHabits(records), [records])
  /** 이미 읽은 책의 ISBN — 가챠 후보에서 뺀다 */
  const readIsbns = useMemo(
    () => new Set(records.filter((b) => b.status === 'READ' && b.isbn13).map((b) => b.isbn13)),
    [records],
  )

  // 표지 더미는 별점이 높은 세 권 — 타입 패널의 오른쪽 아래를 채운다
  const top3 = books.filter((b) => b.coverUrl !== '').sort((a, b) => b.rating - a.rating).slice(0, 3)
  const strongCount = Math.min(4, profile.keywords.length)

  /** 카드를 열 수 없으면 그 이유를 그 자리에서 말한다 — 눌러도 아무 일 없는 버튼을 두지 않는다.
   *  가챠는 서재와 무관하게 늘 열린다(후보를 서버에서 받아 온다) */
  const blockedReason = (t: (typeof TESTS)[number]): string | null => {
    if (t.id === 'gacha') return null
    return canPlay ? null : `「${t.name}」는 표지가 있는 책이 4권 이상일 때 열려요 — 지금 서재에는 ${pool.length}권이에요.`
  }

  // 관심 태그 라벨은 사전(GET /tags)에서 가져온다 — 서버는 공개 코드(FICTION)로 준다
  const { data: tags } = useTags('GENRE')
  const declared = declaredTags.map((code) => tagLabel(code, tags).replace(/^#/, ''))
  const actual = topGenres.map(axisLabel)

  return (
    <>
      <div className="dnar-variantbar">
        <span className="dnar-utility">상단 디자인 비교</span>
        <div className="dnar-variantbar__choices" role="group" aria-label="BOOK DNA 상단 디자인 선택">
          {([
            ['a', '기존안'],
            ['b', 'B안'],
            ['c', 'C안'],
          ] as const).map(([variant, label]) => (
            <button
              key={variant}
              type="button"
              className="dnar-variantbar__button"
              aria-pressed={selectedHero === variant}
              onClick={() => selectHero(variant)}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedHero === 'c' && (
          <>
            <span className="dnar-utility">C안 글자</span>
            <div className="dnar-variantbar__choices" role="group" aria-label="C안 글자 짜임 선택">
              {([
                [null, '지금'],
                ['serif', '오른쪽 세리프'],
                ['small', '제호 축소'],
                ['ko', '한글 제목'],
                ['both', '세리프+축소'],
              ] as const).map(([variant, label]) => (
                <button
                  key={label}
                  type="button"
                  className="dnar-variantbar__button"
                  aria-pressed={heroCType === variant}
                  onClick={() => selectHeroType(variant)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        <span className="dnar-utility">본문 비교</span>
        <div className="dnar-variantbar__choices" role="group" aria-label="BOOK DNA 본문 디자인 선택">
          {([
            ['a', '기존안'],
            ['b', '새 안'],
          ] as const).map(([variant, label]) => (
            <button
              key={variant}
              type="button"
              className="dnar-variantbar__button"
              aria-pressed={bodyVariant === variant}
              onClick={() => selectBody(variant)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* ── 히어로 ────────────────────────────────── */}
      {heroVariant === 'b' ? (
        <HeroB profile={profile} tones={tones} basis={basis} />
      ) : heroVariant === 'c' ? (
        <HeroC profile={profile} tones={tones} basis={basis} typeVariant={heroCType} />
      ) : (
      <section className="dnar-hero">
        <div>
          <span className="dnar-eyebrow">My Reading Analysis</span>
          <h1 className="dnar-hero__display">
            BOOK
            <br />
            DNA
          </h1>
          <p className="dnar-hero__sub">
            당신의 읽는 세계를 더 깊이, 더 넓게.
            <br />
            지금, 당신의 독서 DNA를 만나보세요.
          </p>
        </div>

        <Centerpiece tones={tones} profile={profile} />

        <div className="dnar-hero__aside">
          <p className="dnar-hero__whisper">
            Books reveal
            <br />
            a different you.
          </p>
          <dl className="dnar-metrics">
            {profile.metrics.map((m, i) => (
              <div key={m.key} className="dnar-metric">
                <dt className="dnar-metric__label">{m.key}</dt>
                <dd className="dnar-metric__track">
                  <div
                    className="dnar-metric__fill"
                    style={{
                      ['--v' as string]: `${m.value}%`,
                      ['--tone' as string]: tones?.[i] ?? 'var(--eo-ink-faint)',
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                </dd>
                <span className="dnar-metric__value">{m.value}%</span>
              </div>
            ))}
          </dl>
          {/* 근거 — 몇 권으로 계산했고 언제 계산했나. 인덱스에 없어 빠진 책이 있으면 그 수를 말한다(§3.4 analyzed) */}
          <div className="dnar-basis">
            <span className="dnar-utility">
              완독 {basis.readCount}권{basis.basedOnCount < basis.readCount ? ` 중 ${basis.basedOnCount}권` : ''}의 장르·별점 분포에서 계산 · {computedAgo(basis.generatedAt)}
            </span>
            {basis.unanalyzedCount > 0 && (
              <span className="dnar-utility" role="note">
                {basis.unanalyzedCount}권은 아직 분석 데이터가 없어 반영되지 않았어요
              </span>
            )}
          </div>
        </div>
      </section>
      )}

      {/* ── 근거 구역 — 안 두 가지를 주소로 갈아 끼운다(?body=b) ── */}
      {bodyVariant === 'b' ? (
        <DnaEvidenceB
          profile={profile}
          records={records}
          habits={habits}
          keywords={keywords}
          declaredTags={declaredTags}
          readCount={basis.readCount}
          tones={tones}
          habitArt={HABIT_ART}
        />
      ) : (
        <>
        {/* ── 요약 패널 3열 ─────────────────────────── */}
        <div className="dnar-bottom">
          <section className="dnar-panel">
            <h2 className="dnar-title">당신의 취향 한눈에 보기</h2>
            <Radar axes={profile.axes} tone={tones?.[0]} />
            {/* 고른 것과 읽은 것 — 온보딩에서 고른 관심사와 실제 완독 분포는 자주 갈린다. 그 간극을 보여 주는 게 리포트의 몫이다 */}
            {(declared.length > 0 || actual.length > 0) && (
              <dl className="dnar-compare">
                <div>
                  <dt className="dnar-utility">고른 관심사</dt>
                  <dd>{declared.length > 0 ? declared.join(' · ') : '고른 관심사가 없어요'}</dd>
                </div>
                <div>
                  <dt className="dnar-utility">실제로 읽은 장르</dt>
                  <dd>{actual.length > 0 ? actual.join(' · ') : '아직 집계할 책이 없어요'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="dnar-panel">
            {/* 태그가 아직 붙지 않은 책만 읽었으면 키워드가 0개로 온다 — 그때는 제목만 남기지 않고 통째로 숨긴다 */}
            {profile.keywords.length > 0 && (
              <>
                <h2 className="dnar-title">자주 읽는 키워드</h2>
                <ul className="dnar-keywords">
                  {profile.keywords.map((k, i) => (
                    <li key={k} className={`dnar-keyword ${i < strongCount ? 'is-strong' : ''}`}>
                      #{k}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h2 className="dnar-title">당신의 한 줄 요약</h2>
            <figure className="dnar-quote">
              <span className="dnar-quote__mark">“</span>
              <blockquote className="dnar-quote__body">{profile.oneLine}</blockquote>
              <span className="dnar-quote__mark dnar-quote__mark--close">”</span>
            </figure>
          </section>

          <section className="dnar-panel dnar-panel--type" style={{ ['--tone' as string]: tones?.[0] ?? undefined }}>
            <div className="dnar-type__head">
              <span className="dnar-utility">당신의 독서타입</span>
              <span className="dnar-eyebrow">{profile.type.code}</span>
            </div>
            <h2 className="dnar-type__name">{profile.type.name}</h2>
            <p className="dnar-type__blurb">{profile.type.blurb}</p>
            <div hidden={profile.type.likes.length === 0}>
              <p className="dnar-utility" style={{ marginBottom: 10 }}>
                이런 책을 좋아해요
              </p>
              <ul className="dnar-type__likes">
                {profile.type.likes.map((l) => (
                  <li key={l}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1" />
                      <path d="M4.2 7.2 6.2 9.2 9.9 5.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="dnar-type__mark" aria-hidden="true">
              읽는 만큼
              <br />
              넓어지는 사람
            </p>
            <div className="dnar-type__stack">
              {top3.map((b) => (
                <img
                  key={b.isbn13}
                  src={coverAtWidth(b.coverUrl, 44) ?? b.coverUrl}
                  alt=""
                  title={b.title}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          </section>
        </div>

        {/* ── 독서 습관 — 취향(무엇을) 다음에 오는 버릇(어떻게) ── */}
        {habits.length > 0 && (
          <Habits habits={habits} readCount={basis.readCount} capped={records.length >= 200} />
        )}
        </>
      )}

      {/* ── 콘텐츠 2장 — 리포트를 다 읽은 뒤의 다음 걸음 ── */}
      <section className="dnar-plays">
        <div className="dnar-sechead">
          <h2 className="dnar-title">리포트를 덮고, 한 번 해 볼까요?</h2>
          <span className="dnar-utility">둘 다 지금 바로 할 수 있어요</span>
        </div>
        <ul className="dnar-tests">
          {TESTS.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                className={`dnar-test ${t.id === 'gacha' ? 'dnar-test--gacha' : ''}`}
                style={{ ['--tone' as string]: tones?.[i] ?? 'var(--eo-ink-faint)' }}
                onClick={() => {
                  const why = blockedReason(t)
                  if (why) return setPending(why)
                  setPending(null)
                  openPlay(t.id)
                }}
              >
                {t.id === 'gacha' ? (
                  <>
                    <h3 className="dnar-test__name">완전랜덤 책 가챠</h3>
                    <span className="dnar-test__machine"><GachaMachineArt /></span>
                    <span className="dnar-test__go">돌리러 가기 →</span>
                  </>
                ) : (
                  <>
                    <div className="dnar-test__body">
                      <span className="dnar-test__no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="dnar-test__kicker">{t.kicker}</span>
                      <h3 className="dnar-test__name">{t.name}</h3>
                      <p className="dnar-test__desc">{t.desc}</p>
                      <span className="dnar-utility dnar-test__from">{t.from}</span>
                      <span className="dnar-test__go">시작하기 →</span>
                    </div>
                    <svg className="dnar-test__art" viewBox="0 0 120 44" aria-hidden="true">
                      {TEST_ART[t.id]}
                    </svg>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
        <p className="dnar-note" role="status">
          {pending ?? ' '}
        </p>
      </section>
      {/* 주소로 바로 들어왔는데 후보가 모자라면 열지 않는다 — 카드가 막던 조건을 여기서도 지킨다 */}
      {open === 'gacha' && <GachaDialog axes={profile.axes} read={readIsbns} onClose={closePlay} />}
      {open === 'worldcup' && canPlay && (
        <BookWorldCup pool={pool} topAxis={profile.topAxis} onClose={closePlay} />
      )}
    </>
  )
}

/** 리포트를 그릴 수 없을 때의 지면.
 *
 *  회색 한 줄만 남기면 로그인해 들어온 사람은 "화면이 깨졌다"로 읽는다. 제호는 그대로 세워 두고
 *  가운데에 지금 상황과 다음 걸음 하나만 놓는다. */
function DnaNotice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="dnar-notice">
      <span className="dnar-eyebrow">My Reading Analysis</span>
      <h1 className="dnar-hero__display">
        BOOK
        <br />
        DNA
      </h1>
      <p className="dnar-notice__title">{title}</p>
      <p className="dnar-notice__body">{body}</p>
      {action}
    </section>
  )
}

export default function DnaReportPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useDna()
  const books = useMemo(() => (data?.books ?? []).map(toDnaBook), [data?.books])
  const tones = useCoverTones(books)
  const profile = data ? profileFromApi(data.profile, data.readCount) : null
  const basis = data ? basisOf(data) : null

  return (
    <main className="dnar">
      <div className="dnar__shell">
        {isLoading && <div className="dnar-skeleton" aria-label="불러오는 중" />}
        {/* 503 DNA_UNAVAILABLE 은 분석 쪽만 쉬는 것이다 — 서재·검색은 멀쩡하다고 말해 줘야 이탈하지 않는다 */}
        {(isError || (!isLoading && !data)) && (
          <DnaNotice
            title="BOOK DNA를 만들지 못했어요."
            body={
              isDnaUnavailable(error)
                ? '분석 서버가 잠시 쉬고 있어요. 서재와 검색은 그대로 쓸 수 있고, 잠시 뒤 다시 시도하면 돼요.'
                : '잠시 후 다시 시도해 주세요.'
            }
            action={
              <div className="dnar-notice__actions">
                <button type="button" className="dnar-notice__action" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching ? '다시 부르는 중…' : '다시 시도'}
                </button>
                <Link className="dnar-notice__action dnar-notice__action--quiet" to="/library">
                  내 서재 보기
                </Link>
              </div>
            }
          />
        )}
        {/* 읽은 책은 있는데 전부 인덱스에 없어 계산이 안 된 경우와, 정말 읽은 책이 없는 경우는 다른 말을 해야 한다 */}
        {data?.profile.status === 'INSUFFICIENT_DATA' && (
          <DnaNotice
            title={data.readCount > 0 ? '아직 분석할 수 있는 책이 없어요.' : '읽은 책을 기록하면 DNA가 만들어져요.'}
            body={
              data.readCount > 0
                ? `완독 ${data.readCount}권이 아직 분석 데이터에 없어 BOOK DNA를 만들 수 없어요. 분석 데이터가 늘어나면 자동으로 반영되니, 읽은 책을 더 기록해 두면 그만큼 빨리 채워져요.`
                : '읽은 책을 검색해 별점과 완독일만 남기면 돼요. 한 권부터 시작되고, 세 권쯤 쌓이면 취향의 축·성향 지표·독서타입이 제 모습을 갖춥니다.'
            }
            action={
              // 기록이 하나도 없으면 책을 찾는 게 먼저, 기록은 있는데 분석이 안 됐으면 내 서재를 먼저 보여 준다
              <div className="dnar-notice__actions">
                {data.readCount > 0 ? (
                  <>
                    <Link className="dnar-notice__action" to="/library">
                      내 서재에서 기록 보기
                    </Link>
                    <Link className="dnar-notice__action dnar-notice__action--quiet" to="/search">
                      책 더 기록하기
                    </Link>
                  </>
                ) : (
                  <>
                    <Link className="dnar-notice__action" to="/search">
                      읽은 책 검색해서 기록하기
                    </Link>
                    <Link className="dnar-notice__action dnar-notice__action--quiet" to="/library">
                      내 서재 보기
                    </Link>
                  </>
                )}
              </div>
            }
          />
        )}
        {data?.profile.status === 'READY' && profile && basis && (
          <Report
            books={books}
            records={data.books}
            keywords={data.profile.keywords}
            profile={profile}
            tones={tones}
            basis={basis}
            declaredTags={data.declaredTags}
            topGenres={data.profile.evidence.topGenres}
          />
        )}
      </div>
    </main>
  )
}

function toDnaBook(book: DnaBookResponse): DnaBook {
  return {
    isbn13: book.isbn13,
    title: book.title,
    author: book.authors.join(', '),
    classNo: book.classNo ?? '000',
    coverUrl: book.coverUrl ?? '',
    rating: book.rating ?? 0,
    finishedAt: book.finishedDate ?? '',
  }
}
