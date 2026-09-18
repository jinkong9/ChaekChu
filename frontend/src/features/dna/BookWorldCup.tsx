/** Top-loan book world cup. While a session is active, the API only returns anonymous synopses and opaque choice IDs. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDnaWorldCupSession, pickDnaWorldCupChoice, type WorldCupSessionResponse } from '../../api/dna'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'

const ROUND_LABEL: Record<number, string> = { 16: '16강', 8: '8강', 4: '준결승', 2: '결승' }

export default function BookWorldCup({ onClose }: { onClose: () => void }) {
  const [session, setSession] = useState<WorldCupSessionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const begin = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSession(null)
    try {
      setSession(await createDnaWorldCupSession())
    } catch {
      setError('월드컵을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void begin()
  }, [begin])

  const choose = useCallback(async (choiceId: string) => {
    if (!session || busy || session.status !== 'IN_PROGRESS') return
    setBusy(true)
    setError(null)
    try {
      setSession(await pickDnaWorldCupChoice(session.sessionId, choiceId))
    } catch {
      setError('선택을 저장하지 못했어요. 현재 대진을 다시 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [busy, session])

  useEffect(() => {
    if (!session || busy || session.status !== 'IN_PROGRESS' || session.choices.length !== 2) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') void choose(session.choices[0].choiceId)
      else if (event.key === 'ArrowRight') void choose(session.choices[1].choiceId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, choose, session])

  const complete = session?.status === 'COMPLETED'
  const status = !session
    ? '준비 중'
    : complete
      ? '우승'
      : `${ROUND_LABEL[session.roundSize] ?? `${session.roundSize}강`} · ${session.matchNumber} / ${session.matchesInRound}`

  return (
    <DnaDialog label="책 이상형 월드컵" kicker="Book World Cup" status={status} onClose={onClose}>
      {complete && session.champion ? (
        <div className="dnar-wc__result">
          <h2 className="dnar-wc__crown">당신이 고른 한 권</h2>
          {session.champion.coverUrl && (
            <img
              className="dnar-wc__champion"
              src={coverAtWidth(session.champion.coverUrl, 300) ?? session.champion.coverUrl}
              alt=""
              width={300}
              decoding="async"
            />
          )}
          <p className="dnar-wc__champion-title">{session.champion.title}</p>
          <p className="dnar-wc__champion-meta">
            {session.champion.authors.join(' · ') || '저자 정보 없음'}
          </p>
          <div className="dnar-wc__again">
            <button type="button" className="dnar-dlg__button" disabled={busy} onClick={() => void begin()}>
              다시 하기
            </button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      ) : error ? (
        <div className="dnar-wc__message" role="alert">
          <p>{error}</p>
          <button type="button" className="dnar-dlg__button" disabled={busy} onClick={() => void begin()}>
            다시 시도
          </button>
        </div>
      ) : busy && !session ? (
        <p className="dnar-wc__message" role="status">대출 상위 책에서 익명 대진을 준비하고 있어요…</p>
      ) : session ? (
        <>
          <p className="dnar-dlg__ask">소개만 읽고, 더 읽고 싶은 이야기를 골라 주세요.</p>
          <p className="dnar-wc__anonymous-note">대출 상위 500권 · 우승 전까지 책 정보는 공개되지 않아요</p>
          <div className="dnar-wc__match">
            {session.choices.map((choice, index) => (
              <button
                type="button"
                className="dnar-wc__anonymous-pick"
                key={choice.choiceId}
                disabled={busy}
                onClick={() => void choose(choice.choiceId)}
                aria-label={`익명 소개 ${index + 1}번 선택`}
              >
                <span className="dnar-wc__anonymous-label">이야기 {index + 1}</span>
                <span className="dnar-wc__anonymous-text">{choice.synopsis}</span>
                <span className="dnar-wc__pick-key" aria-hidden="true">{index === 0 ? '←' : '→'}</span>
              </button>
            ))}
          </div>
          <p className="dnar-utility dnar-dlg__hint">소개를 누르거나 방향키로 고르세요 · Esc로 닫기</p>
        </>
      ) : null}
    </DnaDialog>
  )
}
