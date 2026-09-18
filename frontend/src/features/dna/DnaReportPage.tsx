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
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useDna } from '../../lib/useDna'
import { isDnaUnavailable, type DnaBookResponse, type DnaScore } from '../../api/dna'
import { api } from '../../api/client'
import type { LibraryItem } from '../../api/types'
import type { DnaBook } from './dnaTypes'
import { accentOf, displayTone, extractCoverColor } from './spectrum'
import { profileFromApi, type DnaProfile } from './dnaProfile'
import { buildHabits } from './habits'
import DnaEvidenceB from './DnaEvidenceB'
import ReadingTypeField from './ReadingTypeField'
import BookWorldCup from './BookWorldCup'
import BookGacha from './BookGacha'
import { GachaMachineArt } from './GachaMachine'
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

/** 히어로 — 왼쪽은 문장, 오른쪽은 활자가 모여 쓰는 독서타입 이름.
 *
 *  제호(BOOK DNA)는 문장 위 작은 세리프 낙관으로 물러난다. 헤드라인과 타입 이름이
 *  둘 다 본문 글꼴이라 같은 집안이고, 크기로만 위계가 갈린다 — 주인공은 타입 이름이다.
 *
 *  `serif` 는 그 타입 이름을 한글 세리프로 쓴다(리포트 본문의 독서타입 이름과 같은 얼굴). */
