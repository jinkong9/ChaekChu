/** BOOK DNA 분석 리포트.
 *
 *  히어로(독서타입 선언 + 성향 5지표)와 분석 패널을 한 지면에
 *  ① 히어로(독서타입 선언 + 성향 5지표) ② 더 깊이 보는 테스트 4장
 *  ③ 요약 패널(장르 레이더 · 키워드 · 한 줄 요약 · 독서타입)을 얹는다.
 *
 *  지표·레이더·키워드·타입은 FastAPI profile 응답을 사용하고, 화면의 색은
 *  실제 서재 책 표지에서 뽑는다(DESIGN.md). */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useDna } from '../../lib/useDna'
import type { DnaBookResponse } from '../../api/dna'
import type { DnaBook } from './dnaTypes'
import { extractCoverColor } from './spectrum'
import { profileFromApi, type DnaProfile } from './dnaProfile'
import DnaConstellation from './DnaConstellation'
import BookWorldCup from './BookWorldCup'
import BookGacha from './BookGacha'
import SajuBooks from './SajuBooks'
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
      setTones(Array.from({ length: TONE_COUNT }, (_, i) => src[Math.round(i * step)].hex))
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

/* ── 장르 레이더 ─────────────────────────────────────── */

const RADAR_SIZE = 250
const RADAR_R = 62

function radarPoint(i: number, count: number, r: number) {
  const a = (Math.PI * 2 * i) / count - Math.PI / 2
  return [RADAR_SIZE / 2 + Math.cos(a) * r, RADAR_SIZE / 2 + Math.sin(a) * r] as const
}

function Radar({ axes, tone }: { axes: DnaProfile['axes']; tone?: string }) {
  const n = axes.length
  const ring = (r: number) =>
    axes.map((_, i) => radarPoint(i, n, r).map((v) => v.toFixed(1)).join(',')).join(' ')
  const shape = axes
    .map((a, i) => radarPoint(i, n, (a.value / 100) * RADAR_R).map((v) => v.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg
      className="dnar-radar"
      viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
      role="img"
      aria-label={`장르 분포 — ${axes.map((a) => `${a.label} ${a.value}`).join(', ')}`}
    >
      {[0.34, 0.67, 1].map((k) => (
        <polygon key={k} className="dnar-radar__grid" points={ring(RADAR_R * k)} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = radarPoint(i, n, RADAR_R)
        return <line key={a.label} className="dnar-radar__spoke" x1={RADAR_SIZE / 2} y1={RADAR_SIZE / 2} x2={x} y2={y} />
      })}
      <polygon className="dnar-radar__shape" points={shape} style={tone ? { ['--tone' as string]: tone } : undefined} />
      {axes.map((a, i) => {
        const [x, y] = radarPoint(i, n, RADAR_R + 22)
        // 위·아래 꼭짓점은 가운데 정렬, 옆면은 도형 바깥쪽으로 밀어 낸다
        const anchor = i === 0 || i === n / 2 ? 'middle' : x > RADAR_SIZE / 2 ? 'start' : 'end'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} className="dnar-radar__label">
            <tspan>{a.label}</tspan>
            <tspan className="dnar-radar__value" x={x} dy="12">
              ({a.value})
            </tspan>
          </text>
        )
      })}
    </svg>
  )
}

/* ── 더 깊이 보는 테스트 4장 ──────────────────────────── */

/** 카드마다 다른 작은 선 그림 — 아이콘이 아니라 그 테스트가 무엇을 보는지의 도식 */
const TEST_ART: Record<string, ReactNode> = {
  gacha: (
    <>
      {/* 뽑기통에서 캡슐 하나가 굴러 나온다 */}
      <path d="M34 40 a18 18 0 1 1 36 0" fill="none" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <line x1="30" y1="40" x2="74" y2="40" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <circle cx="52" cy="27" r="5" fill="currentColor" opacity=".3" />
      <circle cx="94" cy="34" r="7" fill="currentColor" opacity=".85" />
      <path d="M80 40 q7 2 14 0" fill="none" stroke="currentColor" strokeWidth="1" opacity=".35" />
    </>
  ),
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
  saju: (
    <>
      {/* 오행 다섯 점 — 원으로 상생, 안쪽 별로 상극 */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2
        return <circle key={i} cx={60 + Math.cos(a) * 17} cy={22 + Math.sin(a) * 17} r="2.6" fill="currentColor" opacity=".8" />
      })}
      <circle cx="60" cy="22" r="17" fill="none" stroke="currentColor" strokeWidth="1" opacity=".4" />
      <polygon
        points={[0, 2, 4, 1, 3].map((i) => {
          const a = (Math.PI * 2 * i) / 5 - Math.PI / 2
          return `${(60 + Math.cos(a) * 17).toFixed(1)},${(22 + Math.sin(a) * 17).toFixed(1)}`
        }).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity=".28"
      />
    </>
  ),
  timeline: (
    <path
      d="M8 34 C 28 34, 34 10, 54 12 C 74 14, 76 36, 96 26 C 106 21, 110 14, 114 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
}

