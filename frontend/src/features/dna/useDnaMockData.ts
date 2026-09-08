/** DNA 시안 검증용 mock 데이터 — 인기도서 링의 로컬 표지 90권을 재료로
 *  독서 성향이 다른 가상 유저 3명(페르소나)의 서재를 조립한다.
 *
 *  검증 포인트: 서재 구성이 다르면 취향 스펙트럼이 실제로 갈라지는가.
 *  정식 구현에서는 이 훅이 GET /users/me/dna (user_library 집계) 응답으로 대체된다. */
import { useQuery } from '@tanstack/react-query'

export interface DnaBook {
  isbn13: string
  title: string
  author: string
  classNo: string
  coverUrl: string
  rating: number // 1~5 — mock에서는 isbn 해시로 고정 배정
  finishedAt: string // YYYY-MM-DD
}

export interface DnaPersona {
  id: string
  label: string
  note: string
  /** 온보딩에서 "선언"한 관심 태그 — 행동(완독 집계)과 비교하는 축 */
  declaredTags: string[]
  books: DnaBook[]
}

interface RawBook {
  title: string
  author: string
  isbn13: string
  classNo: string
  coverUrl: string | null
}
interface RawData {
  segments: { items: RawBook[] }[]
}

/** KDC 분류번호 → 화면에 쓰는 장르 라벨 */
export function genreLabel(classNo: string): string {
  if (classNo.startsWith('813')) return '한국소설'
  if (classNo.startsWith('833')) return '일본소설'
  if (classNo.startsWith('818') || classNo.startsWith('814')) return '에세이'
  const main = classNo[0]
  return (
    { '0': '총류', '1': '철학·심리', '2': '종교', '3': '사회과학', '4': '자연과학', '5': '기술과학', '6': '예술', '7': '언어', '8': '문학', '9': '역사' }[main] ?? '기타'
  )
}

/** isbn 문자열 해시 → 0~1. mock 평점·날짜를 렌더마다 흔들리지 않게 고정한다 */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

/** "지음", "글쓴이:" 등 저자 표기 잡음 제거 */
function cleanAuthor(a: string): string {
  return a.replace(/^글쓴이\s*[:：]\s*/, '').split(/\s*(지음|저|글|·|;|,)\s*/)[0].trim() || a
}

function toDnaBook(b: RawBook, order: number, total: number): DnaBook {
  const r = hash01(b.isbn13)
  // 최근 6개월에 완독일을 분산 배치 — order가 클수록 최근
  const daysAgo = Math.round((1 - order / Math.max(1, total - 1)) * 180)
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return {
    isbn13: b.isbn13,
    title: b.title,
    author: cleanAuthor(b.author),
    classNo: b.classNo || '000',
    coverUrl: b.coverUrl as string,
    rating: r > 0.6 ? 5 : r > 0.25 ? 4 : 3,
    finishedAt: d.toISOString().slice(0, 10),
  }
}

/** 로컬 표지가 있는 책만, isbn 중복 제거 */
function rawPool(raw: RawData): RawBook[] {
  const seen = new Set<string>()
  const pool: RawBook[] = []
  for (const seg of raw.segments)
    for (const b of seg.items) {
      if (!b.coverUrl || !b.coverUrl.startsWith('/covers') || seen.has(b.isbn13)) continue
      seen.add(b.isbn13)
      pool.push(b)
    }
  return pool
}

function buildPersonas(pool: RawBook[]): DnaPersona[] {
  const lit = pool.filter((b) => b.classNo.startsWith('813'))
  const jlit = pool.filter((b) => b.classNo.startsWith('833'))
  const essay = pool.filter((b) => /^(81[48]|1)/.test(b.classNo))
  const nonfic = pool.filter((b) => /^[034579]/.test(b.classNo))

  const assemble = (id: string, label: string, note: string, declaredTags: string[], picks: RawBook[]): DnaPersona => ({
    id,
    label,
    note,
    declaredTags,
    books: picks.slice(0, 14).map((b, i, arr) => toDnaBook(b, i, arr.length)),
  })

  return [
    assemble('novel', '소설파', '한국소설 중심 + 일본소설 조금', ['한국소설', 'SF', '힐링'], [...lit.slice(0, 11), ...jlit.slice(0, 3)]),
    assemble('essay', '에세이·인문파', '에세이와 철학·심리 위주', ['에세이', '철학·심리', '자기계발'], [...essay, ...nonfic.filter((b) => b.classNo.startsWith('3'))].slice(0, 14)),
    assemble(
      'omni',
      '잡식파',
      '문학·비문학 고르게',
      ['역사', '자연과학', '한국소설'],
      [0, 1, 2, 3].flatMap((i) => [lit[i], nonfic[i], essay[i], jlit[i]]).filter(Boolean),
    ),
  ]
}

interface DnaMock {
  personas: DnaPersona[]
  /** 표지가 있는 책 전체 — 이상형 월드컵처럼 페르소나 서재(14권)보다 많은 후보가 필요한 곳에서 쓴다 */
  pool: DnaBook[]
}

/** 두 훅이 같은 queryKey를 공유해 fetch는 한 번만 일어난다. 각자 select로 필요한 조각만 본다. */
const mockQuery = {
  queryKey: ['dna-mock'] as const,
  queryFn: async (): Promise<DnaMock> => {
    const res = await fetch('/data/popular-ring.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error('mock 재료(인기도서 데이터)를 불러오지 못했습니다.')
    const pool = rawPool((await res.json()) as RawData)
    return { personas: buildPersonas(pool), pool: pool.map((b, i, arr) => toDnaBook(b, i, arr.length)) }
  },
  staleTime: Infinity,
}

export function useDnaMockData() {
  return useQuery({ ...mockQuery, select: (d: DnaMock) => d.personas })
}

/** 이상형 월드컵의 후보 풀 */
export function useDnaBookPool() {
  return useQuery({ ...mockQuery, select: (d: DnaMock) => d.pool })
}