function Hero({ profile, tones }: { profile: DnaProfile; tones: string[] | null }) {
  // 다섯 줄을 다섯 색으로 칠하면 무지개가 된다. 값의 차이는 길이가 말하므로 색은 하나면 된다
  const accent = accentOf(tones) ?? 'var(--eo-ink)'
  return (
    <section className="dnar-hero-c" aria-label="BOOK DNA">
      <div className="dnar-hero-c__main">
        <div className="dnar-hero-c__intro">
          {/* 제호가 눈썹 자리를 대신한다 — 둘을 같이 세우면 머리가 두 개다 */}
          <span className="dnar-hero-c__mark">BOOK DNA</span>
          <h1 className="dnar-hero-c__title is-bcopy">
            읽은 책이 모여
            <br />
            <em>당신의 취향</em>이 됩니다.
          </h1>
        </div>
        <div className="dnar-hero-c__visual">
          <ReadingTypeField typeName={profile.type.name} tones={tones} />
          <div className="dnar-hero-c__caption">
            <span>YOUR READING TYPE · {profile.type.code}</span>
            <p>{profile.type.phrase}</p>
          </div>
          {/* 지표 다섯은 이 이름의 근거다 — 1위가 이름을, 2위가 수식어를 만든다(AI 의 _metric_type).
              지면 맨 아래 띠로 두면 히어로의 각주처럼 읽혀 그 인과가 보이지 않는다. 이름 바로 아래 둔다. */}
          <div className="dnar-hero-c__metrics">
            {profile.metrics.map((metric) => (
              <div className="dnar-hero-c__metric" key={metric.key}>
                <div><span>{metric.key}</span><strong>{metric.value}%</strong></div>
                <span className="dnar-hero-c__track"><span style={{ width: `${metric.value}%`, background: accent }} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── 더 깊이 보는 테스트 ──────────────────────────── */

/** 둘 다 내 서재 밖에서 고른다 — 가챠는 책 전체에서, 월드컵은 대출 상위 요약 풀에서(서버 편성). */
const TESTS = [
  {
    id: 'gacha',
    name: '완전 랜덤 책 가챠',
  },
  {
    id: 'worldcup',
    name: '책 이상형 월드컵',
  },
] as const

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

/* ── 화면 ────────────────────────────────────────────── */

function Report({ records, profile, keywords, tones, declaredTags }: {
  /** 서버 응답 그대로 — 쪽수·출간 연도·분류처럼 화면 타입(DnaBook)이 버린 값을 독서 습관이 쓴다 */
  records: DnaBookResponse[]
  /** 점수를 가진 원본 키워드 — 새 안이 칩 농도를 점수로 정한다 */
  keywords: DnaScore[]
  profile: DnaProfile
  tones: string[] | null
  /** 온보딩에서 내가 고른 관심 태그 (공개 taxonomy code) */
  declaredTags: string[]
}) {
  // 아직 화면이 없는 카드는 죽은 버튼 대신 준비 중임을 그 자리에서 알린다
  const [pending, setPending] = useState<string | null>(null)

  /* 열려 있는 콘텐츠는 주소에 둔다(?play=gacha).
     useState 로 들고 있으면 대화상자가 히스토리에 없어서, 뒤로가기가 대화상자가 아니라
     이 페이지를 떠나 버린다. 주소에 두면 뒤로가기는 대화상자만 닫고 리포트에 남는다.
     새로고침·링크 공유로 바로 열리는 것은 덤이다. */
  const [params, setParams] = useSearchParams()
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
  const habits = useMemo(() => buildHabits(records), [records])
  /** 이미 읽은 책의 ISBN — 가챠 후보에서 뺀다 */
  const readIsbns = useMemo(
    () => new Set(records.filter((b) => b.status === 'READ' && b.isbn13).map((b) => b.isbn13)),
    [records],
  )

  /** 카드를 열 수 없으면 그 이유를 그 자리에서 말한다 — 눌러도 아무 일 없는 버튼을 두지 않는다.
   *  지금은 둘 다 서재와 무관하게 늘 열린다(후보를 서버에서 받아 온다). 서재 조건이 다시 생기면 여기서 막는다 */
  const blockedReason = (): string | null => null

  return (
    <>
      {/* ── 히어로 ────────────────────────────────── */}
      <Hero profile={profile} tones={tones} />

      {/* ── 근거 구역 ─────────────────────────────── */}
      <DnaEvidenceB
        profile={profile}
        records={records}
        habits={habits}
        keywords={keywords}
        declaredTags={declaredTags}
        tones={tones}
        habitArt={HABIT_ART}
      />

      {/* ── 콘텐츠 2장 — 리포트를 다 읽은 뒤의 다음 걸음 ── */}
      <section className="dnar-plays">
        <div className="dnar-sechead">
          <h2 className="dnar-title">리포트를 덮고, 한 번 해 볼까요?</h2>
        </div>
        <ul className="dnar-tests">
          {TESTS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="dnar-test dnar-test--feature"
                onClick={() => {
                  const why = blockedReason()
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
                    <h3 className="dnar-test__name">{t.name}</h3>
                    <span className="dnar-test__duel" aria-hidden="true">
                      {/* 후보는 익명이다 — 내 서재 표지를 미리보기에 쓰면 거짓 예고가 된다 */}
                      <span className="dnar-test__duel-book dnar-test__duel-book--left dnar-test__duel-book--anon">?</span>
                      <span className="dnar-test__duel-vs">VS</span>
                      <span className="dnar-test__duel-book dnar-test__duel-book--right dnar-test__duel-book--anon">?</span>
                    </span>
                    <span className="dnar-test__go">고르러 가기 →</span>
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
      {open === 'gacha' && <BookGacha read={readIsbns} onClose={closePlay} />}
      {open === 'worldcup' && <BookWorldCup onClose={closePlay} />}
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
  /* DNA 호출이 실패하면 그것만으로는 원인을 알 수 없다 — 서버가 아픈 것인지, 애초에 기록이
     없어서 만들 게 없는 것인지. 서재는 다른 API 라 그때 한 번 물어본다(서재 화면과 같은 캐시).
     기록이 없다면 "다시 시도"는 아무 소용이 없고, 책을 기록하라고 말해야 맞다. */
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
    enabled: isError,
    retry: false,
  })
  const nothingRecorded = isError && library?.length === 0
  const books = useMemo(() => (data?.books ?? []).map(toDnaBook), [data?.books])
  const tones = useCoverTones(books)
  const profile = data ? profileFromApi(data.profile, data.readCount) : null

  return (
    <main className="dnar">
      <div className="dnar__shell">
        {isLoading && <div className="dnar-skeleton" aria-label="불러오는 중" />}
        {/* 503 DNA_UNAVAILABLE 은 분석 쪽만 쉬는 것이다 — 서재·검색은 멀쩡하다고 말해 줘야 이탈하지 않는다 */}
        {(isError || (!isLoading && !data)) && (
          <DnaNotice
            title={nothingRecorded ? '아직 기록한 책이 없어요.' : 'BOOK DNA를 만들지 못했어요.'}
            body={
              nothingRecorded
                ? '읽은 책을 검색해 별점과 한 줄 후기를 남겨 주세요. 한 권부터 시작되고, 세 권쯤 쌓이면 취향의 축·성향 지표·독서타입이 제 모습을 갖춥니다.'
                : isDnaUnavailable(error)
                  ? '분석 서버가 잠시 쉬고 있어요. 서재와 검색은 그대로 쓸 수 있고, 잠시 뒤 다시 시도하면 돼요.'
                  : '잠시 후 다시 시도해 주세요.'
            }
            action={
              // 기록이 없어서 못 만든 거라면 '다시 시도'는 눌러도 달라질 게 없다 — 책을 기록하러 보낸다
              <div className="dnar-notice__actions">
                {nothingRecorded ? (
                  <Link className="dnar-notice__action" to="/search">
                    읽은 책 검색해서 기록하기
                  </Link>
                ) : (
                  <button type="button" className="dnar-notice__action" onClick={() => refetch()} disabled={isFetching}>
                    {isFetching ? '다시 부르는 중…' : '다시 시도'}
                  </button>
                )}
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
                : '읽은 책을 검색해 별점과 한 줄 후기를 남겨 주세요. 한 권부터 시작되고, 세 권쯤 쌓이면 취향의 축·성향 지표·독서타입이 제 모습을 갖춥니다.'
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
        {data?.profile.status === 'READY' && profile && (
          <Report
            records={data.books}
            keywords={data.profile.keywords}
            profile={profile}
            tones={tones}
            declaredTags={data.declaredTags}
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
