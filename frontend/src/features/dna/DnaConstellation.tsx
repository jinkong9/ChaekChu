/** 활자 이중나선 — BOOK DNA 히어로의 시그니처. 그 위에 독서타입 선언 한 문장만 얹힌다.
 *
 *  레퍼런스(Dala)는 검은 무대 위에서 수천 개의 삼각 입자가 '뇌' 모양으로 모였다가
 *  스크롤을 따라 '전구'로 옮겨 간다. 가져오는 것은 검정·보라가 아니라 그 구조다:
 *  입자마다 목표 좌표가 있고, 흩어진 자리에서 그 목표로 모여든다.
 *
 *  여기 목표 모양은 DNA 이중나선이고, 입자는 하나도 빠짐없이 그 구조의 일부다 —
 *  가닥 위의 점이거나, 두 가닥을 잇는 염기쌍 가로대의 점이다. 배치는 난수가 아니라
 *  균일 간격이다. u를 난수로 뽑으면 뭉치고 끊겨서 나선이 아니라 얼룩으로 보인다.
 *
 *  회전은 위상 하나만 돌린다. 깊이(cos)로 크기와 농도를 바꾸는 것이
 *  평면 사인 곡선을 나선으로 읽히게 하는 전부다.
 *
 *  입자는 삼각형 대신 활자 조각(한글 자모 + 라틴 소문자)이다. 종이 위에서는 도형보다
 *  활자가 자연스럽고, 읽는 앱의 재료이기도 하다. 대부분은 잉크색이고 일부만 완독 표지에서
 *  뽑은 색으로 물든다 — 화면의 색은 표지가 담당한다(DESIGN.md).
 *
 *  성능: 입자마다 fillText를 부르면 수백 개에서 프레임이 무너진다. 글리프·크기·색
 *  조합마다 작은 캔버스를 한 번만 그려 두고(스프라이트) 매 프레임은 drawImage만 한다. */
import { useEffect, useRef } from 'react'

/** 획이 단순한 자모와 소문자만 — 8~13px에서 뭉치지 않는 것들 */
const GLYPHS = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  'ㅏ', 'ㅓ', 'ㅗ', 'ㅜ', 'ㅡ', 'ㅣ',
  'a', 'e', 'i', 'o', 'n', 's', 'r', 'd',
]
/** [가로대용, 가닥용 작은 쪽, 가닥용 큰 쪽] — 가닥이 굵어야 뼈대로 읽힌다 */
const SIZE_RUNG = 8
const SIZE_STRAND = [10, 13]
/** canvas의 font에는 CSS 변수를 못 쓴다 — index.css의 본문 스택을 그대로 적는다 */
const FONT_STACK = `'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif`
const INK = '#0b0b0b'
/** 표지색으로 물드는 비율. 넷 중 하나쯤이라야 종이가 알록달록해지지 않는다 */
const TINT_RATIO = 0.26

const TAU = Math.PI * 2
/** 나선이 화면 안에서 감기는 바퀴 수. 더 늘리면 가닥이 촘촘해져 DNA로 안 읽힌다 */
const TURNS = 2.0
/** 축을 도는 속도(라디안/초). 느려야 배경으로 남는다 */
const SPIN = 0.3
/** 흩어진 자리에서 나선까지 모여드는 데 걸리는 시간(초) */
const SETTLE_SEC = 1.9

/** 가로대 위 점들의 위치(0 = 한쪽 가닥, 1 = 반대쪽 가닥).
 *
 *  0.5는 회전축 그 자체다 — m = 1 - 2k = 0이라 회전해도 좌표가 변하지 않아
 *  그 글자만 화면에 못 박힌 것처럼 굳는다. 그래서 축을 비우고 양쪽으로 대칭 배치한다. */
const RUNG_K = [0.22, 0.36, 0.64, 0.78]

interface Particle {
  sprite: HTMLCanvasElement
  /** 스프라이트의 CSS 크기 (정사각) */
  box: number
  alpha: number
  /** 입자마다 다른 위상 — 다 같이 숨쉬면 물결처럼 보인다 */
  phase: number
  /** 흩어져 있던 시작 좌표 */
  sx: number
  sy: number
  /** 나선 축 위의 위치 0~1 */
  u: number
  /** 0 = 한쪽 가닥, 1 = 반대 위상의 가닥, 사이 값 = 두 가닥을 잇는 가로대 */
  k: number
  /** 모여드는 시작 시각을 입자마다 어긋내 한꺼번에 도착하지 않게 */
  delay: number
}

/** 글리프 한 벌을 미리 그려 둔다. 같은 (글자·크기·색)은 한 번만 그린다. */
function makeSprite(glyph: string, size: number, color: string, dpr: number): HTMLCanvasElement {
  const box = size + 4
  const c = document.createElement('canvas')
  c.width = Math.ceil(box * dpr)
  c.height = Math.ceil(box * dpr)
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.font = `600 ${size}px ${FONT_STACK}`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, box / 2, box / 2)
  return c
}

