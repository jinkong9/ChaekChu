/** C안: 작은 활자가 흩어진 자리에서 모여 실제 사용자의 독서타입 이름을 쓴다. */
import { useEffect, useRef } from 'react'

const GLYPHS = '가나다라마바사아자차카타파하읽는책의문장aeinorst'
const FONT = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif"
const INK = '#0b0b0b'
// 마지막 글자가 도착한 뒤 타입 이름을 잠시 보여 주고 굵은 글씨로 넘긴다.
const LETTER_FADE_START = 3.2
const LETTER_FADE_END = 3.65
const BOLD_START = 3.45
const BOLD_END = 4
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

type Letter = {
  glyph: string
  color: string
  x: number
  y: number
  fromX: number
  fromY: number
  phase: number
  delay: number
  alpha: number
  size: number
}

function makeLetters(w: number, h: number, typeName: string, tones: string[] | null, font: string, boldWeight: number): { letters: Letter[]; fontSize: number } {
  const mask = document.createElement('canvas')
  mask.width = Math.ceil(w)
  mask.height = Math.ceil(h)
  const ctx = mask.getContext('2d')
  if (!ctx) return { letters: [], fontSize: 0 }

  let fontSize = Math.min(132, h * 0.39)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  do {
    ctx.font = `${boldWeight} ${fontSize}px ${font}`
    if (ctx.measureText(typeName).width <= w * 0.88) break
    fontSize *= 0.92
  } while (fontSize > 20)
  ctx.fillText(typeName, w / 2, h / 2)

  const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data
  const step = Math.max(4, Math.round(Math.min(w, h) / 46))
  const targets: { x: number; y: number }[] = []
  for (let y = Math.floor(step / 2); y < mask.height; y += step) {
    for (let x = Math.floor(step / 2); x < mask.width; x += step) {
      if (pixels[(y * mask.width + x) * 4 + 3] > 120) targets.push({ x, y })
    }
  }

  const maxLetters = w < 480 ? 480 : 850
  const stride = Math.max(1, Math.ceil(targets.length / maxLetters))
  const letters = targets.filter((_, i) => i % stride === 0).map(({ x, y }, i) => ({
    glyph: GLYPHS[(i * 13 + Math.floor(i / 7)) % GLYPHS.length],
    color: tones?.length && i % 11 === 0 ? tones[i % tones.length] : INK,
    x,
    y,
    fromX: Math.random() * w,
    fromY: Math.random() * h,
    phase: i * 1.73,
    delay: x / w * 0.7 + Math.random() * 0.18,
    alpha: 0.68 + (i % 4) * 0.08,
    size: Math.max(5, step * 0.95),
  }))
  return { letters, fontSize }
}

export default function ReadingTypeField({ typeName, tones }: { typeName: string; tones: string[] | null }) {
  const font = FONT
  const boldWeight = 700
  const thinWeight = 600
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!host || !canvas || !ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let letters: Letter[] = []
    let fontSize = 0
    let raf = 0
    let started = performance.now()
    let lastFrame = 0
    let pointer: { x: number; y: number } | null = null

    const draw = (now: number) => {
      if (!still && now - lastFrame < 32) {
        raf = requestAnimationFrame(draw)
        return
      }
      lastFrame = now
      const elapsed = still ? BOLD_END : (now - started) / 1000
      const particleOpacity = 1 - clamp01((elapsed - LETTER_FADE_START) / (LETTER_FADE_END - LETTER_FADE_START))
      ctx.clearRect(0, 0, w, h)
      if (particleOpacity > 0) {
        for (const letter of letters) {
          const progress = clamp01((elapsed - letter.delay) / 1.45)
          const settle = 1 - Math.pow(1 - progress, 3)
          let x = letter.fromX + (letter.x - letter.fromX) * settle
          let y = letter.fromY + (letter.y - letter.fromY) * settle
          if (!still) {
            x += Math.sin(elapsed * 0.8 + letter.phase) * 0.55 * settle
            y += Math.cos(elapsed * 0.7 + letter.phase) * 0.7 * settle
          }
          if (pointer && !still) {
            const dx = x - pointer.x
            const dy = y - pointer.y
            const distance = Math.hypot(dx, dy)
            if (distance > 0 && distance < 65) {
              const push = (1 - distance / 65) * 9
              x += dx / distance * push
              y += dy / distance * push
            }
          }
          ctx.globalAlpha = letter.alpha * (0.25 + settle * 0.75) * particleOpacity
          ctx.font = `${thinWeight} ${letter.size}px ${font}`
          ctx.fillStyle = letter.color
          ctx.fillText(letter.glyph, x, y)
        }
      }
      // 입자가 완성한 이름을 잠시 보여 준 뒤 굵은 글씨로 전환한다. 전환 후 입자는 그리지 않는다.
      const reveal = clamp01((elapsed - BOLD_START) / (BOLD_END - BOLD_START))
      if (fontSize > 0 && reveal > 0) {
        ctx.globalAlpha = reveal
        ctx.font = `${boldWeight} ${fontSize}px ${font}`
        ctx.fillStyle = INK
        ctx.fillText(typeName, w / 2, h / 2)
      }
      ctx.globalAlpha = 1
      if (!still) raf = requestAnimationFrame(draw)
    }

    const layout = () => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const field = makeLetters(w, h, typeName, tones, font, boldWeight)
      letters = field.letters
      fontSize = field.fontSize
      started = performance.now()
      if (still) draw(0)
    }
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const onLeave = () => { pointer = null }
    layout()
    if (!still) {
      raf = requestAnimationFrame(draw)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerleave', onLeave)
    }
    // 캔버스는 CSS 를 거치지 않아 웹폰트가 늦게 오면 대체 글꼴로 굳는다 — 도착하면 한 번 더 그린다
    document.fonts?.ready.then(layout).catch(() => {})
    const ro = new ResizeObserver(layout)
    ro.observe(host)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [typeName, tones, font, boldWeight, thinWeight])

  return (
    <div className="dnar-typefield" ref={hostRef} role="img" aria-label={`글자들이 모여 완성한 독서타입: ${typeName}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
