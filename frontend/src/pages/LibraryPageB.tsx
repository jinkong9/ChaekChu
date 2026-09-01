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
 *  책은 표제지에서 시작한다: 왼쪽이 「닉네임의 책」 표지, 오른쪽이 목차.
 *  히어로의 주인공을 배경 워터마크가 아니라 표지가 맡는다 —
 *  워터마크는 닉네임이 길어지면(예: "Google 독자") 화면을 넘어가 잘렸다.
 *
 *  시안: https://claude.ai/code/artifact/24acbc94-9fe0-4215-a953-d6c9c55a6ec8
 *  레퍼런스: recent.design "Personal Site Hero" (스케치북 캐러셀) */

/** 스프레드 한 면의 크기. 넘김이 제본선을 축으로 돌기 때문에 두 면이 같은 폭이어야 한다. */
const PAGE_W = 382
const PAGE_H = 544
const FLIP_MS = 940
/** 목차에 넣을 수 있는 줄 수 — 한 면(544px)에 들어가는 한계 */
const TOC_MAX = 10

const NTH = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

/** 종이 결 — index.css의 --paper-noise를 그대로 쓴다 (이미지 파일 없이 질감) */
const paperFace: CSSProperties = {
  backgroundColor: 'var(--color-paper)',
  backgroundImage: 'var(--paper-noise)',
  backgroundSize: '180px 180px',
  backgroundBlendMode: 'multiply',
}

/** 표지는 종이가 아니라 천이다 — 잉크색 위에 같은 결을 soft-light로 얹어 감촉만 남긴다 */
const clothFace: CSSProperties = {
  backgroundColor: 'var(--color-primary)',
  backgroundImage: 'var(--paper-noise)',
  backgroundSize: '180px 180px',
  backgroundBlendMode: 'soft-light',
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

/** 표제지 왼쪽 — 「닉네임의 책」 표지.
 *  닉네임 길이를 방어한다: 길면 글자를 줄이고 최대 세 줄까지 접는다
 *  (워터마크와 달리 표지는 잘리지 않고 얌전히 접힌다). */
function CoverPlate({ title, year, count, pages }: {
  title: string; year: number; count: number; pages: number
}) {
  const size = title.length > 10 ? 'text-[28px]' : title.length > 7 ? 'text-[34px]' : 'text-[42px]'
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-9 text-cream" style={clothFace}>
      {/* 전집 표지의 이중 괘선 — 이 판이 '안에 든 책 한 권'이 아니라 '이 책 전체'라는 신호 */}
      <div className="absolute inset-[22px] border border-cream/35" />
      <div className="absolute inset-[28px] border border-cream/15" />

      <span className="absolute top-[52px] text-[11px] tracking-[.3em] text-cream/45">{year}</span>

      <p className="text-[11px] tracking-[.24em] text-cream/50">완독으로 엮은</p>
      <h2 className={`mt-4 font-display ${size} leading-[1.3] text-center break-keep line-clamp-3 text-cream`}>
        {title}
      </h2>
      <div className="mt-5 h-[2px] w-11 bg-accent" />

      <span className="absolute bottom-[52px] text-[11px] tracking-[.1em] text-cream/55">
        {count > 0 ? `완독 ${count}권${pages > 0 ? ` · ${pages.toLocaleString()}쪽` : ''}` : '아직 비어 있음'}
      </span>
    </div>
  )
}

/** 표제지 오른쪽 — 목차. 줄을 누르면 그 장으로 넘어간다.
 *  아래 완독 연표가 '한 해의 흐름' 쪽 목차라면, 이쪽은 '순서' 쪽 목차다. */
