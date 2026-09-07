import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem } from '../api/types'
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
 *  책은 덮인 채로 시작한다. 장 구성:
 *    0 표지(닫힘) → 1 속표지 + 목차 → 2.. 완독한 책 한 권씩
 *  표지를 넘기면 앞표지가 제본선을 축으로 왼쪽으로 열리고,
 *  같은 시간에 책 전체가 왼쪽으로 밀려 펼친 자리를 잡는다.
 *
 *  시안: https://claude.ai/code/artifact/24acbc94-9fe0-4215-a953-d6c9c55a6ec8
 *  레퍼런스: recent.design "Personal Site Hero" (스케치북 캐러셀) */

/** 스프레드 한 면의 크기. 넘김이 제본선을 축으로 돌기 때문에 두 면이 같은 폭이어야 한다. */
const PAGE_W = 382
const PAGE_H = 544
const FLIP_MS = 940
const EASE = 'cubic-bezier(.44,.06,.24,1)'
/** 목차에 넣을 수 있는 줄 수 — 한 면(544px)에 들어가는 한계 */
const TOC_MAX = 10

/** 나의 책의 재질 — 수채화지(냉압). 표지도 본문도 같은 종이다.
 *  결이 두 겹이라야 종이로 읽힌다: 촘촘한 알갱이 + 구름처럼 번지는 얼룩 (index.css 토큰). */
const bookFace: CSSProperties = {
  backgroundColor: 'var(--color-book)',
  backgroundImage: 'var(--book-grain), var(--book-mottle)',
  backgroundSize: '160px 160px, 420px 420px',
  backgroundBlendMode: 'multiply, multiply',
}

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
/** 닉네임이 길어도 표지가 깨지지 않게 — 글자를 줄이고 세 줄까지 접는다 */
const titleSize = (t: string) => (t.length > 10 ? 'text-[28px]' : t.length > 7 ? 'text-[34px]' : 'text-[42px]')

type BookMeta = { title: string; year: number; count: number; pages: number }

/** 앞표지 — 덮여 있을 때 보이는 면. 눌러도 펼쳐진다. */
function CoverArt({ meta, onOpen }: { meta: BookMeta; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-label="책 펼치기"
      className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center px-9 text-center">
      {/* 전집 표지의 이중 괘선 — 같은 종이인데도 '표지'로 읽히게 하는 장치 */}
      <span className="absolute inset-[22px] border border-primary/25" />
      <span className="absolute inset-[28px] border border-primary/15" />
      <span className="absolute top-[52px] text-[11px] tracking-[.3em] text-primary/45">{meta.year}</span>
      <span className="text-[11px] tracking-[.24em] text-primary/50">완독으로 엮은</span>
      <span className={`mt-4 font-display ${titleSize(meta.title)} leading-[1.3] break-keep line-clamp-3`}>
        {meta.title}
      </span>
      <span className="mt-5 h-[2px] w-11 bg-accent" />
      <span className="absolute bottom-[52px] text-[11px] tracking-[.1em] text-primary/55">
        {meta.count > 0
          ? `완독 ${meta.count}권${meta.pages > 0 ? ` · ${meta.pages.toLocaleString()}쪽` : ''}`
          : '아직 비어 있음'}
      </span>
    </button>
  )
}

/** 속표지 — 표지를 넘기면 왼쪽에 내려앉는 면. 조용해야 오른쪽 목차가 읽힌다. */
function TitlePage({ meta }: { meta: BookMeta }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center px-9 pt-[148px] text-center">
      <span className="text-[10px] tracking-[.24em] text-primary/40">완독으로 엮은</span>
      <span className="mt-3.5 font-display text-2xl leading-snug break-keep line-clamp-3">{meta.title}</span>
      <span className="mt-4 h-px w-8 bg-primary/25" />
      <span className="mt-auto mb-[52px] text-[11px] text-primary/40">완독 {meta.count}권 · {meta.year}</span>
    </div>
  )
}

/** 목차 — 줄을 누르면 그 장으로 넘어간다.
 *  아래 완독 연표가 '한 해의 흐름' 쪽 목차라면, 이쪽은 '순서' 쪽 목차다. */
