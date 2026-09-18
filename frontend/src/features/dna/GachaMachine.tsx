/** 책 가챠 기계. 유리통의 공은 후보 책과 무관한 장식이다. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type KnobPointerEvent = ReactPointerEvent<SVGCircleElement>
type Point = { x: number; y: number }

/** 손잡이를 이만큼 돌리면 뽑힌다. 한 바퀴를 요구하면 화면 위 26px짜리 원을 끊기지 않게
 *  끝까지 끌어야 해서 사실상 안 돌아간다 — 3분의 1바퀴면 '돌렸다'는 느낌은 그대로다. */
const TURN_TO_PULL = 110
/** 거의 안 돌리고 뗐다 = 누른 것이다. 손잡이는 눌러도 뽑히는 게 맞다 */
const TAP_SLOP = 8

/** 기계 그림 — 표시 폭이 최대 275px(대화상자)·190px(카드)이라 2배 해상도(600px)로 줄여
 *  WebP 로 저장했다. 원본 PNG 1024px 은 1.8MB 로, 이 화면에서 필요 없는 크기다(랜딩 일러스트와 같은 처리). */
const ART = { src: '/images/gacha-concepts/gacha-soft-round.webp', knobX: 161, knobY: 316 }
/** 소개 카드와 가챠 화면이 같은 기계 그림을 쓴다. 실제 손잡이 동작은 가챠 화면에서만 붙인다. */
export function GachaMachineArt({ angle = 0, onKnobDown, onKnobMove, onKnobEnd }: {
  angle?: number
  onKnobDown?: (event: KnobPointerEvent) => void
  onKnobMove?: (event: KnobPointerEvent) => void
  onKnobEnd?: (event: KnobPointerEvent) => void
}) {
  const art = ART
  return (
    <svg viewBox="0 0 320 480" role="img" aria-hidden="true">
      <image href={art.src} width="320" height="480" />
      {/* 이미지의 손잡이 부분만 덮어 실제로 회전할 수 있는 손잡이를 올린다. */}
      {onKnobDown && (
        <>
          <defs>
            <radialGradient id="dnar-knob-rim" cx="32%" cy="20%" r="80%">
              <stop stopColor="#fffdf8" />
              <stop offset=".5" stopColor="#d8d1c6" />
              <stop offset=".83" stopColor="#aea69a" />
              <stop offset="1" stopColor="#756f68" />
            </radialGradient>
            <linearGradient id="dnar-knob-plate" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#c9c3b8" />
              <stop offset=".32" stopColor="#f6f3ec" />
              <stop offset=".72" stopColor="#ded8ce" />
              <stop offset="1" stopColor="#aaa298" />
            </linearGradient>
            <linearGradient id="dnar-knob-grip" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#fffefa" />
              <stop offset=".4" stopColor="#e8e4dc" />
              <stop offset=".8" stopColor="#bdb7ad" />
              <stop offset="1" stopColor="#f1ede6" />
            </linearGradient>
            <filter id="dnar-knob-shadow" x="-35%" y="-35%" width="170%" height="170%">
              <feDropShadow dx="1" dy="2" stdDeviation="2" floodColor="#3d3934" floodOpacity=".27" />
            </filter>
          </defs>
          <circle cx={art.knobX} cy={art.knobY} r="43" fill="url(#dnar-knob-rim)" stroke="#827b72" strokeWidth="1.4" filter="url(#dnar-knob-shadow)" />
          <circle cx={art.knobX} cy={art.knobY} r="39" fill="none" stroke="#fffaf1" strokeOpacity=".8" strokeWidth="1.4" />
          <circle cx={art.knobX} cy={art.knobY} r="35" fill="url(#dnar-knob-plate)" stroke="#8f8980" strokeWidth="1.3" />
          <circle cx={art.knobX} cy={art.knobY} r="30" fill="#ebe7df" stroke="#fffdf8" strokeOpacity=".85" strokeWidth="1.2" />
          <g className="dnar-machine__handle" style={{ transform: `rotate(${angle}deg)` }}>
            <rect x={art.knobX - 34} y={art.knobY - 7} width="68" height="18" rx="9" fill="#716b64" opacity=".25" />
            <rect x={art.knobX - 34} y={art.knobY - 10} width="68" height="18" rx="9" fill="url(#dnar-knob-grip)" stroke="#8b857d" strokeWidth="1.6" />
            <rect x={art.knobX - 30} y={art.knobY - 7} width="60" height="8" rx="4" fill="#fffdf8" opacity=".65" />
            <path d={`M${art.knobX - 27} ${art.knobY + 5}h54`} stroke="#8a8379" strokeOpacity=".45" strokeWidth="1" />
          </g>
          <circle className="dnar-machine__knob-hit" cx={art.knobX} cy={art.knobY} r="43" fill="transparent" onPointerDown={onKnobDown} onPointerMove={onKnobMove} onPointerUp={onKnobEnd} onPointerCancel={onKnobEnd} />
        </>
      )}
    </svg>
  )
}

