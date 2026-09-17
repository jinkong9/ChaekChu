/** 책 가챠 기계. 유리통의 공은 후보 책과 무관한 장식이다. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type KnobPointerEvent = ReactPointerEvent<SVGCircleElement>

/** 손잡이를 이만큼 돌리면 뽑힌다. 한 바퀴를 요구하면 화면 위 26px짜리 원을 끊기지 않게
 *  끝까지 끌어야 해서 사실상 안 돌아간다 — 3분의 1바퀴면 '돌렸다'는 느낌은 그대로다. */
const TURN_TO_PULL = 110
/** 거의 안 돌리고 뗐다 = 누른 것이다. 손잡이는 눌러도 뽑히는 게 맞다 */
const TAP_SLOP = 8
const BALLS = [
  { x: 102, y: 195, r: 25, color: '#a7b7ad' },
  { x: 143, y: 205, r: 27, color: '#d7b692' },
  { x: 187, y: 205, r: 25, color: '#b9b2c5' },
  { x: 225, y: 191, r: 25, color: '#c89f91' },
  { x: 87, y: 161, r: 23, color: '#d4c49e' },
  { x: 125, y: 164, r: 25, color: '#aebcc8' },
  { x: 165, y: 171, r: 25, color: '#d0a9a2' },
  { x: 205, y: 164, r: 25, color: '#b6bfa2' },
  { x: 239, y: 155, r: 21, color: '#c6b6a0' },
  { x: 103, y: 128, r: 22, color: '#c3a9b4' },
  { x: 140, y: 133, r: 24, color: '#b9c4a9' },
  { x: 179, y: 132, r: 24, color: '#d7b795' },
  { x: 215, y: 126, r: 23, color: '#aabdc0' },
  { x: 122, y: 99, r: 20, color: '#d3b9aa' },
  { x: 159, y: 103, r: 23, color: '#a9b7a5' },
  { x: 197, y: 98, r: 20, color: '#c5b6c7' },
] as const

