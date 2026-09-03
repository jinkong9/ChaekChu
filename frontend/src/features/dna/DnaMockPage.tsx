/** BOOK DNA 시안 (mock) — Editorial Orbit 문법으로 구성한 취향 분석 페이지.
 *
 *  구성: 취향 스펙트럼(히어로) → 장르 → 작가 → 선언 vs 행동 → 최근 성향.
 *  화면의 색은 전부 완독 책 표지에서 추출한다(DESIGN.md: "표지가 색을 담당한다").
 *  상단 페르소나 전환은 시안 검증용 장치 — 서재가 다르면 스펙트럼이 갈라지는지 본다. */
import { useEffect, useMemo, useState } from 'react'
import { useDnaMockData, genreLabel, type DnaBook, type DnaPersona } from './useDnaMockData'
import { extractCoverColor, buildSpectrum, type SpectrumStop } from './spectrum'
import { coverAtWidth } from '../../lib/coverUrl'
import './dna-mock.css'

/** 평점 → 띠에서 차지하는 폭. 좋아한 책일수록 취향 지분이 크다 */
const ratingWeight = (r: number) => (r >= 5 ? 1.6 : r >= 4 ? 1.2 : 0.8)

/** 서재의 표지들에서 색을 추출해 스펙트럼을 만든다 */
function useSpectrum(books: DnaBook[]) {
  const [stops, setStops] = useState<SpectrumStop[] | null>(null)
  useEffect(() => {
    let alive = true
    setStops(null)
    Promise.all(
      books.map(async (b) => ({
        isbn13: b.isbn13,
        coverUrl: b.coverUrl,
        title: b.title,
        color: await extractCoverColor(b.coverUrl),
        weight: ratingWeight(b.rating),
      })),
    ).then((s) => alive && setStops(s))
    return () => {
      alive = false
    }
  }, [books])
  return useMemo(() => (stops ? buildSpectrum(stops) : null), [stops])
}

/** 장르별 집계 — 평점 가중 count 순 */
function genreStats(books: DnaBook[]) {
  const map = new Map<string, { label: string; count: number; weight: number; covers: string[] }>()
  for (const b of books) {
    const label = genreLabel(b.classNo)
    const g = map.get(label) ?? { label, count: 0, weight: 0, covers: [] }
    g.count += 1
    g.weight += ratingWeight(b.rating)
    if (g.covers.length < 6) g.covers.push(b.coverUrl)
    map.set(label, g)
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight)
}

function authorStats(books: DnaBook[]) {
  const map = new Map<string, { name: string; count: number; best: DnaBook }>()
  for (const b of books) {
    const a = map.get(b.author)
    if (!a) map.set(b.author, { name: b.author, count: 1, best: b })
    else {
      a.count += 1
      if (b.rating > a.best.rating) a.best = b
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 3)
}

/** 규칙 기반 요약 한 줄 — LLM 없이 집계만으로 만든다 */
function summary(persona: DnaPersona) {
  const genres = genreStats(persona.books)
  if (genres.length === 0) return '아직 스펙트럼이 비어 있어요'
  const root = genres[0].label
  const recent = [...persona.books].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 5)
  const recentTop = genreStats(recent)[0]?.label
  if (!recentTop || recentTop === root) return `${root}로 일관된 취향의 독서가`
  return `${root}에 뿌리를 둔, 요즘은 ${recentTop}로 기우는 독서가`
}

function CoverStrip({ books, width = 34 }: { books: { coverUrl: string; title: string }[]; width?: number }) {
  return (
    <div className="dna-strip" style={{ ['--strip-w' as string]: `${width}px` }}>
      {books.map((b) => (
        <img key={b.coverUrl + b.title} src={coverAtWidth(b.coverUrl, width) ?? b.coverUrl} alt={b.title} title={b.title} loading="lazy" decoding="async" />
      ))}
    </div>
  )
}

