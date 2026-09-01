import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { coverPalette } from '../lib/coverPalette'
import { coverAtWidth } from '../lib/coverUrl'
import { glassine } from '../lib/glassine'
import LibraryList from '../components/LibraryList'

/** LIB-001 내 서재 B안 — 완독한 책의 표지로 엮은 "나의 책".
 *
 *  A안(선반)은 상태별 선반에 표지를 늘어놓는다. B안은 완독만 특별 취급한다:
 *  완독한 책 한 권 = 내 책의 한 장(왼쪽 표지 · 오른쪽 독서 기록)이고,
 *  읽는 중과 찜은 "아직 책이 되지 못한 상태"로 보인다.
 *    완독   → 활짝 펼친 스프레드
 *    읽는 중 → 책갈피가 내려온 표지 (리본 길이 = 진행률)
 *    찜     → 유산지 봉투에 든 표지 (추천 B·C안과 같은 재질)
 *
 *  시안: https://claude.ai/code/artifact/24acbc94-9fe0-4215-a953-d6c9c55a6ec8
 *  레퍼런스: recent.design "Personal Site Hero" (스케치북 캐러셀) */

/** 스프레드 한 면의 크기. 넘김이 제본선을 축으로 돌기 때문에 두 면이 같은 폭이어야 한다. */
const PAGE_W = 382
const PAGE_H = 544
const FLIP_MS = 940

const NTH = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

/** 종이 결 — index.css의 --paper-noise를 그대로 쓴다 (이미지 파일 없이 질감) */
const paperFace: CSSProperties = {
  backgroundColor: 'var(--color-paper)',
  backgroundImage: 'var(--paper-noise)',
  backgroundSize: '180px 180px',
  backgroundBlendMode: 'multiply',
}

const nth = (i: number) => NTH[i] ?? `${i + 1}`
const ordinal = (i: number) => String(i + 1).padStart(2, '0')
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts.join(' › ') || '미분류'
}
const ymd = (d: string | null) => {
  if (!d) return null
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}

/** 왼쪽 면 — 표지 한 장. 표지가 없거나 깨지면 색 커버로 떨어진다 (BookCover와 같은 팔레트). */
function CoverFace({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 314) : null
  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[314px] h-[462px] overflow-hidden rounded-l-sm rounded-r"
          style={{
            background: c.bg, color: c.fg,
            boxShadow: '5px 9px 24px rgba(34,34,74,.34), 0 0 0 1px rgba(34,34,74,.10)',
          }}>
          {url ? (
            <img src={url} alt={li.book.title} referrerPolicy="no-referrer" onError={() => setBroken(true)}
              className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="h-full flex flex-col justify-between p-6">
              <span className="font-bold text-2xl leading-snug">{li.book.title}</span>
              <span className="text-sm opacity-80">{li.book.author}</span>
            </div>
          )}
        </div>
      </div>
      <span className="absolute left-[30px] bottom-4 text-[11px] tracking-[.14em] text-primary/40">
        {li.finishedDate ?? ''}
      </span>
    </>
  )
}

/** 오른쪽 면 — 독서 기록(A안). 서재에 이미 있는 필드만 쓴다:
 *  별점 · 완독일 · 한 줄 감상평 · 분류 · 쪽수. 새 API가 필요 없다. */