function buildField(w: number, h: number, tones: string[] | null, dpr: number): Particle[] {
  const cache = new Map<string, HTMLCanvasElement>()
  const sprite = (glyph: string, size: number, color: string) => {
    const key = `${glyph}|${size}|${color}`
    let hit = cache.get(key)
    if (!hit) {
      hit = makeSprite(glyph, size, color, dpr)
      cache.set(key, hit)
    }
    return hit
  }

  const cx = w / 2
  const cy = h / 2
  const field: Particle[] = []

  /** 목표는 (u, k)로만 정하고, 시작 자리는 가운데가 촘촘한 성운에서 아무 데나 */
  const add = (u: number, k: number, size: number, alpha: number) => {
    const r = Math.pow(Math.random(), 1.7)
    const ang = Math.random() * TAU
    const color = tones && tones.length > 0 && Math.random() < TINT_RATIO
      ? tones[Math.floor(Math.random() * tones.length)]
      : INK
    field.push({
      sprite: sprite(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], size, color),
      box: size + 4,
      alpha,
      phase: Math.random() * TAU,
      sx: cx + Math.cos(ang) * r * w * 0.52,
      sy: cy + Math.sin(ang) * r * h * 0.46,
      u,
      k,
      // 왼쪽부터 차례로 앉아 나선이 그려지는 것처럼 보이게 — u에 비례한 시차
      delay: u * 0.45 + Math.random() * 0.12,
    })
  }

  // 폭에 맞춰 촘촘함만 조절한다. 구조(가닥 2 + 가로대)는 크기와 무관하게 같다
  const strandDots = Math.max(80, Math.min(220, Math.round(w / 3.4)))
  const rungs = Math.max(7, Math.min(18, Math.round(w / 44)))

  // 두 가닥 — 균일 간격이라야 끊김 없는 선으로 읽힌다
  for (const k of [0, 1])
    for (let i = 0; i < strandDots; i++)
      add(
        i / (strandDots - 1),
        k,
        SIZE_STRAND[Math.random() < 0.45 ? 1 : 0],
        0.52 + Math.random() * 0.38,
      )

  // 염기쌍 가로대 — 가닥 끝과 겹치지 않게 칸의 가운데에 세운다
  for (let r = 0; r < rungs; r++) {
    const u = (r + 0.5) / rungs
    for (const k of RUNG_K) add(u, k, SIZE_RUNG, 0.3 + Math.random() * 0.26)
  }

  return field
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export default function DnaConstellation({ tones }: { tones: string[] | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let field: Particle[] = []
    let raf = 0
    let w = 0
    let h = 0
    let t0 = 0

    /** @param settled null이면 시간에 따라 모여들고, 1이면 이미 앉은 상태로 그린다 */
    const draw = (t: number, settled: number | null) => {
      ctx.clearRect(0, 0, w, h)
      const cy = h / 2
      // 나선은 가로로 눕힌다 — 상자가 세로보다 넓어서, 세운 나선은 마스크에 잘린다
      const padX = w * 0.015
      const spanX = w * 0.97
      // 상자 높이의 ±42% — 글리프 반지름까지 더하면 위아래를 거의 다 쓴다.
      // 0.5를 넘기면 가닥 꼭대기가 상자 밖으로 나가 잘린다.
      const amp = h * 0.42
      const spin = t * SPIN

      for (const p of field) {
        const a = p.u * TURNS * TAU + spin
        // k=0이면 한쪽 가닥, k=1이면 반대 위상의 가닥, 사이면 두 가닥을 잇는 가로대
        const m = 1 - 2 * p.k
        const hx = padX + p.u * spanX
        const hy = cy + Math.sin(a) * amp * m
        const s = settled ?? easeOut(clamp01((t - t0 - p.delay) / SETTLE_SEC))
        const x = p.sx + (hx - p.sx) * s
        const y = p.sy + (hy - p.sy) * s
        // 다 앉기 전에는 깊이도 같이 켜져야 갑자기 또렷해지지 않는다
        const depth = Math.cos(a) * m * s

        // 뒤로 돌아간 가닥은 작고 옅게 — 이 한 줄이 평면 곡선을 나선으로 읽히게 한다
        const near = (depth + 1) / 2
        const box = p.box * (0.8 + 0.2 * near)
        ctx.globalAlpha = p.alpha * (0.62 + 0.38 * near) * (0.84 + 0.16 * Math.sin(t * 0.5 + p.phase))
        ctx.drawImage(p.sprite, x - box / 2, y - box / 2, box, box)
      }
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      const t = now / 1000
      if (t0 === 0) t0 = t
      draw(t, null)
      raf = requestAnimationFrame(loop)
    }

    const layout = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      field = buildField(w, h, tones, dpr)
      // 움직임을 줄여 달라고 한 사용자에게는 모여드는 과정 없이 완성된 나선 한 장만
      if (still) draw(0, 1)
    }

    layout()
    if (!still) raf = requestAnimationFrame(loop)

    const ro = new ResizeObserver(layout)
    ro.observe(host)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [tones])

  return (
    <div className="dnar-nebula" ref={hostRef} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}
