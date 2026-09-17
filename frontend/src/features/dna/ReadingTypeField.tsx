/** 독서타입은 굵은 글씨로 두고, 올리면 작은 활자가 같은 이름을 다시 쓴다. */
import { useEffect, useRef } from 'react'

const GLYPHS = '가나다라마바사아자차카타파하읽는책의문장aeinorst'
const FONT = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif"
const INK = '#0b0b0b'
const HOVER_IN_MS = 900
const HOVER_OUT_MS = 650
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

type Letter = {
  glyph: string
  color: string
  x: number
  y: number
  fromX: number
  fromY: number
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
    fromX: x + (Math.random() - 0.5) * 65,
    fromY: y + (Math.random() - 0.5) * 45,
    delay: x / w * 0.7 + Math.random() * 0.18,
    alpha: 0.68 + (i % 4) * 0.08,
    size: Math.max(5, step * 0.95),
  }))
  return { letters, fontSize }
}

export default function ReadingTypeField({ typeName, tones }: { typeName: string; tones: string[] | null }) {
  const font = FONT
  const boldWeight = 800
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
    let active = true
    let progress = 0
    let target = 0
    let lastFrame = performance.now()
    let textWidth = 0

    const draw = (now: number) => {
      raf = 0
      const elapsed = Math.min(50, now - lastFrame)
      lastFrame = now
      if (still) progress = target
      else if (target > progress) progress = Math.min(target, progress + elapsed / HOVER_IN_MS)
      else if (target < progress) progress = Math.max(target, progress - elapsed / HOVER_OUT_MS)

      const mix = progress * progress * (3 - 2 * progress)
      ctx.clearRect(0, 0, w, h)
      if (fontSize > 0 && mix < 1) {
        ctx.globalAlpha = 1 - mix
        ctx.font = `${boldWeight} ${fontSize}px ${font}`
        ctx.fillStyle = INK
        ctx.fillText(typeName, w / 2, h / 2)
      }
      if (mix > 0) {
        for (const letter of letters) {
          const arrival = still ? 1 : clamp01((progress - letter.delay * 0.35) / 0.65)
          const settle = 1 - Math.pow(1 - arrival, 3)
          const x = letter.fromX + (letter.x - letter.fromX) * settle
          const y = letter.fromY + (letter.y - letter.fromY) * settle
          ctx.globalAlpha = letter.alpha * mix * (0.25 + settle * 0.75)
          ctx.font = `${thinWeight} ${letter.size}px ${font}`
          ctx.fillStyle = letter.color
          ctx.fillText(letter.glyph, x, y)
        }
      }
      ctx.globalAlpha = 1
      if (progress !== target) raf = requestAnimationFrame(draw)
    }
    const schedule = () => {
      if (!raf) {
        lastFrame = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }

    const layout = () => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      cancelAnimationFrame(raf)
      raf = 0
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
      ctx.font = `${boldWeight} ${fontSize}px ${font}`
      textWidth = ctx.measureText(typeName).width
      draw(performance.now())
    }
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const overText = Math.abs(x - w / 2) <= textWidth / 2 + 14 && Math.abs(y - h / 2) <= fontSize * 0.65
      canvas.style.cursor = overText ? 'pointer' : 'default'
      if (target !== Number(overText)) {
        target = Number(overText)
        schedule()
      }
    }
    const onLeave = () => {
      canvas.style.cursor = 'default'
      target = 0
      schedule()
    }
    const onFocus = () => { target = 1; schedule() }
    const onBlur = () => { target = 0; schedule() }
    layout()
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    host.addEventListener('focus', onFocus)
    host.addEventListener('blur', onBlur)
    // 캔버스는 CSS 를 거치지 않아 웹폰트가 늦게 오면 대체 글꼴로 굳는다 — 도착하면 한 번 더 그린다
    document.fonts?.ready.then(() => { if (active) layout() }).catch(() => {})
    const ro = new ResizeObserver(layout)
    ro.observe(host)
    return () => {
      active = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      host.removeEventListener('focus', onFocus)
      host.removeEventListener('blur', onBlur)
    }
  }, [typeName, tones, font, boldWeight, thinWeight])

  return (
    <div className="dnar-typefield" ref={hostRef} role="img" tabIndex={0} aria-label={`독서타입 ${typeName}. 마우스를 올리거나 초점을 맞추면 작은 글자로 바뀝니다.`}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