function RecordFace({ li, no }: { li: LibraryItem; no: string }) {
  const rating = li.rating ?? 0
  return (
    <>
      <div className="absolute inset-0 flex flex-col px-[34px] pt-[34px] pb-10">
        <span className="text-[10px] tracking-[.26em] text-primary/40">완독 기록</span>
        <h3 className="font-display text-3xl leading-snug mt-4 text-pretty">{li.book.title}</h3>
        <p className="text-[13px] text-primary/55 mt-1.5">
          {li.book.author}{li.book.publisher ? ` · ${li.book.publisher}` : ''}
        </p>
        <div className="h-px bg-primary/15 mt-5" />

        {li.rating != null ? (
          <div className="flex items-center gap-1 mt-5">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`text-xl leading-none ${n <= rating ? 'text-accent' : 'text-primary/15'}`}>★</span>
            ))}
            <span className="font-display text-base ml-1.5">{rating}.0</span>
          </div>
        ) : (
          <p className="mt-5 text-[13px] text-primary/40">별점은 목록 뷰에서 남길 수 있어요</p>
        )}

        <p className="text-[13px] text-primary/60 mt-3.5">{ymd(li.finishedDate) ?? '완독일 미기록'} 완독</p>

        {/* 감상평이 이 장의 주인공이다. 비어 있으면 채우도록 유도한다. */}
        {li.reviewText ? (
          <p className="font-hand text-[25px] leading-[37px] mt-6"
            style={{
              color: 'var(--color-ink-pen)',
              backgroundImage: 'repeating-linear-gradient(180deg, transparent 0 36px, rgba(34,34,74,.11) 36px 37px)',
              backgroundPosition: '0 5px',
            }}>
            {li.reviewText}
          </p>
        ) : (
          <p className="mt-6 text-[13px] leading-relaxed text-primary/40">
            이 장은 아직 비어 있어요.<br />목록 뷰에서 한 줄 남기면 여기에 적힙니다.
          </p>
        )}

        <div className="mt-auto flex items-center gap-2.5">
          <span className="border-[1.5px] border-primary/25 rounded-full px-2.5 py-[3px] text-[11px] text-primary/60 whitespace-nowrap">
            {categoryKey(li)}
          </span>
          {li.book.pageCount != null && <span className="text-[11px] text-primary/45">{li.book.pageCount}쪽</span>}
          <Link to={`/books/${li.book.bookId}`} className="ml-auto text-[11px] text-primary/40 border-b border-dashed border-primary/30">
            상세 보기
          </Link>
        </div>
      </div>
      <span className="absolute right-[30px] bottom-4 font-display text-xs tracking-[.2em] text-primary/40">{no}</span>
    </>
  )
}

type Leaf = { dir: 'next' | 'prev'; i: number; j: number }

/** 나의 책 — 진짜 책과 같은 방식으로 한 장이 돈다.
 *
 *  돌아가는 종이 한 장의 앞면은 A의 기록, 뒷면은 B의 표지다.
 *  그래서 -180도까지 돌면 왼쪽에 B의 표지가 내려앉고,
 *  그 아래 미리 깔아 둔 B의 기록이 오른쪽에 드러난다 — 끊김 없이 다음 장이 된다.
 *  (두 면을 동시에 움직이면 책이 아니라 슬라이드로 보인다) */
