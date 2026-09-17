/** BOOK DNA 분석 리포트.
 *
 *  히어로(독서타입 선언 + 성향 5지표)와 분석 패널을 한 지면에
 *  ① 히어로(독서타입 선언 + 성향 5지표) ② 더 깊이 보는 테스트 4장
 *  ③ 요약 패널(장르 레이더 · 키워드 · 한 줄 요약 · 독서타입)을 얹는다.
 *
 *  지표·레이더·키워드·타입은 FastAPI profile 응답을 사용하고, 화면의 색은
 *  실제 서재 책 표지에서 뽑는다(DESIGN.md). */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useDna } from '../../lib/useDna'
import { isDnaUnavailable, type DnaBookResponse } from '../../api/dna'
import { tagLabel, useTags } from '../../lib/useTags'
import type { DnaBook } from './dnaTypes'
import { displayTone, extractCoverColor } from './spectrum'
import { axisLabel, profileFromApi, type DnaProfile } from './dnaProfile'
import { useGachaPool } from './useGachaPool'
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

/* ── 장르 레이더 ─────────────────────────────────────── */

const RADAR_SIZE = 250
const RADAR_R = 62

function radarPoint(i: number, count: number, r: number) {
  const a = (Math.PI * 2 * i) / count - Math.PI / 2
  return [RADAR_SIZE / 2 + Math.cos(a) * r, RADAR_SIZE / 2 + Math.sin(a) * r] as const
}

/** 서버 axes 는 여섯 축의 합이 100 이 되게 정규화된 '지분'이다(계약 §4.4). 100 을 꽉 찬 반지름으로 삼으면
 *  고르게 읽는 사람은 반지름 17%짜리 바늘이 되어 도형이 아무 말도 하지 못한다.
 *  그래서 모양은 1위 축을 테두리에 두고 그 비율로 그리고, 숫자는 실제 지분 %로 적는다 —
 *  모양은 균형을, 숫자는 크기를 말하게 나눈다. */
function Radar({ axes, tone }: { axes: DnaProfile['axes']; tone?: string }) {
  const n = axes.length
  const peak = Math.max(...axes.map((a) => a.value), 1)
  const ring = (r: number) =>
    axes.map((_, i) => radarPoint(i, n, r).map((v) => v.toFixed(1)).join(',')).join(' ')
  const shape = axes
    .map((a, i) => radarPoint(i, n, (a.value / peak) * RADAR_R).map((v) => v.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg
      className="dnar-radar"
      viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
      role="img"
      aria-label={`장르 지분 — ${axes.map((a) => `${a.label} ${a.value}%`).join(', ')}`}
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
              {a.value}%
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
    desc: '취향을 접어 두고 아무 책이나 한 권 뽑아, 그게 취향에서 얼마나 먼지 알려드려요.',
  },
  {
    id: 'worldcup',
    kicker: 'Book World Cup',
    name: '책 이상형 월드컵',
    desc: '서재의 책을 두 권씩 맞붙여 지금 가장 손이 가는 한 권을 찾아드려요.',
    ready: true,
  },
  {
    id: 'saju',
    ready: true,
    kicker: 'Saju Reading',
    name: '사주로 보는 책',
    desc: '생년월일의 일주와 오행에 맞는 책을 서재에서 골라드려요. 재미로 보는 콘텐츠예요.',
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

function Report({ books, profile, tones, basis, declaredTags, topGenres }: {
  books: DnaBook[]
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
  /** 열려 있는 콘텐츠 대화상자 */
  const [open, setOpen] = useState<'gacha' | 'worldcup' | 'saju' | null>(null)
  // 콘텐츠 후보는 실제 응답의 사용자 서재다. 세 콘텐츠 모두 표지를 보여 주고 고르게 하므로
  // 표지가 없는 책은 후보에서 뺀다 — 빈 자리가 대진표에 섞이면 고를 수가 없다
  const pool = useMemo(() => books.filter((b) => b.coverUrl !== ''), [books])
  const canPlay = pool.length >= 4
  // 가챠만 후보가 다르다 — '완전 랜덤'이니 내 서재가 아니라 책 전체에서 뽑는다
  const gachaPool = useGachaPool()

  // 표지 더미는 별점이 높은 세 권 — 타입 패널의 오른쪽 아래를 채운다
  const top3 = books.filter((b) => b.coverUrl !== '').sort((a, b) => b.rating - a.rating).slice(0, 3)
  const strongCount = Math.min(4, profile.keywords.length)

  /** 카드를 열 수 없으면 그 이유를 그 자리에서 말한다 — 눌러도 아무 일 없는 버튼을 두지 않는다 */
  const blockedReason = (t: (typeof TESTS)[number]): string | null => {
    if (!t.ready) return `「${t.name}」는 아직 준비 중이에요.`
    if (t.id === 'gacha')
      return gachaPool.length > 0 ? null : '뽑을 책 목록을 아직 불러오지 못했어요. 잠시 후 다시 열어 주세요.'
    return canPlay ? null : `「${t.name}」는 표지가 있는 책이 4권 이상일 때 열려요 — 지금 서재에는 ${pool.length}권이에요.`
  }

  // 관심 태그 라벨은 사전(GET /tags)에서 가져온다 — 서버는 공개 코드(FICTION)로 준다
  const { data: tags } = useTags('GENRE')
  const declared = declaredTags.map((code) => tagLabel(code, tags).replace(/^#/, ''))
  const actual = topGenres.map(axisLabel)

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
                  const why = blockedReason(t)
                  if (why) return setPending(why)
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
          {pending ?? ' '}
        </p>
      </section>

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

      {open === 'gacha' && <BookGacha pool={gachaPool} axes={profile.axes} onClose={() => setOpen(null)} />}
      {open === 'worldcup' && (
        <BookWorldCup pool={pool} topAxis={profile.topAxis} onClose={() => setOpen(null)} />
      )}
      {open === 'saju' && <SajuBooks pool={pool} onClose={() => setOpen(null)} />}
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
              <button type="button" className="dnar-notice__action" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? '다시 부르는 중…' : '다시 시도'}
              </button>
            }
          />
        )}
        {/* 읽은 책은 있는데 전부 인덱스에 없어 계산이 안 된 경우와, 정말 읽은 책이 없는 경우는 다른 말을 해야 한다 */}
        {data?.profile.status === 'INSUFFICIENT_DATA' && (
          <DnaNotice
            title={data.readCount > 0 ? '아직 분석할 수 있는 책이 없어요.' : '읽은 책을 기록하면 DNA가 만들어져요.'}
            body={
              data.readCount > 0
                ? `완독 ${data.readCount}권이 아직 분석 데이터에 없어 BOOK DNA를 만들 수 없어요. 분석 데이터가 늘어나면 자동으로 반영돼요.`
                : '완독한 책의 장르와 별점이 쌓이면 취향의 축·성향 지표·독서타입을 계산해 드려요.'
            }
            action={
              data.readCount > 0 ? undefined : (
                <Link className="dnar-notice__action" to="/search">
                  읽은 책 기록하러 가기
                </Link>
              )
            }
          />
        )}
        {data?.profile.status === 'READY' && profile && basis && (
          <Report
            books={books}
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
