/** 책 이상형 월드컵 — BOOK DNA 리포트의 02번 콘텐츠.
 *
 *  두 권을 나란히 놓고 "지금 더 읽고 싶은 쪽"을 고르게 하고, 이긴 책만 다음 판으로 올린다.
 *  16강 → 8강 → 준결승 → 결승 → 우승. 리포트의 다른 칸이 '읽은 기록'에서 취향을 뒤로
 *  계산하는 반면, 이 콘텐츠는 아직 안 읽은 책들 사이의 선택에서 취향을 앞으로 물어본다.
 *
 *  후보는 표지가 있는 mock 풀에서 매 판마다 새로 뽑는다(Fisher–Yates). 정식 구현에서는
 *  추천 후보군이 이 자리에 들어간다.
 *
 *  선택 기록은 마지막에 장르로 집계해서 리포트의 1위 장르와 맞대 본다 — 고른 것과 읽은 것이
 *  갈리는지 보는 게 이 콘텐츠의 결론이다. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DnaBook } from './useDnaMockData'
import { axisOf, type Axis } from './dnaProfile'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'

/** 16강까지만. 그 이상은 고르는 사람이 지친다 */
const SIZE_CAP = 16
const COVER_W = 240

const ROUND_LABEL: Record<number, string> = { 16: '16강', 8: '8강', 4: '준결승', 2: '결승' }

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 후보를 섞어 2의 거듭제곱 개수만 남긴다 — 부전승이 생기면 대진이 설명하기 어려워진다 */
function draft(pool: DnaBook[]): DnaBook[] {
  let size = 2
  while (size * 2 <= Math.min(SIZE_CAP, pool.length)) size *= 2
  return shuffled(pool).slice(0, size)
}

interface Bracket {
  /** 이번 라운드 참가자 */
  round: DnaBook[]
  /** 지금 맞붙는 짝의 왼쪽 인덱스 */
  idx: number
  /** 이번 라운드에서 이긴 책들 */
  winners: DnaBook[]
  /** 처음부터 고른 모든 책 — 마지막에 장르로 집계한다 */
  picks: DnaBook[]
  champion: DnaBook | null
}

const start = (pool: DnaBook[]): Bracket => ({
  round: draft(pool),
  idx: 0,
  winners: [],
  picks: [],
  champion: null,
})

function Cover({ book, onPick, side }: { book: DnaBook; onPick: () => void; side: string }) {
  return (
    <button type="button" className="dnar-wc__pick" onClick={onPick}>
      <img
        src={coverAtWidth(book.coverUrl, COVER_W) ?? book.coverUrl}
        alt=""
        width={COVER_W}
        decoding="async"
      />
      <span className="dnar-wc__pick-title">{book.title}</span>
      <span className="dnar-wc__pick-meta">
        {book.author} · {axisOf(book.classNo)}
      </span>
      <span className="dnar-wc__pick-key" aria-hidden="true">
        {side}
      </span>
    </button>
  )
}

export default function BookWorldCup({
  pool,
  topAxis,
  onClose,
}: {
  pool: DnaBook[]
  /** 리포트 레이더의 1위 장르 — 결과에서 선택과 맞대 본다 */
  topAxis: Axis
  onClose: () => void
}) {
  const [b, setB] = useState<Bracket>(() => start(pool))

  const pick = useCallback((book: DnaBook) => {
    setB((m) => {
      if (m.champion) return m
      const winners = [...m.winners, book]
      const picks = [...m.picks, book]
      const next = m.idx + 2
      // 이번 라운드에 아직 짝이 남았다
      if (next < m.round.length) return { ...m, idx: next, winners, picks }
      // 라운드가 끝났다 — 한 권만 남으면 우승, 아니면 이긴 책들로 다음 라운드
      if (winners.length === 1) return { ...m, winners, picks, champion: winners[0] }
      return { round: winners, idx: 0, winners: [], picks, champion: null }
    })
  }, [])

  const left = b.round[b.idx]
  const right = b.round[b.idx + 1]

  // 좌우 방향키로 고른다 — 표지를 겨냥하지 않아도 빠르게 넘길 수 있다
  useEffect(() => {
    if (b.champion || !left || !right) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(left)
      else if (e.key === 'ArrowRight') pick(right)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [b.champion, left, right, pick])

  /** 선택 기록을 장르로 집계 — 우승 책은 이긴 판수만큼 세어져 자연히 무게가 커진다 */
  const tally = useMemo(() => {
    const map = new Map<Axis, number>()
    for (const p of b.picks) map.set(axisOf(p.classNo), (map.get(axisOf(p.classNo)) ?? 0) + 1)
    const ranked = [...map.entries()].sort((x, y) => y[1] - x[1])
    return { top: ranked[0], total: b.picks.length }
  }, [b.picks])

  const matchNo = b.idx / 2 + 1
  const matchesInRound = b.round.length / 2

  return (
    <DnaDialog
      label="책 이상형 월드컵"
      kicker="Book World Cup"
      status={
        b.champion
          ? '우승'
          : `${ROUND_LABEL[b.round.length] ?? `${b.round.length}강`} · ${matchNo} / ${matchesInRound}`
      }
      onClose={onClose}
    >
      {b.champion ? (
        <div className="dnar-wc__result">
          <h2 className="dnar-wc__crown">당신의 한 권</h2>
          <img
            className="dnar-wc__champion"
            src={coverAtWidth(b.champion.coverUrl, 300) ?? b.champion.coverUrl}
            alt=""
            width={300}
            decoding="async"
          />
          <p className="dnar-wc__champion-title">{b.champion.title}</p>
          <p className="dnar-wc__champion-meta">
            {b.champion.author} · {axisOf(b.champion.classNo)}
          </p>
          {tally.top && (
            <p className="dnar-wc__verdict">
              {tally.total}번의 선택 중 {tally.top[1]}번을 <b>{tally.top[0]}</b>에 주셨어요.
              <br />
              {tally.top[0] === topAxis
                ? `리포트에서 가장 많이 읽은 장르도 ${topAxis} — 고르는 취향과 읽는 취향이 같습니다.`
                : `그런데 가장 많이 읽은 장르는 ${topAxis}였어요 — 고르는 취향과 읽는 취향이 갈립니다.`}
            </p>
          )}
          <div className="dnar-wc__again">
            <button type="button" className="dnar-dlg__button" onClick={() => setB(start(pool))}>
              다시 하기
            </button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dnar-dlg__ask">지금 더 읽고 싶은 쪽은?</p>
          <div className="dnar-wc__match">
            {left && <Cover book={left} side="←" onPick={() => pick(left)} />}
            <span className="dnar-wc__vs" aria-hidden="true">
              VS
            </span>
            {right && <Cover book={right} side="→" onPick={() => pick(right)} />}
          </div>
          <p className="dnar-utility dnar-dlg__hint">
            표지를 누르거나 방향키로 고르세요 · Esc로 닫기
          </p>
        </>
      )}
    </DnaDialog>
  )
}