function MyBook({ items, index, onIndex }: {
  items: LibraryItem[]; index: number; onIndex: (i: number) => void
}) {
  const [leaf, setLeaf] = useState<Leaf | null>(null)
  const [angle, setAngle] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const turn = (dir: 'next' | 'prev', target?: number) => {
    if (leaf || items.length < 2) return
    const n = items.length
    const j = target ?? (dir === 'next' ? (index + 1) % n : (index - 1 + n) % n)
    if (j === index) return
    setLeaf({ dir, i: index, j })
    setAngle(dir === 'next' ? 0 : -180)
    // 마운트된 다음 프레임에 목표 각도를 줘야 transition이 걸린다
    timers.current.push(setTimeout(() => setAngle(dir === 'next' ? -180 : 0), 40))
    timers.current.push(setTimeout(() => { onIndex(j); setLeaf(null); setAngle(0) }, FLIP_MS + 140))
  }

  // A = 먼저 놓인 장, B = 나중 장. 넘김 중이 아니면 둘 다 현재 장.
  const iA = leaf ? (leaf.dir === 'next' ? leaf.i : leaf.j) : index
  const iB = leaf ? (leaf.dir === 'next' ? leaf.j : leaf.i) : index
  const a = items[iA]
  const b = items[iB]
  if (!a || !b) return null

  const faceBase = 'absolute inset-0 overflow-hidden isolate'
  const arrow = 'absolute top-1/2 -translate-y-1/2 w-[52px] h-[52px] flex items-center justify-center text-primary/40 hover:text-primary transition-colors'
  const many = items.length > 1

  return (
    <div className="relative mx-auto flex items-center justify-center w-[1100px] max-w-full h-[544px]"
      style={{ perspective: '2600px' }}>
      {many && (
        <button onClick={() => turn('prev')} aria-label="이전 장" className={`${arrow} left-0`}>
          <svg width="26" height="44" viewBox="0 0 26 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 4 L6 22 L18 40" /></svg>
        </button>
      )}

      <div className="relative" style={{ width: PAGE_W * 2, height: PAGE_H, transformStyle: 'preserve-3d' }}>
        {/* 책배 — 아래 깔린 종이 뭉치와 책 전체 그림자 */}
        <div className="absolute -left-[5px] -right-[5px] top-[5px] -bottom-[7px] rounded-lg"
          style={{
            background: 'linear-gradient(90deg,#d6cbb2,#fffdf6 3%,#fffdf6 97%,#d6cbb2)',
            boxShadow: '0 30px 56px -20px rgba(34,34,74,.44), 0 8px 18px rgba(34,34,74,.13)',
          }} />

        {/* 아래 깔린 두 면 */}
        <div className="absolute top-0 left-0 overflow-hidden isolate rounded-l rounded-r-sm"
          style={{ width: PAGE_W, height: PAGE_H, ...paperFace, boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.36)' }}>
          <CoverFace li={a} />
        </div>
        <div className="absolute top-0 overflow-hidden isolate rounded-r rounded-l-sm"
          style={{ left: PAGE_W, width: PAGE_W, height: PAGE_H, ...paperFace, boxShadow: 'inset 16px 0 24px -16px rgba(34,34,74,.36)' }}>
          <RecordFace li={b} no={ordinal(iB)} />
        </div>

        {/* 넘어가는 한 장 */}
        {leaf && (
          <div className="absolute top-0 z-[5]"
            style={{
              left: PAGE_W, width: PAGE_W, height: PAGE_H,
              transformOrigin: '0% 50%', transformStyle: 'preserve-3d',
              transform: `rotateY(${angle}deg)`,
              transition: `transform ${FLIP_MS}ms cubic-bezier(.44,.06,.24,1)`,
            }}>
            <div className={`${faceBase} rounded-r rounded-l-sm`}
              style={{
                ...paperFace, backfaceVisibility: 'hidden',
                boxShadow: 'inset 16px 0 24px -16px rgba(34,34,74,.36), -10px 0 26px rgba(34,34,74,.12)',
              }}>
              <RecordFace li={a} no={ordinal(iA)} />
            </div>
            <div className={`${faceBase} rounded-l rounded-r-sm`}
              style={{
                ...paperFace, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
                boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.36), 10px 0 26px rgba(34,34,74,.12)',
              }}>
              <CoverFace li={b} />
            </div>
          </div>
        )}

        {/* 제본선 */}
        <div className="absolute top-0 z-[7]" style={{
          left: PAGE_W - 1, width: 2, height: PAGE_H,
          background: 'linear-gradient(180deg,rgba(34,34,74,.10),rgba(34,34,74,.26) 20%,rgba(34,34,74,.26) 80%,rgba(34,34,74,.10))',
        }} />
      </div>

      {many && (
        <button onClick={() => turn('next')} aria-label="다음 장" className={`${arrow} right-0`}>
          <svg width="26" height="44" viewBox="0 0 26 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4 L20 22 L8 40" /></svg>
        </button>
      )}
    </div>
  )
}

/** 완독 연표 — 캘린더 대신. 완독일만으로 그려지고, 책등을 누르면 그 장으로 넘어간다.
 *  (월 캘린더는 넣지 않는다: 서재에는 하루 단위 기록이 없어 31칸 중 한두 칸만 찬다) */
