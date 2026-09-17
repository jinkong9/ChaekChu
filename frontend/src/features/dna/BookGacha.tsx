/** 완전 랜덤 책 가챠 — BOOK DNA 리포트의 01번 콘텐츠.
 *
 *  이름 그대로 난수로 한 권을 뽑는다. 취향을 반영하지 않는 게 이 콘텐츠의 요지다 —
 *  리포트의 나머지 칸이 "당신의 기록이 말하는 취향"이라면, 여기는 그 바깥으로 한 걸음이다.
 *  그래서 후보도 내 서재가 아니라 소설 전체다(useGachaPool).
 *
 *  뽑을 때마다 서버에서 새 묶음을 집어 온다 — 열 때 받아 둔 한 묶음 안에서만 굴리면
 *  손잡이를 돌릴 때마다 새 묶음을 받아 같은 오십 권만 맴돌지 않게 한다.
 *
 *  결과가 나오기 전에는 표지를 보여 주지 않는다. */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { addToLibrary } from '../../api/library'
import { trackEvent } from '../../lib/events'
import type { DnaBook } from './dnaTypes'
import { axisOf } from './dnaProfile'
import { fetchGachaWindow } from './useGachaPool'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'
import GachaMachine from './GachaMachine'

/** 기계가 움직이는 최소 시간(ms) */
const SPIN_MS = 1600
const COVER_W = 300

type Phase = 'idle' | 'spinning' | 'done'

export default function BookGacha({
  pool,
  total,
  failed,
  read,
  onClose,
}: {
  /** 열 때 받아 둔 묶음 — 새 묶음을 못 받았을 때의 폴백 */
  pool: DnaBook[]
  /** 그 나라 소설의 전체 권수 — "소설 N권 가운데"로 적는다 */
  total: number
  /** 후보를 못 받아 왔다 — 기다림과 실패를 다르게 말한다 */
  failed?: boolean
  /** 이미 읽은 책의 ISBN — 새 묶음을 부를 때도 같은 잣대로 걷어낸다 */
  read: ReadonlySet<string>
  onClose: () => void
}) {
  const qc = useQueryClient()
  /** 뽑은 책을 서재에 담는 중·담김·실패 */
  const [saved, setSaved] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [phase, setPhase] = useState<Phase>('idle')
  const [book, setBook] = useState<DnaBook | null>(null)

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
    if (phase === 'spinning' || pool.length === 0) return
    setPhase('spinning')
    setBook(null)
    setSaved('idle')

    // 기계가 움직이는 동안 새 묶음을 받아 온다 — 실패하면 열 때 받아 둔 묶음으로 뽑는다
    const spun = new Promise<void>((resolve) => window.setTimeout(resolve, SPIN_MS))
    const fresh = await fetchGachaWindow(read).then((w) => (w.books.length > 0 ? w.books : pool)).catch(() => pool)
    const won = fresh[Math.floor(Math.random() * fresh.length)]
    await spun
    if (!alive.current) return
    setBook(won)
    setPhase('done')
  }

  const reset = () => {
    setBook(null)
    setSaved('idle')
    setPhase('idle')
  }

  /** 뽑은 책을 찜으로 담는다. DNA 응답까지 다시 부르지는 않는다 —
   *  서재 지문이 바뀌어 프로필을 통째로 재계산하게 되고, 그 값은 다음에 이 화면을 열 때 맞으면 된다 */
  const wish = (target: DnaBook) => {
    if (!target.bookId || saved === 'saving' || saved === 'done') return
    setSaved('saving')
    trackEvent('WISH', { bookId: target.bookId, context: 'DNA' })
    addToLibrary(target.bookId, 'WISH')
      .then(() => {
        qc.invalidateQueries({ queryKey: ['library'] })
        qc.invalidateQueries({ queryKey: ['book', target.bookId] })
        if (alive.current) setSaved('done')
      })
      // 401 은 인터셉터가 로그아웃으로 받아 간다 — 여기 남는 건 네트워크 끊김·서버 오류
      .catch(() => alive.current && setSaved('error'))
  }


  return (
    <DnaDialog
      label="완전 랜덤 책 가챠"
      kicker="Random Draw"
      status={
        phase === 'done' ? '뽑기 완료' : phase === 'spinning' ? '뽑는 중' : total > 0 ? `소설 ${total.toLocaleString()}권` : ''
      }
      onClose={onClose}
    >
      <div className="dnar-gacha">
        {phase !== 'done' ? (
          <>
            {phase === 'idle' && <p className="dnar-dlg__ask">취향은 잠시 접어 두고, 한 권을 뽑아 볼까요?</p>}
            {/* 기계가 곧 버튼이다 — 손잡이를 누르면 뽑힌다 */}
            <GachaMachine onPull={pull} disabled={pool.length === 0 || phase === 'spinning'} spinning={phase === 'spinning'} />
            {phase === 'spinning' ? (
              <p className="dnar-gacha__lead" role="status">한 권을 뽑는 중이에요…</p>
            ) : (
              <>
                {pool.length === 0 && <p className="dnar-gacha__lead">{failed ? '소설 목록을 불러오지 못했어요. 닫았다 다시 열어 주세요.' : '소설을 한 묶음 꺼내는 중이에요…'}</p>}
                <button type="button" className="dnar-gacha__pull" onClick={pull} disabled={pool.length === 0}>손잡이 돌리기</button>
              </>
            )}
          </>
        ) : (
          <>
            <div className="dnar-gacha__slot">
              {book && (
                <img
                  src={coverAtWidth(book.coverUrl, COVER_W) ?? book.coverUrl}
                  alt={`${book.title} 표지`}
                  width={COVER_W}
                  decoding="async"
                />
              )}
            </div>

            {book && (
              <div className="dnar-gacha__reveal">
                <p className="dnar-gacha__title">{book.title}</p>
                <p className="dnar-gacha__meta">
                  {book.author} · {axisOf(book.classNo)}
                </p>
                <div className="dnar-dlg__actions">
                  {/* 뽑고 끝내지 않는다 — 마음에 들면 그 자리에서 서재로 넘긴다.
                      담기는 POST /library(§6.2), 이미 있으면 409 → api/library 가 PATCH 로 받는다 */}
                  {book.bookId && (
                    <button
                      type="button"
                      className="dnar-dlg__button dnar-gacha__wish"
                      onClick={() => wish(book)}
                      disabled={saved === 'saving' || saved === 'done'}
                    >
                      {saved === 'done' ? '서재에 담겼어요' : saved === 'saving' ? '담는 중…' : '읽고 싶어요'}
                    </button>
                  )}
                  <button type="button" className="dnar-dlg__button" onClick={reset}>
                    다시 뽑기
                  </button>
                  <button type="button" className="dnar-dlg__close" onClick={onClose}>
                    닫기
                  </button>
                </div>
                {saved === 'error' && (
                  <p className="dnar-gacha__saveerror" role="status">
                    서재에 담지 못했어요. 잠시 후 다시 눌러 주세요.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DnaDialog>
  )
}