export default function DnaMockPage() {
  const { data: personas, isLoading, isError } = useDnaMockData()
  const [personaId, setPersonaId] = useState('novel')
  const persona = personas?.find((p) => p.id === personaId) ?? personas?.[0]
  const spectrum = useSpectrum(persona?.books ?? [])

  if (isLoading) return <main className="dna-mock"><div className="dna-skeleton" aria-label="불러오는 중" /></main>
  if (isError || !persona)
    return (
      <main className="dna-mock">
        <p className="dna-error">mock 재료를 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.</p>
      </main>
    )

  const genres = genreStats(persona.books)
  const authors = authorStats(persona.books)
  const recent = [...persona.books].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 5)
  const behaviorTags = genres.slice(0, 4).map((g) => g.label)

  return (
    <main className="dna-mock">
      <div className="dna-toolbar">
        <span className="dna-utility">MOCK · 시안 검증용 — 페르소나를 바꿔 스펙트럼이 갈라지는지 확인</span>
        <div className="dna-personas" role="tablist" aria-label="가상 유저 전환">
          {personas!.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === persona.id} className={`dna-persona ${p.id === persona.id ? 'is-active' : ''}`} onClick={() => setPersonaId(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 히어로: 취향 스펙트럼 ─────────────────────────── */}
      <section className="dna-hero">
        <h1 className="dna-section-title">나의 취향 스펙트럼</h1>
        <p className="dna-headline">{summary(persona)}</p>
        {spectrum ? (
          <figure className="dna-spectrum" key={persona.id}>
            <div className="dna-spectrum__band" role="img" aria-label="완독한 책 표지 색으로 만든 취향 스펙트럼" style={{ background: spectrum.css }} />
            <figcaption className="dna-utility">완독 {persona.books.length}권의 표지에서 추출 · 좋아한 책일수록 넓은 폭 · 완독이 쌓이면 색이 변합니다</figcaption>
            <CoverStrip books={spectrum.ordered.slice(0, 20)} width={30} />
            {spectrum.ordered.length > 20 && <span className="dna-utility">표지는 취향 지분 상위 20권만 표시 — 외 {spectrum.ordered.length - 20}권</span>}
          </figure>
        ) : (
          <div className="dna-skeleton" aria-label="스펙트럼 계산 중" />
        )}
      </section>

      <div className="dna-grid">
      {/* ── 장르 ─────────────────────────────────────────── */}
      <section className="dna-section">
        <h2 className="dna-section-title">선호 장르</h2>
        <ul className="dna-genres">
          {genres.map((g, i) => (
            <li key={g.label} className="dna-genre">
              <span className="dna-genre__rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="dna-genre__label">{g.label}</span>
              <span className="dna-genre__count">{g.count}권</span>
              <CoverStrip books={g.covers.map((c) => ({ coverUrl: c, title: g.label }))} width={26} />
            </li>
          ))}
        </ul>
      </section>

      {/* ── 작가 ─────────────────────────────────────────── */}
      <section className="dna-section">
        <h2 className="dna-section-title">자주 만난 작가</h2>
        <ul className="dna-authors">
          {authors.map((a) => (
            <li key={a.name}>
              <span className="dna-authors__name">{a.name}</span>
              <span className="dna-authors__meta">{a.count}권 · 최고 별점 {'★'.repeat(a.best.rating)}</span>
              <span className="dna-authors__best">가장 좋았던 책 — {a.best.title}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 선언 vs 행동 ─────────────────────────────────── */}
      <section className="dna-section">
        <h2 className="dna-section-title">말한 취향, 진짜 취향</h2>
        <div className="dna-compare">
          <div className="dna-compare__row">
            <span className="dna-utility">온보딩에서 고른 관심사</span>
            <div>
              {persona.declaredTags.map((t) => (
                <span key={t} className={`dna-chip ${behaviorTags.includes(t) ? 'is-matched' : ''}`}>{t}</span>
              ))}
            </div>
          </div>
          <div className="dna-compare__row">
            <span className="dna-utility">실제 완독이 말하는 취향</span>
            <div>
              {behaviorTags.map((t) => (
                <span key={t} className={`dna-chip ${persona.declaredTags.includes(t) ? 'is-matched' : ''}`}>{t}</span>
              ))}
            </div>
          </div>
          <p className="dna-utility">진하게 칠해진 태그 = 선언과 행동이 일치한 취향</p>
        </div>
      </section>

      {/* ── 최근 성향 ────────────────────────────────────── */}
      <section className="dna-section">
        <h2 className="dna-section-title">최근 다섯 권의 방향</h2>
        <div className="dna-recent">
          <CoverStrip books={recent} width={72} />
          <p className="dna-recent__note">
            {recent[0] ? `${recent[0].finishedAt.replaceAll('-', '.')} 「${recent[0].title}」까지 — 최근은 ${genreStats(recent)[0]?.label} 쪽으로 움직이는 중` : ''}
          </p>
        </div>
      </section>
      </div>
    </main>
  )
}