/** 소개 카드와 가챠 화면이 같은 기계 그림을 쓴다. 실제 손잡이 동작은 가챠 화면에서만 붙인다. */
export function GachaMachineArt({ angle = 0, onKnobDown, onKnobMove, onKnobEnd }: {
  angle?: number
  onKnobDown?: (event: KnobPointerEvent) => void
  onKnobMove?: (event: KnobPointerEvent) => void
  onKnobEnd?: (event: KnobPointerEvent) => void
}) {
  return (
    <svg viewBox="0 0 320 392" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="dnar-porcelain" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#e6dfd4" />
            <stop offset=".14" stopColor="#fffdf8" />
            <stop offset=".68" stopColor="#f4efe7" />
            <stop offset="1" stopColor="#d9d0c5" />
          </linearGradient>
          <linearGradient id="dnar-glass" x1="0" y1="0" x2="1" y2=".65">
            <stop stopColor="#fff" stopOpacity=".46" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".04" />
            <stop offset="1" stopColor="#8c8277" stopOpacity=".16" />
          </linearGradient>
          <radialGradient id="dnar-ball-shade" cx=".32" cy=".24" r=".78">
            <stop stopColor="#fff" stopOpacity=".55" />
            <stop offset=".42" stopColor="#fff" stopOpacity=".02" />
            <stop offset="1" stopColor="#3c332d" stopOpacity=".34" />
          </radialGradient>
          <linearGradient id="dnar-metal" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#eeeae3" />
            <stop offset=".38" stopColor="#aaa49d" />
            <stop offset=".7" stopColor="#f9f6ef" />
            <stop offset="1" stopColor="#807970" />
          </linearGradient>
          <clipPath id="dnar-globe-clip"><circle cx="160" cy="145" r="96" /></clipPath>
        </defs>

        <ellipse cx="160" cy="381" rx="102" ry="8" fill="#777066" opacity=".14" />

        {/* 둥근 유리통과 색색의 공 */}
        <circle cx="160" cy="145" r="96" fill="#f8f6f1" stroke="#bcb2a6" strokeWidth="2" />
        <g clipPath="url(#dnar-globe-clip)">
          <path d="M58 192c29 26 175 31 204-2v65H58z" fill="#d5cfc5" opacity=".3" />
          {BALLS.map((ball) => (
            <g key={`${ball.x}-${ball.y}`}>
              <circle cx={ball.x} cy={ball.y} r={ball.r} fill={ball.color} stroke="#63594f" strokeOpacity=".2" />
              <circle cx={ball.x} cy={ball.y} r={ball.r} fill="url(#dnar-ball-shade)" />
              <ellipse cx={ball.x - ball.r * .29} cy={ball.y - ball.r * .37} rx={ball.r * .34} ry={ball.r * .16} fill="#fff" opacity=".38" transform={`rotate(-30 ${ball.x - ball.r * .29} ${ball.y - ball.r * .37})`} />
            </g>
          ))}
          <circle cx="160" cy="145" r="96" fill="url(#dnar-glass)" />
          <path d="M83 91c-23 24-30 54-22 84" fill="none" stroke="#fff" strokeWidth="13" strokeLinecap="round" opacity=".46" />
          <path d="M239 103c16 29 20 53 14 75" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".35" />
        </g>
        <circle cx="160" cy="145" r="96" fill="none" stroke="#8e857b" strokeOpacity=".58" strokeWidth="2" />

        {/* 위쪽 뚜껑에는 문구를 넣지 않는다 */}
        <path d="M68 93c4-32 39-51 92-51s88 19 92 51c-43-12-141-12-184 0z" fill="url(#dnar-porcelain)" stroke="#a99f92" strokeWidth="1.4" />
        <path d="M79 78c35-31 125-34 161 0" fill="none" stroke="#fff" strokeWidth="8" opacity=".48" />
        <path d="M67 92c53-12 133-12 186 0" fill="none" stroke="#8f8578" strokeWidth="3" opacity=".7" />

        {/* 도자기 본체와 하단 받침 */}
        <path d="M93 229h134c10 0 16 6 18 16l17 122H58l17-122c2-10 8-16 18-16z" fill="url(#dnar-porcelain)" stroke="#aca296" strokeWidth="1.5" />
        <path d="M78 245h164" stroke="#fff" strokeWidth="2" opacity=".75" />
        <path d="M56 362h208v12c0 5-4 8-9 8H65c-5 0-9-3-9-8z" fill="url(#dnar-porcelain)" stroke="#aca296" strokeWidth="1.5" />
        <path d="M57 368h206" stroke="#fff" strokeWidth="2" opacity=".8" />

        {/* 회전 손잡이와 배출구 */}
        <circle cx="160" cy="285" r="29" fill="#ddd6cc" stroke="#80786f" strokeWidth="1.5" />
        <circle cx="160" cy="285" r="25" fill="url(#dnar-metal)" stroke="#f9f6ee" strokeWidth="1.5" />
        <g className="dnar-machine__knob" transform={`rotate(${angle} 160 285)`}>
          <rect x="139" y="279" width="42" height="12" rx="6" fill="url(#dnar-metal)" stroke="#6e675f" strokeWidth="1.6" />
          <path d="M143 282h33" stroke="#fff" strokeWidth="1.5" opacity=".7" />
        </g>
        <path d="M124 281a38 38 0 0 0 0 10m72-10a38 38 0 0 1 0 10" fill="none" stroke="#7b746c" strokeWidth="1.3" strokeLinecap="round" />
        {onKnobDown && (
          <circle
            className="dnar-machine__knob-hit"
            cx="160" cy="285" r="34"
            fill="transparent"
            onPointerDown={onKnobDown}
            onPointerMove={onKnobMove}
            onPointerUp={onKnobEnd}
            onPointerCancel={onKnobEnd}
          />
        )}
        <path d="M128 316h64c5 0 9 4 9 9v43h-82v-43c0-5 4-9 9-9z" fill="#e1d9ce" stroke="#a89d90" strokeWidth="1.4" />
        <path d="M134 323h52c4 0 7 3 7 7v36h-66v-36c0-4 3-7 7-7z" fill="#393631" />
        <circle cx="160" cy="348" r="15" fill="#c2b3a0" stroke="#ede5d8" strokeWidth="2" />
        <circle cx="160" cy="348" r="15" fill="url(#dnar-ball-shade)" />
        <path d="M127 368h66" stroke="#fff" strokeWidth="2" opacity=".7" />
    </svg>
  )
}

export default function GachaMachine({ onPull, disabled }: { onPull: () => void; disabled?: boolean }) {
  const [angle, setAngle] = useState(0)
  const drag = useRef<{ pointerId: number; last: number; rotation: number } | null>(null)
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

  const pointerAngle = (event: KnobPointerEvent) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return 0
    const box = svg.getBoundingClientRect()
    return Math.atan2(event.clientY - (box.top + box.height * 285 / 392), event.clientX - (box.left + box.width / 2)) * 180 / Math.PI
  }

  const handleDown = (event: KnobPointerEvent) => {
    if (disabled || finishing.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, last: pointerAngle(event), rotation: 0 }
  }

  const handleMove = (event: KnobPointerEvent) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = pointerAngle(event)
    let delta = next - current.last
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    current.last = next
    current.rotation += delta
    setAngle(current.rotation)
    if (Math.abs(current.rotation) >= TURN_TO_PULL) {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      // 문턱을 넘은 순간 한 바퀴까지 마저 돌려 준다 — 손이 멈춘 자리에서 끊기면 덜 돌린 것처럼 보인다
      setAngle(current.rotation > 0 ? 360 : -360)
      fire(220)
    }
  }

  const handleEnd = (event: KnobPointerEvent) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    drag.current = null
    setAngle(0)
    if (Math.abs(current.rotation) < TAP_SLOP) fire(0)
  }

  return (
    <div
      className={`dnar-machine ${drag.current ? 'is-dragging' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="손잡이를 돌리거나 눌러 책을 뽑습니다"
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setAngle(360)
        fire(220)
      }}
    >
      <GachaMachineArt angle={angle} onKnobDown={handleDown} onKnobMove={handleMove} onKnobEnd={handleEnd} />
    </div>
  )
}