export default function GachaMachine({ onPull, disabled, spinning = false }: { onPull: () => void; disabled?: boolean; spinning?: boolean }) {
  const [angle, setAngle] = useState(0)
  const drag = useRef<{ pointerId: number; center: Point | null; last: number; rotation: number } | null>(null)
  const finishTimer = useRef<number | null>(null)
  const finishing = useRef(false)

  useEffect(() => () => {
    if (finishTimer.current !== null) window.clearTimeout(finishTimer.current)
  }, [])

  /** 뽑기는 한 번만 — 다 돌린 뒤의 여운(delay)을 두고 부른다 */
  const fire = (delay: number) => {
    if (disabled || finishing.current) return
    finishing.current = true
    finishTimer.current = window.setTimeout(() => {
      finishTimer.current = null
      finishing.current = false
      onPull()
    }, delay)
  }

  /** 손잡이 중심의 화면 좌표. 끄는 동안 기계는 제자리에 있으므로 누를 때 한 번만 잰다 —
   *  pointermove 마다 getBoundingClientRect 를 부르면 그때마다 레이아웃을 강제로 다시 계산한다. */
  const knobCenter = (event: KnobPointerEvent): Point | null => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    return { x: box.left + box.width * ART.knobX / 320, y: box.top + box.height * ART.knobY / 480 }
  }

  const angleFrom = (center: Point | null, event: KnobPointerEvent) =>
    center ? Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI : 0

  const handleDown = (event: KnobPointerEvent) => {
    if (disabled || finishing.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const center = knobCenter(event)
    drag.current = { pointerId: event.pointerId, center, last: angleFrom(center, event), rotation: 0 }
  }

  const handleMove = (event: KnobPointerEvent) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = angleFrom(current.center, event)
    let delta = next - current.last
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    current.last = next
    current.rotation += delta
    setAngle(current.rotation)
    if (Math.abs(current.rotation) >= TURN_TO_PULL) {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      // 문턱을 넘으면 남은 각도를 부드럽게 돌린 다음 뽑는다.
      setAngle(current.rotation > 0 ? 360 : -360)
      fire(560)
    }
  }

  const handleEnd = (event: KnobPointerEvent) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    drag.current = null
    if (Math.abs(current.rotation) < TAP_SLOP) {
      setAngle(360)
      fire(560)
    } else setAngle(0)
  }

  return (
    <div
      className={`dnar-machine ${drag.current ? 'is-dragging' : ''} ${finishing.current ? 'is-finishing' : ''} ${spinning ? 'is-spinning' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="손잡이를 돌리거나 눌러 책을 뽑습니다"
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setAngle(360)
        fire(560)
      }}
    >
      <GachaMachineArt angle={angle} onKnobDown={handleDown} onKnobMove={handleMove} onKnobEnd={handleEnd} />
    </div>
  )
}
