/** C안: 작은 활자가 흩어진 자리에서 모여 실제 사용자의 독서타입 이름을 쓴다. */
import { useEffect, useRef } from 'react'

const GLYPHS = '가나다라마바사아자차카타파하읽는책의문장aeinorst'
const FONT = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif"
const INK = '#0b0b0b'

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

function makeLetters(w: number, h: number, typeName: string, tones: string[] | null): { letters: Letter[]; fontSize: number } {
  const mask = document.createElement('canvas')
  mask.width = Math.ceil(w)
  mask.height = Math.ceil(h)
  const ctx = mask.getContext('2d')
  if (!ctx) return { letters: [], fontSize: 0 }

  let fontSize = Math.min(132, h * 0.39)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  do {
    ctx.font = `700 ${fontSize}px ${FONT}`
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
      const elapsed = still ? 5 : (now - started) / 1000
      ctx.clearRect(0, 0, w, h)
      for (const letter of letters) {
        const progress = Math.max(0, Math.min(1, (elapsed - letter.delay) / 1.45))
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
        ctx.globalAlpha = letter.alpha * (0.25 + settle * 0.75)
        ctx.font = `600 ${letter.size}px ${FONT}`
        ctx.fillStyle = letter.color
        ctx.fillText(letter.glyph, x, y)
      }
      // 입자가 획을 완성한 뒤 실제 타입명을 얇게 겹쳐, 결과를 한눈에 읽을 수 있게 한다.
      const reveal = Math.max(0, Math.min(1, (elapsed - 1.7) / 0.5))
      if (fontSize > 0 && reveal > 0) {
        ctx.globalAlpha = reveal
        ctx.font = `700 ${fontSize}px ${FONT}`
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
      const field = makeLetters(w, h, typeName, tones)
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
    const ro = new ResizeObserver(layout)
    ro.observe(host)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [typeName, tones])

  return (
    <div className="dnar-typefield" ref={hostRef} role="img" aria-label={`글자들이 모여 완성한 독서타입: ${typeName}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
