/** BOOK DNA 콘텐츠 3종(가챠·월드컵·사주)이 공유하는 전체 화면 대화상자 껍데기.
 *
 *  껍데기만 맡는다: 종이 한 장을 지면 위에 덮고, 위쪽 규칙선으로 도구 영역을 가르고,
 *  열려 있는 동안 뒤 지면 스크롤을 잠그고, Esc로 닫고, 포커스를 안에 가두고,
 *  닫을 때 열었던 카드로 포커스를 돌려준다.
 *
 *  콘텐츠별 키 조작(월드컵의 좌우 방향키 등)은 각 콘텐츠가 자기 effect에서 따로 듣는다. */
import { useEffect, useRef, type ReactNode } from 'react'

export default function DnaDialog({
  label,
  kicker,
  status,
  onClose,
  children,
}: {
  /** 스크린리더용 이름 */
  label: string
  /** 좌상단 영문 라벨 */
  kicker: string
  /** 우상단 진행 상태 — 없으면 비운다 */
  status?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 열기 전에 포커스가 있던 곳(카드)으로 닫을 때 돌려준다
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    openerRef.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.body.style.overflow = prev
      ;(openerRef.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      // 대화상자 안에서만 포커스가 돌게 가둔다
      const items = ref.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!items || items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dnar-dlg" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
      <div className="dnar-dlg__bar">
        <span className="dnar-eyebrow">{kicker}</span>
        <span className="dnar-utility">{status ?? ''}</span>
        <button type="button" className="dnar-dlg__close" onClick={onClose}>
          닫기
        </button>
      </div>
      {children}
    </div>
  )
}
