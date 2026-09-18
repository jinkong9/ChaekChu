/** 책 이상형 월드컵 — BOOK DNA 리포트의 02번 콘텐츠.
 *
 *  두 권의 소개문만 나란히 놓고 "지금 더 읽고 싶은 쪽"을 고르게 한다. 제목·저자·표지는 끝까지 감춘다 —
 *  표지와 이름값을 걷어낸 채로 고르면 무엇이 남는지 보는 게 이 콘텐츠의 요지다.
 *  16강 → 8강 → 준결승 → 결승, 15번 고르면 우승 책의 정체가 처음 공개된다.
 *
 *  후보는 내 서재가 아니라 대출 상위 요약 풀(약 500권)에서 서버가 편성한다(BOOK_DNA_API_CONTRACT §8).
 *  대진표도 서버가 든다 — 화면은 세션 응답을 그대로 보여 주고, 고른 choiceId 를 돌려보내기만 한다. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createWorldCupSession,
  isWorldCupSessionGone,
  isWorldCupUnavailable,
  pickWorldCup,
  type WorldCupSession,
} from '../../api/dna'
import { toDnaBook } from './gachaDraw'
import { axisOf } from './dnaProfile'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'

const ROUND_LABEL: Record<number, string> = { 16: '16강', 8: '8강', 4: '준결승', 2: '결승' }

/** 지금 라운드의 인원 — 16강 1라운드, 8강 2라운드… */
const participantsOf = (s: WorldCupSession) => s.roundSize >> (s.roundNumber - 1)

type Phase = 'idle' | 'loading' | 'playing' | 'done'

function Synopsis({
  text,
  side,
  disabled,
  onPick,
}: {
  text: string
  side: string
  disabled: boolean
  onPick: () => void
}) {
  return (
    <button type="button" className="dnar-wc__synopsis" onClick={onPick} disabled={disabled}>
      <span className="dnar-wc__synopsis-text">{text}</span>
      <span className="dnar-wc__pick-key" aria-hidden="true">{side}</span>
    </button>
  )
}

export default function BookWorldCup({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<WorldCupSession | null>(null)
  /** 고른 쪽을 서버에 보내는 중 — 응답 전에는 두 카드를 잠근다 */
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 요청 중에 닫히면 늦게 온 응답이 사라진 화면을 건드리지 않게 한다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const begin = useCallback(async () => {
    setPhase('loading')
    setError(null)
    setSession(null)
    try {
      const s = await createWorldCupSession()
      if (!alive.current) return
      setSession(s)
      setPhase(s.status === 'COMPLETED' ? 'done' : 'playing')
    } catch (err) {
      if (!alive.current) return
      setError(
        isWorldCupUnavailable(err)
          ? '월드컵에 낼 책이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.'
          : '대진표를 짜지 못했어요. 다시 시작해 주세요.',
      )
      setPhase('idle')
    }
  }, [])

  const pick = useCallback(
    async (choiceId: string) => {
      if (!session || picking || phase !== 'playing') return
      setPicking(true)
      setError(null)
      try {
        const next = await pickWorldCup(session.sessionId, choiceId)
        if (!alive.current) return
        setSession(next)
        if (next.status === 'COMPLETED') setPhase('done')
      } catch (err) {
        if (!alive.current) return
        if (isWorldCupSessionGone(err)) {
          // 24시간이 지났거나 세션이 사라졌다 — 이어 갈 수 없으니 처음으로
          setSession(null)
          setPhase('idle')
          setError('세션이 끝났어요. 처음부터 다시 시작해 주세요.')
        } else {
          setError('선택이 전달되지 않았어요. 다시 골라 주세요.')
        }
      } finally {
        if (alive.current) setPicking(false)
      }
    },
    [session, picking, phase],
  )

  const [left, right] = session?.choices ?? []

  // 좌우 방향키로 고른다 — 카드를 겨냥하지 않아도 빠르게 넘길 수 있다
  useEffect(() => {
    if (phase !== 'playing' || !left || !right) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(left.choiceId)
      else if (e.key === 'ArrowRight') pick(right.choiceId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, left, right, pick])

  const champion = phase === 'done' && session?.champion ? toDnaBook(session.champion) : null
  const status =
    phase === 'done'
      ? '우승'
      : phase === 'playing' && session
        ? `${ROUND_LABEL[participantsOf(session)] ?? `${participantsOf(session)}강`} · ${session.matchNumber} / ${session.matchesInRound}`
        : ''

  return (
    <DnaDialog label="책 이상형 월드컵" kicker="Book World Cup" status={status} onClose={onClose}>
      {phase === 'idle' || phase === 'loading' ? (
        <div className="dnar-wc__result">
          <p className="dnar-dlg__ask">표지도 제목도 없이, 소개 두 줄만 보고 고릅니다.</p>
          <p className="dnar-wc__verdict">
            16권이 서로 맞붙어 15번 고르면 한 권이 남아요.
            <br />
            우승한 책이 무엇이었는지는 그때 처음 알려 드려요.
          </p>
          {error && <p className="dnar-wc__error" role="status">{error}</p>}
          <div className="dnar-dlg__actions">
            <button type="button" className="dnar-dlg__button" onClick={begin} disabled={phase === 'loading'}>
              {phase === 'loading' ? '대진표를 짜는 중' : '시작하기'}
            </button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : phase === 'done' && champion ? (
        <div className="dnar-wc__result">
          <h2 className="dnar-wc__crown">당신의 한 권</h2>
          {champion.coverUrl && (
            <img
              className="dnar-wc__champion"
              src={coverAtWidth(champion.coverUrl, 300) ?? champion.coverUrl}
              alt=""
              width={300}
              decoding="async"
            />
          )}
          <p className="dnar-wc__champion-title">{champion.title}</p>
          <p className="dnar-wc__champion-meta">
            {champion.author && `${champion.author} · `}{axisOf(champion.classNo)}
          </p>
          <p className="dnar-wc__verdict">
            {(session?.roundSize ?? 16) - 1}번의 선택 끝에 남은 책이에요.
            <br />
            제목도 표지도 모른 채 소개문만으로 고른 결과입니다.
          </p>
          <div className="dnar-dlg__actions">
            <button type="button" className="dnar-dlg__button" onClick={begin}>다시 하기</button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : (
        <>
          <p className="dnar-dlg__ask">지금 더 읽고 싶은 쪽은?</p>
          <div className="dnar-wc__match dnar-wc__match--text">
            {left && <Synopsis text={left.synopsis} side="←" disabled={picking} onPick={() => pick(left.choiceId)} />}
            <span className="dnar-wc__vs" aria-hidden="true">VS</span>
            {right && <Synopsis text={right.synopsis} side="→" disabled={picking} onPick={() => pick(right.choiceId)} />}
          </div>
          {error ? (
            <p className="dnar-wc__error" role="status">{error}</p>
          ) : (
            <p className="dnar-utility dnar-dlg__hint">카드를 누르거나 방향키로 고르세요 · Esc로 닫기</p>
          )}
        </>
      )}
    </DnaDialog>
  )
}
