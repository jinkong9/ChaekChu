/** 완전 랜덤 책 가챠 — BOOK DNA 리포트의 01번 콘텐츠.
 *
 *  이름 그대로 난수로 한 권을 뽑는다. 취향을 반영하지 않는 게 이 콘텐츠의 요지다 —
 *  리포트의 나머지 칸이 "당신의 기록이 말하는 취향"이라면, 여기는 그 바깥으로 한 걸음이다.
 *  후보는 서버가 가챠 전용으로 내준다 — GET /books/random(§4.8), 표지와 KDC 가 있는
 *  추천 후보 약 44만 권 중 무작위 한 권. 손잡이를 돌릴 때마다 한 번 부른다.
 *
 *  결과가 나오기 전에는 표지를 보여 주지 않는다. */
import { useEffect, useRef, useState } from 'react'
import type { DnaBook } from './dnaTypes'
import ShelfActions from '../../components/ShelfActions'
import ResultCover from './ResultCover'
import { useMyShelfEntry } from '../../lib/useMyShelfEntry'
import { axisOf } from './dnaProfile'
import { isBookNotFound } from '../../api/books'
import { drawRandomBook } from './gachaDraw'
import DnaDialog from './DnaDialog'
import GachaMachine from './GachaMachine'

/** 기계가 움직이는 최소 시간(ms) */
const SPIN_MS = 1600
const COVER_W = 300

type Phase = 'idle' | 'spinning' | 'done'

export default function BookGacha({
  read,
  onClose,
}: {
  /** 이미 읽은 책의 ISBN — 걸리면 다시 뽑는다 */
  read: ReadonlySet<string>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [book, setBook] = useState<DnaBook | null>(null)
  /** 뽑은 책이 내 서재에 어떻게 있는지 — 버튼 한 벌(ShelfActions)이 이걸로 모양을 정한다 */
  const my = useMyShelfEntry(book?.bookId)
  /** 뽑지 못했을 때의 안내 — 서버가 비었는지, 그냥 실패인지 말이 다르다 */
  const [drawError, setDrawError] = useState<string | null>(null)
  /** 직전에 뽑힌 책 — 서버에 exclude 로 넘겨 같은 책이 연달아 나오지 않게 한다 */
  const lastId = useRef<string | undefined>(undefined)

  // 뽑는 도중에 닫히면 늦게 도착한 응답이 사라진 화면을 건드리지 않게 한다
  const alive = useRef(true)
  useEffect(() => {
    // StrictMode 는 개발에서 effect 를 두 번 돌린다 — 첫 정리에서 내려간 깃발을 다시 올려야 뽑기가 멈추지 않는다
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const pull = async () => {
    if (phase === 'spinning') return
    setPhase('spinning')
    setBook(null)
    setDrawError(null)

    // 기계가 다 돌기 전에 답이 와도 기다린다 — 뽑는 맛은 그 시간에서 나온다
    const spun = new Promise<void>((resolve) => window.setTimeout(resolve, SPIN_MS))
    try {
      const won = await drawRandomBook(lastId.current, read)
      await spun
      if (!alive.current) return
      lastId.current = won.bookId
      setBook(won)
      setPhase('done')
    } catch (err) {
      await spun
      if (!alive.current) return
      setDrawError(
        isBookNotFound(err)
          ? '뽑을 책이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.'
          : '한 권을 뽑지 못했어요. 손잡이를 다시 돌려 주세요.',
      )
      setPhase('idle')
    }
  }

  const reset = () => {
    setBook(null)
    setDrawError(null)
    setPhase('idle')
  }


  return (
    <DnaDialog
      label="완전 랜덤 책 가챠"
      kicker="Random Draw"
      status={phase === 'done' ? '뽑기 완료' : phase === 'spinning' ? '뽑는 중' : ''}
      onClose={onClose}
    >
      <div className="dnar-gacha">
        {phase !== 'done' ? (
          <>
            {phase === 'idle' && <p className="dnar-dlg__ask">취향은 잠시 접어 두고, 한 권을 뽑아 볼까요?</p>}
            {/* 기계가 곧 버튼이다 — 손잡이를 누르면 뽑힌다 */}
            <GachaMachine onPull={pull} disabled={phase === 'spinning'} spinning={phase === 'spinning'} />
            {phase === 'spinning' ? (
              <p className="dnar-gacha__lead" role="status">한 권을 뽑는 중이에요…</p>
            ) : (
              <>
                {drawError && <p className="dnar-gacha__lead" role="status">{drawError}</p>}
                <button type="button" className="dnar-gacha__pull" onClick={pull}>손잡이 돌리기</button>
              </>
            )}
          </>
        ) : (
          <>
            <div className="dnar-gacha__slot">
              {/* 표지는 상세로 가는 문 — 올리면 살짝 열리고, 누르면 그 책으로 */}
              {book && <ResultCover book={book} width={COVER_W} />}
            </div>

            {book && (
              <div className="dnar-gacha__reveal">
                <p className="dnar-gacha__title">{book.title}</p>
                <p className="dnar-gacha__meta">
                  {book.author} · {axisOf(book.classNo)}
                </p>
                {/* 뽑고 끝내지 않는다 — 마음에 들면 그 자리에서 서재로 넘긴다. 버튼은 상세 화면과 같은 한 벌(ShelfActions):
                    읽었어요는 완독 모달, 읽고 싶어요는 담고 푼다. 이미 서재에 있으면 그대로 보인다 */}
                {book.bookId && (
                  <ShelfActions className="dnar-shelf" bookId={book.bookId} title={book.title} my={my} eventContext="DNA" />
                )}
                <div className="dnar-dlg__actions">
                  <button type="button" className="dnar-dlg__button" onClick={reset}>
                    다시 뽑기
                  </button>
                  <button type="button" className="dnar-dlg__close" onClick={onClose}>
                    닫기
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DnaDialog>
  )
}