function Timeline({ read, year, current, readingCount, onJump }: {
  read: LibraryItem[]; year: number; current: number; readingCount: number; onJump: (i: number) => void
}) {
  const thisMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 0
  return (
    <div className="grid grid-cols-12 border-2 border-primary rounded-2xl bg-white overflow-hidden">
      {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => {
        const spines = read
          .map((li, i) => ({ li, i }))
          .filter(({ li }) => li.finishedDate?.startsWith(`${year}-${String(m).padStart(2, '0')}`))
        const now = m === thisMonth
        return (
          <div key={m} className={`flex flex-col justify-end ${m === 12 ? '' : 'border-r border-primary/10'}`}>
            <div className="flex items-end justify-center gap-[5px] h-[104px]">
              {spines.map(({ li, i }) => (
                <button key={li.libraryItemId} onClick={() => onJump(i)} title={`${li.book.title}${li.book.pageCount ? ` · ${li.book.pageCount}쪽` : ''}`}
                  className={`w-4 rounded-t-sm transition-transform hover:-translate-y-1.5 ${i === current ? 'outline-2 outline-offset-2 outline-accent' : ''}`}
                  style={{
                    height: Math.round(Math.min(96, 42 + (li.book.pageCount ?? 260) * 0.13)),
                    background: coverPalette(li.book.bookId).bg,
                    boxShadow: 'inset 1.5px 0 0 rgba(255,255,255,.30), inset -1.5px 0 0 rgba(0,0,0,.14)',
                  }} />
              ))}
              {/* 지금 달에는 읽는 중인 책이 앉을 빈 자리를 점선으로 세워 둔다 */}
              {now && Array.from({ length: Math.min(readingCount, 3) }, (_, k) => (
                <div key={`g${k}`} className="w-4 rounded-t-sm border-[1.5px] border-dashed border-primary/30 bg-primary/5"
                  style={{ height: 74 - k * 12 }} />
              ))}
            </div>
            <div className={`text-center text-[11px] py-1.5 border-t border-primary/15 ${now ? 'bg-primary text-cream font-bold' : 'bg-[#fffdf7] text-primary/45'}`}>
              {m}월
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 읽는 중 — 책갈피 리본이 내려온 만큼 읽었다. 진행률 숫자를 옆에 같이 둬서 은유를 보정한다. */
function ReadingCard({ li, onFinish }: { li: LibraryItem; onFinish: () => void }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const pct = li.progressPage != null && li.book.pageCount
    ? Math.min(100, Math.round((li.progressPage / li.book.pageCount) * 100)) : null
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 134) : null
  return (
    <div className="flex-1 flex gap-[22px] border-2 border-primary rounded-2xl bg-white p-[22px]">
      <div className="relative shrink-0 pt-3">
        <Link to={`/books/${li.book.bookId}`} className="block w-[134px] h-[194px] overflow-hidden rounded-l-sm rounded-r-md"
          style={{ background: c.bg, color: c.fg, boxShadow: '3px 5px 14px rgba(34,34,74,.3)' }}>
          {url
            ? <img src={url} alt={li.book.title} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-cover" />
            : <span className="block p-2 text-[11px] font-bold leading-snug line-clamp-5">{li.book.title}</span>}
        </Link>
        {/* 리본 — 길이가 진행률 */}
        <div className="absolute top-0 right-[22px] w-3.5 bg-accent rounded-t-sm"
          style={{ height: 12 + 194 * ((pct ?? 0) / 100), boxShadow: '0 2px 7px rgba(34,34,74,.26)' }}>
          <i className="absolute left-0 right-0 -bottom-[9px] h-2.5 bg-accent"
            style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,50% 52%,0 100%)' }} />
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <h3 className="font-display text-lg truncate">{li.book.title}</h3>
        <p className="text-xs text-primary/50 mt-1 truncate">
          {li.book.author}{li.book.publisher ? ` · ${li.book.publisher}` : ''}
        </p>
        {pct != null ? (
          <>
            <div className="flex justify-between text-xs text-primary/60 mt-4">
              <span>{li.progressPage}쪽까지</span><span>{li.book.pageCount}쪽 중 {pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-primary/10 mt-1.5 overflow-hidden">
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-xs text-primary/40 mt-4">읽은 쪽을 남기면 책갈피가 내려와요</p>
        )}
        <div className="mt-auto pt-4 flex flex-col gap-2">
          <button onClick={onFinish} className="self-start border-2 border-primary bg-primary text-white rounded-[10px] px-3 py-2 text-[13px] font-bold">
            완독으로 옮기기
          </button>
          <span className="text-[11px] text-primary/40">완독으로 옮기면 나의 책에 한 장이 늘어요</span>
        </div>
      </div>
    </div>
  )
}

/** 찜 — 유산지 봉투에 든 표지. 안이 흐릿하게만 비쳐서 "아직 내 것이 아니다"가 읽힌다.
 *  봉투에 backdrop-filter를 걸면 카드마다 비싸므로, 안에 든 표지 자체를 흐린다 (glassine.ts 주석 참고). */
function WishSleeve({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 148) : null
  return (
    <Link to={`/books/${li.book.bookId}`}
      className="relative block w-[174px] h-[242px] shrink-0 rounded-md overflow-hidden transition-transform hover:-translate-y-1.5"
      style={{ boxShadow: '0 10px 22px -10px rgba(34,34,74,.32)' }}>
      <div className="absolute left-[13px] top-[22px] w-[148px] h-[208px] rounded-l-sm rounded-r overflow-hidden"
        style={{ background: c.bg, filter: 'blur(2.8px) saturate(.82)' }}>
        {url && <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-cover" />}
      </div>
      <div className="absolute inset-0 rounded-md border border-primary/20" style={glassine(0.66)} />
      <div className="absolute left-0 right-0 top-[30px] h-px bg-primary/15" />
      <span className="absolute left-0 right-0 top-2 text-center text-[10px] tracking-[.2em] text-primary/40">아직 열지 않음</span>
      <span className="absolute left-3.5 right-3.5 bottom-3.5">
        <b className="block font-display font-normal text-[15px] leading-tight line-clamp-2">{li.book.title}</b>
        <span className="text-[11px] text-primary/50">{li.book.author}</span>
      </span>
    </Link>
  )
}

export default function LibraryPageB() {
  const nickname = useAuthStore((s) => s.nickname)
  const [view, setView] = useState<'book' | 'list'>('book')
  const [index, setIndex] = useState(0)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })
  const patch = useMutation({
    mutationFn: async (v: { id: number; status: ShelfStatus }) => api.patch(`/library/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  })

  const all = data ?? []
  // 완독은 오래된 순 — 인덱스가 곧 나의 책의 장 번호가 된다
  const read = all.filter((li) => li.status === 'READ')
    .sort((x, y) => (x.finishedDate ?? '').localeCompare(y.finishedDate ?? ''))
  const reading = all.filter((li) => li.status === 'READING')
  const wish = all.filter((li) => li.status === 'WISH')

  // 새 책이 완독되면 목록이 늘어난다 — 마지막 장을 벗어난 인덱스를 되돌린다
  const cursor = read.length === 0 ? 0 : Math.min(index, read.length - 1)
  useEffect(() => { setIndex(read.length === 0 ? 0 : read.length - 1) }, [read.length])

  const year = new Date().getFullYear()
  const otherYears = read.filter((li) => !li.finishedDate?.startsWith(String(year))).length
  const rated = read.filter((li) => li.rating != null)
  const avg = rated.length ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1) : null
  const pages = read.reduce((s, li) => s + (li.book.pageCount ?? 0), 0)
  const cur = read[cursor]

  return (
    <main className="flex-1 bg-white">
      {/* ===== 히어로 · 나의 책 ===== */}
      <div className="relative overflow-hidden pt-12">
        <p className="relative z-[2] text-center text-[11px] tracking-[.22em] text-primary/45">
          완독 {read.length}권 · 읽는 중 {reading.length}권 · 찜 {wish.length}권 · {year}년의 기록
        </p>
        {/* 뒤에 크게 깔리는 이름 — 레퍼런스의 히어로 타이포를 표지가 반쯤 가린다 */}
        <div aria-hidden className="absolute left-0 right-0 top-[70px] text-center font-display pointer-events-none
          text-[236px] leading-none tracking-[-.045em] text-primary opacity-[.13] blur-[2.5px]">
          {nickname ?? '나'}의 책
        </div>

        {read.length > 0 ? (
          <>
            <div className="mt-16"><MyBook items={read} index={cursor} onIndex={setIndex} /></div>
            <p className="relative z-[2] text-center mt-[30px] text-[13px] text-primary/50">
              <b className="font-display font-normal text-primary">{nth(cursor)}번째 완독</b>
              {cur?.finishedDate ? ` · ${ymd(cur.finishedDate)}` : ''} · {read.length}권 중 {ordinal(cursor)}
            </p>
          </>
        ) : (
          <div className="relative z-[2] mt-16 mx-auto w-[764px] max-w-full h-[544px] rounded-lg border-2 border-dashed border-primary/30
            flex flex-col items-center justify-center gap-4 bg-cream/60">
            <p className="font-display text-2xl">나의 책은 아직 한 장도 없어요</p>
            <p className="text-sm text-primary/50">완독한 책 한 권이 이 책의 한 장이 됩니다</p>
            <div className="flex gap-2 mt-2">
              <Link to="/recommend" className="border-2 border-primary rounded-lg px-4 py-1.5 font-bold bg-white">추천 보러 가기</Link>
              <Link to="/search" className="border-2 border-primary rounded-lg px-4 py-1.5 bg-white">책 검색</Link>
            </div>
          </div>
        )}

        <div className="mt-10 pb-11 flex flex-col items-center gap-1.5 text-[10px] tracking-[.2em] text-primary/30">
          <span>아래로 · 지금 읽는 책</span>
          <svg width="18" height="10" viewBox="0 0 18 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 1 L9 8 L17 1" /></svg>
        </div>
      </div>

      {/* ===== 완독 연표 ===== */}
      {read.length > 0 && (
        <section className="max-w-[1224px] mx-auto px-8 pb-14">
          <div className="flex items-baseline gap-3.5 mb-4">
            <h2 className="text-[22px]">완독 연표 · {year}</h2>
            <p className="text-xs text-primary/45">달에 꽂힌 책등을 누르면 그 장으로 넘어가요 — 이 띠가 나의 책 목차입니다</p>
            {otherYears > 0 && <p className="ml-auto text-xs text-primary/40">그 밖의 해 {otherYears}권</p>}
          </div>
          <Timeline read={read} year={year} current={cursor} readingCount={reading.length} onJump={setIndex} />
          <div className="mt-2.5 flex gap-5 text-[11px] text-primary/45">
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />완독 — 책등 높이는 쪽수</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm border-[1.5px] border-dashed border-primary/40 bg-primary/5 inline-block" />읽는 중 — 아직 실리지 않은 자리</span>
          </div>
        </section>
      )}

      {/* ===== 지금 펼쳐둔 책 ===== */}
      {reading.length > 0 && (
        <section className="max-w-[1224px] mx-auto px-8 pb-14">
          <div className="flex items-baseline gap-3.5 mb-4">
            <h2 className="text-[22px]">지금 펼쳐둔 책</h2>
            <p className="text-xs text-primary/45">아직 나의 책에 실리지 않은 이야기 — 책갈피가 내려온 만큼 읽었어요</p>
          </div>
          <div className="flex gap-5 flex-wrap">
            {reading.map((li) => (
              <ReadingCard key={li.libraryItemId} li={li}
                onFinish={() => patch.mutate({ id: li.libraryItemId, status: 'READ' })} />
            ))}
          </div>
        </section>
      )}

      {/* ===== 언젠가 펼칠 책 ===== */}
      <section className="max-w-[1224px] mx-auto px-8 pb-14">
        <div className="flex items-baseline gap-3.5 mb-4">
          <h2 className="text-[22px]">언젠가 펼칠 책</h2>
          <p className="text-xs text-primary/45">유산지 봉투에 넣어 둔 채 — 아직 열지 않았으니 흐리게</p>
        </div>
        <div className="flex gap-[22px] overflow-x-auto pb-2">
          {wish.map((li) => <WishSleeve key={li.libraryItemId} li={li} />)}
          <Link to="/search"
            className="w-[174px] h-[242px] shrink-0 border-2 border-dashed border-primary/30 rounded-md
              flex flex-col items-center justify-center gap-1.5 text-primary/45 text-[13px]">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11 4v14M4 11h14" /></svg>
            <span>책 추가</span>
          </Link>
        </div>
      </section>

      {/* ===== 목록 뷰 — 고치는 자리 ===== */}
      <div className="max-w-[1224px] mx-auto px-8 pb-12">
        <div className="flex items-center gap-3.5 pt-5 border-t border-primary/10">
          <span className="text-xs text-primary/45">별점 · 감상평 · 상태 수정은 목록 뷰에서</span>
          <button onClick={() => setView(view === 'list' ? 'book' : 'list')}
            className="border-2 border-primary rounded-[10px] bg-white px-3 py-2 text-[13px] font-bold">
            {view === 'list' ? '목록 접기' : '☰ 목록 뷰'}
          </button>
          <span className="ml-auto text-xs text-primary/45">
            완독 {read.length}권{avg ? ` · 평균 ★${avg}` : ''}{pages > 0 ? ` · ${pages.toLocaleString()}쪽` : ''}
          </span>
        </div>
        {view === 'list' && <div className="mt-4"><LibraryList items={all} /></div>}
      </div>
    </main>
  )
}