function TocFace({ read, onPick }: { read: LibraryItem[]; onPick: (sheet: number) => void }) {
  const shown = read.slice(0, TOC_MAX)
  const rest = read.length - shown.length
  const rated = read.filter((li) => li.rating != null)
  const avg = rated.length ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1) : null

  return (
    <div className="absolute inset-0 flex flex-col px-[34px] pt-[34px] pb-10">
      <span className="text-[10px] tracking-[.26em] text-primary/40">목차</span>

      {read.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-xl">아직 한 장도 없어요</p>
          <p className="text-[13px] leading-relaxed text-primary/50">완독한 책 한 권이<br />이 책의 한 장이 됩니다</p>
          <div className="mt-2 flex flex-col gap-2">
            <Link to="/recommend" className="border-2 border-primary rounded-lg bg-white px-4 py-1.5 text-[13px] font-bold">추천 보러 가기</Link>
            <Link to="/search" className="border-2 border-primary rounded-lg bg-white px-4 py-1.5 text-[13px]">책 검색</Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-5">
            {shown.map((li, i) => (
              <li key={li.libraryItemId}>
                <button onClick={() => onPick(i + 1)}
                  className="group flex w-full items-baseline gap-2.5 py-[7px] text-left">
                  <span className="w-6 shrink-0 font-display text-[11px] tracking-[.1em] text-primary/40">{ordinal(i)}</span>
                  <span className="shrink-0 max-w-[190px] truncate text-[13px] transition-colors group-hover:text-accent">{li.book.title}</span>
                  <span className="min-w-3 flex-1 self-center border-b border-dotted border-primary/25" />
                  <span className="shrink-0 text-[11px] text-primary/45">{li.finishedDate ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
          {rest > 0 && <p className="mt-1.5 text-[11px] text-primary/40">그 밖 {rest}권 — 아래 완독 연표에서 볼 수 있어요</p>}
          <p className="mt-auto text-[11px] text-primary/45">
            완독 {read.length}권{avg ? ` · 평균 ★${avg}` : ''}
          </p>
        </>
      )}
    </div>
  )
}

/** 안쪽 왼쪽 면 — 완독한 책의 표지 한 장. 없거나 깨지면 색 커버로 떨어진다 (BookCover와 같은 팔레트). */
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

/** 안쪽 오른쪽 면 — 독서 기록(A안). 서재에 이미 있는 필드만 쓴다:
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

/** 스프레드 한 장. 0번은 표제지, 그 다음부터 완독한 책 한 권씩. */
type Sheet =
  | { kind: 'cover'; title: string; year: number; count: number; pages: number }
  | { kind: 'book'; li: LibraryItem; no: string }

type Leaf = { dir: 'next' | 'prev'; i: number; j: number }

/** 나의 책 — 진짜 책과 같은 방식으로 한 장이 돈다.
 *
 *  돌아가는 종이 한 장의 앞면은 A의 오른쪽 면, 뒷면은 B의 왼쪽 면이다.
 *  그래서 -180도까지 돌면 왼쪽에 B의 왼쪽 면이 내려앉고,
 *  그 아래 미리 깔아 둔 B의 오른쪽 면이 드러난다 — 끊김 없이 다음 장이 된다.
 *  (두 면을 동시에 움직이면 책이 아니라 슬라이드로 보인다) */
function MyBook({ sheets, read, index, onIndex }: {
  sheets: Sheet[]; read: LibraryItem[]; index: number; onIndex: (i: number) => void
}) {
  const [leaf, setLeaf] = useState<Leaf | null>(null)
  const [angle, setAngle] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const turn = (dir: 'next' | 'prev') => {
    if (leaf || sheets.length < 2) return
    const n = sheets.length
    const j = dir === 'next' ? (index + 1) % n : (index - 1 + n) % n
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
  const a = sheets[iA]
  const b = sheets[iB]
  if (!a || !b) return null

  const left = (s: Sheet) => s.kind === 'cover'
    ? <CoverPlate title={s.title} year={s.year} count={s.count} pages={s.pages} />
    : <CoverFace li={s.li} />
  const right = (s: Sheet) => s.kind === 'cover'
    ? <TocFace read={read} onPick={onIndex} />
    : <RecordFace li={s.li} no={s.no} />
  // 표지 면은 종이가 아니라 천이라 결·색이 다르다
  const skin = (s: Sheet) => (s.kind === 'cover' ? clothFace : paperFace)

  const faceBase = 'absolute inset-0 overflow-hidden isolate'
  const arrow = 'absolute top-1/2 -translate-y-1/2 w-[52px] h-[52px] flex items-center justify-center text-primary/40 hover:text-primary transition-colors'
  const many = sheets.length > 1

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
          style={{ width: PAGE_W, height: PAGE_H, ...skin(a), boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.36)' }}>
          {left(a)}
        </div>
        <div className="absolute top-0 overflow-hidden isolate rounded-r rounded-l-sm"
          style={{ left: PAGE_W, width: PAGE_W, height: PAGE_H, ...paperFace, boxShadow: 'inset 16px 0 24px -16px rgba(34,34,74,.36)' }}>
          {right(b)}
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
              {right(a)}
            </div>
            <div className={`${faceBase} rounded-l rounded-r-sm`}
              style={{
                ...skin(b), backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
                boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.36), 10px 0 26px rgba(34,34,74,.12)',
              }}>
              {left(b)}
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
  // 0 = 표제지. 책은 표지에서 시작한다.
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

  const year = new Date().getFullYear()
  const otherYears = read.filter((li) => !li.finishedDate?.startsWith(String(year))).length
  const rated = read.filter((li) => li.rating != null)
  const avg = rated.length ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1) : null
  const pages = read.reduce((s, li) => s + (li.book.pageCount ?? 0), 0)

  const sheets: Sheet[] = [
    { kind: 'cover', title: `${nickname ?? '나'}의 책`, year, count: read.length, pages },
    ...read.map((li, i) => ({ kind: 'book' as const, li, no: ordinal(i) })),
  ]
  // 완독한 책이 지워지면 인덱스가 목록 밖으로 나갈 수 있다
  const cursor = Math.min(index, sheets.length - 1)
  const cur = sheets[cursor]

  return (
    <main className="flex-1 bg-white">
      {/* ===== 히어로 · 나의 책 ===== */}
      <div className="relative overflow-hidden pt-12">
        <p className="text-center text-[11px] tracking-[.22em] text-primary/45">
          완독 {read.length}권 · 읽는 중 {reading.length}권 · 찜 {wish.length}권 · {year}년의 기록
        </p>

        <div className="mt-12">
          <MyBook sheets={sheets} read={read} index={cursor} onIndex={setIndex} />
        </div>

        <p className="text-center mt-[30px] text-[13px] text-primary/50">
          {cur.kind === 'cover' ? (
            read.length > 0
              ? <><b className="font-display font-normal text-primary">표지</b> · 오른쪽 목차나 화살표로 첫 장을 펼쳐 보세요</>
              : <><b className="font-display font-normal text-primary">표지</b> · 첫 완독이 이 책의 첫 장이 됩니다</>
          ) : (
            <>
              <b className="font-display font-normal text-primary">{nth(cursor - 1)}번째 완독</b>
              {cur.li.finishedDate ? ` · ${ymd(cur.li.finishedDate)}` : ''}
              {` · ${read.length}권 중 ${ordinal(cursor - 1)}`}
            </>
          )}
        </p>

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
          <Timeline read={read} year={year} current={cursor - 1} readingCount={reading.length}
            onJump={(i) => setIndex(i + 1)} />
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