const TESTS = [
  {
    id: 'gacha',
    ready: true,
    kicker: 'Random Draw',
    name: '완전 랜덤 책 가챠',
    desc: '취향을 접어 두고 한 권을 뽑아, 그게 취향에서 얼마나 먼지 알려드려요.',
  },
  {
    id: 'worldcup',
    kicker: 'Book World Cup',
    name: '책 이상형 월드컵',
    desc: '두 권씩 맞붙여 지금 가장 읽고 싶은 한 권을 찾아드려요.',
    ready: true,
  },
  {
    id: 'saju',
    ready: true,
    kicker: 'Saju Reading',
    name: '사주로 보는 책',
    desc: '생년월일의 일주와 오행에 맞는 책을 골라드려요. 재미로 보는 콘텐츠예요.',
  },
  {
    id: 'timeline',
    ready: false,
    kicker: 'Taste Timeline',
    name: '내 취향의 변화',
    desc: '지금까지의 독서 기록으로 당신의 취향 변화를 살펴보세요.',
  },
] as const

const READY_COUNT = TESTS.filter((t) => t.ready).length

/* ── 화면 ────────────────────────────────────────────── */

function Report({ books, profile, tones, readCount }: { books: DnaBook[]; profile: DnaProfile; tones: string[] | null; readCount: number }) {
  // 아직 화면이 없는 카드는 죽은 버튼 대신 준비 중임을 그 자리에서 알린다
  const [pending, setPending] = useState<string | null>(null)
  /** 열려 있는 콘텐츠 대화상자 */
  const [open, setOpen] = useState<'gacha' | 'worldcup' | 'saju' | null>(null)
  // 콘텐츠 후보도 mock 인기도서가 아니라 실제 응답의 사용자 서재를 사용한다.
  const pool = books
  const canPlay = pool.length >= 4

  // 표지 더미는 별점이 높은 세 권 — 타입 패널의 오른쪽 아래를 채운다
  const top3 = [...books].sort((a, b) => b.rating - a.rating).slice(0, 3)
  const strongCount = Math.min(4, profile.keywords.length)

  return (
    <>
      {/* ── 히어로 ────────────────────────────────── */}
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
          <span className="dnar-utility">완독 {readCount}권의 장르·별점 분포에서 계산</span>
        </div>
      </section>

      {/* ── 테스트 4장 ────────────────────────────── */}
      <section>
        <div className="dnar-sechead">
          <h2 className="dnar-title">당신의 취향을 더 깊이 탐험해보세요.</h2>
          <span className="dnar-utility">
            {READY_COUNT}개 공개 · {TESTS.length - READY_COUNT}개 준비 중
          </span>
        </div>
        <ul className="dnar-tests">
          {TESTS.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                className="dnar-test"
                style={{ ['--tone' as string]: tones?.[i] ?? 'var(--eo-ink-faint)' }}
                onClick={() => {
                  if (!t.ready || !canPlay) return setPending(t.name)
                  setPending(null)
                  setOpen(t.id as 'gacha' | 'worldcup' | 'saju')
                }}
              >
                <span className="dnar-test__no">{String(i + 1).padStart(2, '0')}</span>
                <span className="dnar-test__kicker">{t.kicker}</span>
                <h3 className="dnar-test__name">{t.name}</h3>
                <p className="dnar-test__desc">{t.desc}</p>
                <svg className="dnar-test__art" viewBox="0 0 120 44" aria-hidden="true">
                  {TEST_ART[t.id]}
                </svg>
                <span className="dnar-test__go">{t.ready ? '시작하기 →' : '준비 중'}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dnar-note" role="status">
          {pending ? `「${pending}」는 아직 준비 중이에요 — 시안에서는 카드 구성만 확인합니다.` : ' '}
        </p>
      </section>

      {/* ── 요약 패널 3열 ─────────────────────────── */}
      <div className="dnar-bottom">
        <section className="dnar-panel">
          <h2 className="dnar-title">당신의 취향 한눈에 보기</h2>
          <Radar axes={profile.axes} tone={tones?.[0]} />
        </section>

        <section className="dnar-panel">
          <h2 className="dnar-title">자주 읽는 키워드</h2>
          <ul className="dnar-keywords">
            {profile.keywords.map((k, i) => (
              <li key={k} className={`dnar-keyword ${i < strongCount ? 'is-strong' : ''}`}>
                #{k}
              </li>
            ))}
          </ul>
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
          <div>
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

      {open === 'gacha' && <BookGacha pool={pool} axes={profile.axes} onClose={() => setOpen(null)} />}
      {open === 'worldcup' && (
        <BookWorldCup pool={pool} topAxis={profile.topAxis} onClose={() => setOpen(null)} />
      )}
      {open === 'saju' && <SajuBooks pool={pool} onClose={() => setOpen(null)} />}
    </>
  )
}

export default function DnaReportPage() {
  const { data, isLoading, isError } = useDna()
  const books = useMemo(() => (data?.books ?? []).map(toDnaBook), [data?.books])
  const tones = useCoverTones(books)
  const profile = data ? profileFromApi(data.profile, data.readCount) : null

  return (
    <main className="dnar">
      <div className="dnar__shell">
        {isLoading && <div className="dnar-skeleton" aria-label="불러오는 중" />}
        {(isError || (!isLoading && !data)) && (
          <p className="dnar-error">BOOK DNA를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        )}
        {data?.profile.status === 'INSUFFICIENT_DATA' && (
          <p className="dnar-error">읽은 책이 아직 충분하지 않아요. 책을 읽고 기록하면 BOOK DNA가 생성됩니다.</p>
        )}
        {data?.profile.status === 'READY' && profile && (
          <Report books={books} profile={profile} tones={tones} readCount={data.readCount} />
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