function TocFace({ read, onPick }: { read: LibraryItem[]; onPick: (bookIndex: number) => void }) {
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
                <button onClick={() => onPick(i)}
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
            boxShadow: '5px 9px 24px rgba(34,34,74,.30), 0 0 0 1px rgba(34,34,74,.10)',
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

        <p className="text-[13px] text-primary/60 mt-3.5">{li.finishedDate ? `${ymd(li.finishedDate)} 완독` : '서비스를 만나기 전에 읽은 책'}</p>

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

/** 장 한 개. 0 = 표지(닫힘), 1 = 속표지 + 목차, 2.. = 완독한 책. */
type Sheet =
  | { kind: 'cover' }
  | { kind: 'title' }
  | { kind: 'book'; li: LibraryItem; no: string }

type Leaf = { dir: 'next' | 'prev'; i: number; j: number }

/** 나의 책 — 진짜 책과 같은 방식으로 한 장이 돈다.
 *
 *  돌아가는 종이 한 장의 앞면은 A의 오른쪽 면, 뒷면은 B의 왼쪽 면이다.
 *  그래서 -180도까지 돌면 왼쪽에 B의 왼쪽 면이 내려앉고,
 *  그 아래 미리 깔아 둔 B의 오른쪽 면이 드러난다 — 끊김 없이 다음 장이 된다.
 *  (두 면을 동시에 움직이면 책이 아니라 슬라이드로 보인다)
 *
 *  덮인 상태(0번 장)는 같은 장치를 그대로 쓴다: 앞표지가 오른쪽 면에 놓여 있고
 *  왼쪽 면이 없는 상태. 그래서 넘기면 앞표지가 그대로 왼쪽으로 열린다.
 *  다만 덮여 있을 때는 책이 반쪽뿐이라, 가운데로 보이도록 책 전체를 반 면만큼 밀어 둔다. */
function MyBook({ sheets, read, meta, index, onIndex }: {
  sheets: Sheet[]; read: LibraryItem[]; meta: BookMeta; index: number; onIndex: (i: number) => void
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

  // 이 넘김이 끝나면 덮여 있는가 — 밀기·왼쪽 면·제본선이 다 이 값을 따라 같이 움직인다
  const closed = leaf ? leaf.j === 0 : index === 0

  const leftOf = (s: Sheet): ReactNode =>
    s.kind === 'cover' ? null : s.kind === 'title' ? <TitlePage meta={meta} /> : <CoverFace li={s.li} />
  const rightOf = (s: Sheet): ReactNode =>
    s.kind === 'cover' ? <CoverArt meta={meta} onOpen={() => turn('next')} />
      : s.kind === 'title' ? <TocFace read={read} onPick={(i) => onIndex(i + 2)} />
        : <RecordFace li={s.li} no={s.no} />

  // 표지는 왼쪽 면이 없다. 넘김 중에 그 자리가 비어 보이지 않게 다음 장의 왼쪽 면을 미리 깔아 둔다.
  const underLeft = leftOf(a) ?? leftOf(b)
  const faceBase = 'absolute inset-0 overflow-hidden isolate'
  const arrow = 'absolute top-1/2 -translate-y-1/2 w-[52px] h-[52px] flex items-center justify-center text-primary/40 hover:text-primary transition-colors'

  return (
    <div className="relative mx-auto flex items-center justify-center w-[1100px] max-w-full h-[544px]"
      style={{ perspective: '2600px' }}>
      {/* 표지에서는 뒤로 갈 곳이 없다 */}
      {!closed && (
        <button onClick={() => turn('prev')} aria-label="이전 장" className={`${arrow} left-0`}>
          <svg width="26" height="44" viewBox="0 0 26 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 4 L6 22 L18 40" /></svg>
        </button>
      )}

      <div className="relative"
        style={{
          width: PAGE_W * 2, height: PAGE_H, transformStyle: 'preserve-3d',
          transform: `translateX(${closed ? PAGE_W / 2 : 0}px)`,
          transition: `transform ${FLIP_MS}ms ${EASE}`,
        }}>
        {/* 책배 — 펼쳐지면 두 면 아래로 깔리고, 덮이면 앞표지 오른쪽의 단면만 남는다 */}
        <div className="absolute rounded-lg"
          style={{
            left: closed ? PAGE_W - 3 : -5, right: -5, top: 5, bottom: -7,
            background: 'linear-gradient(90deg,var(--color-book-edge),#fffdf7 4%,#fffdf7 96%,var(--color-book-edge))',
            boxShadow: '0 30px 56px -20px rgba(34,34,74,.34), 0 8px 18px rgba(34,34,74,.11)',
            transition: `left ${FLIP_MS}ms ${EASE}`,
          }} />

        {/* 왼쪽 면 — 덮여 있을 때는 없다 */}
        <div className="absolute top-0 left-0 overflow-hidden isolate rounded-l rounded-r-sm"
          style={{
            width: PAGE_W, height: PAGE_H, ...bookFace,
            boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.28)',
            opacity: closed ? 0 : 1,
            transition: `opacity ${closed ? FLIP_MS : 220}ms ${EASE}`,
          }}>
          {underLeft}
        </div>

        {/* 오른쪽 면 — 덮여 있으면 이 자리가 앞표지다 */}
        <div className="absolute top-0 overflow-hidden isolate rounded-r rounded-l-sm"
          style={{
            left: PAGE_W, width: PAGE_W, height: PAGE_H, ...bookFace,
            boxShadow: 'inset 16px 0 24px -16px rgba(34,34,74,.28)',
          }}>
          {rightOf(b)}
        </div>

        {/* 넘어가는 한 장 */}
        {leaf && (
          <div className="absolute top-0 z-[5]"
            style={{
              left: PAGE_W, width: PAGE_W, height: PAGE_H,
              transformOrigin: '0% 50%', transformStyle: 'preserve-3d',
              transform: `rotateY(${angle}deg)`,
              transition: `transform ${FLIP_MS}ms ${EASE}`,
            }}>
            <div className={`${faceBase} rounded-r rounded-l-sm`}
              style={{
                ...bookFace, backfaceVisibility: 'hidden',
                boxShadow: 'inset 16px 0 24px -16px rgba(34,34,74,.28), -10px 0 26px rgba(34,34,74,.12)',
              }}>
              {rightOf(a)}
            </div>
            <div className={`${faceBase} rounded-l rounded-r-sm`}
              style={{
                ...bookFace, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
                boxShadow: 'inset -16px 0 24px -16px rgba(34,34,74,.28), 10px 0 26px rgba(34,34,74,.12)',
              }}>
              {leftOf(b) ?? leftOf(a)}
            </div>
          </div>
        )}

        {/* 책등 — 덮여 있을 때만. 넘김의 축이 여기라는 표시가 된다. */}
        <div className="absolute top-0 z-[6]"
          style={{
            left: PAGE_W - 9, width: 10, height: PAGE_H, borderRadius: '3px 0 0 3px',
            background: 'linear-gradient(90deg,#d6cdba,var(--color-book) 60%,#e2dbc9)',
            opacity: closed ? 1 : 0,
            transition: `opacity ${closed ? 260 : 180}ms ${EASE}`,
          }}>
          <i className="absolute left-0 right-0" style={{ top: 34, height: 1, background: 'rgba(34,34,74,.14)' }} />
          <i className="absolute left-0 right-0" style={{ bottom: 34, height: 1, background: 'rgba(34,34,74,.14)' }} />
        </div>

        {/* 제본선 — 펼쳐져 있을 때만 */}
        <div className="absolute top-0 z-[7]"
          style={{
            left: PAGE_W - 1, width: 2, height: PAGE_H,
            background: 'linear-gradient(180deg,rgba(34,34,74,.10),rgba(34,34,74,.26) 20%,rgba(34,34,74,.26) 80%,rgba(34,34,74,.10))',
            opacity: closed ? 0 : 1,
            transition: `opacity ${closed ? 180 : 300}ms ${EASE}`,
          }} />
      </div>

      <button onClick={() => turn('next')} aria-label="다음 장" className={`${arrow} right-0`}>
        <svg width="26" height="44" viewBox="0 0 26 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4 L20 22 L8 40" /></svg>
      </button>
    </div>
  )
}

/** 완독 연표 — 캘린더 대신. 완독일만으로 그려지고, 책등을 누르면 그 장으로 넘어간다.
 *  (월 캘린더는 넣지 않는다: 서재에는 하루 단위 기록이 없어 31칸 중 한두 칸만 찬다) */
function Timeline({ read, year, current, onJump }: {
  read: LibraryItem[]; year: number; current: number; onJump: (i: number) => void
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
  // 0 = 표지(닫힘). 책은 덮인 채로 시작한다.
  const [index, setIndex] = useState(0)

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const all = data ?? []
  // 완독은 오래된 순 — 인덱스가 곧 나의 책의 장 순서가 된다
  const read = all.filter((li) => li.status === 'READ')
    .sort((x, y) => (x.finishedDate ?? '').localeCompare(y.finishedDate ?? ''))
  const wish = all.filter((li) => li.status === 'WISH')

  const year = new Date().getFullYear()
  const otherYears = read.filter((li) => !li.finishedDate?.startsWith(String(year))).length
  const rated = read.filter((li) => li.rating != null)
  const avg = rated.length ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1) : null
  const pages = read.reduce((s, li) => s + (li.book.pageCount ?? 0), 0)

  const meta: BookMeta = { title: `${nickname ?? '나'}의 책`, year, count: read.length, pages }
  const sheets: Sheet[] = [
    { kind: 'cover' },
    { kind: 'title' },
    ...read.map((li, i) => ({ kind: 'book' as const, li, no: ordinal(i) })),
  ]
  // 완독한 책이 지워지면 인덱스가 목록 밖으로 나갈 수 있다
  const cursor = Math.min(index, sheets.length - 1)

  return (
    <main className="flex-1 bg-white">
      {/* ===== 히어로 · 나의 책 ===== */}
      <div className="relative overflow-hidden pt-12 pb-16">
        <p className="text-center text-[11px] tracking-[.22em] text-primary/45">
          완독 {read.length}권 · 찜 {wish.length}권 · {year}년의 기록
        </p>

        <div className="mt-12">
          <MyBook sheets={sheets} read={read} meta={meta} index={cursor} onIndex={setIndex} />
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
          <Timeline read={read} year={year} current={cursor - 2} onJump={(i) => setIndex(i + 2)} />
          <div className="mt-2.5 flex gap-5 text-[11px] text-primary/45">
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />완독 — 책등 높이는 쪽수</span>
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
