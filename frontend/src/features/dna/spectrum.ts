/** 취향 스펙트럼 — 표지 이미지에서 대표색을 추출해 하나의 색 띠로 합성한다.
 *
 *  DESIGN.md 원칙("표지가 색을 담당한다")에 따라 이 띠는 장식 그라데이션이 아니라
 *  완독한 책 표지들에서 실제로 뽑아낸 색이다. 한국 도서 표지는 흰 배경이 많아
 *  단순 평균을 내면 탁한 회베이지로 수렴하므로, 무채색 픽셀을 버리고
 *  채도 가중치로 도미넌트 색을 고른 뒤 좁은 톤 범위로 보정한다.
 *
 *  띠가 탁해지는 두 번째 원인은 렌더링이다 — 멀리 떨어진 색(파랑↔주황)을
 *  길게 연속 보간하면 중간에 갈색이 생긴다. 그래서 ① 비슷한 색을 가족(cluster)으로
 *  묶어 색 수를 줄이고, ② 각 가족은 평평한 구간(plateau)을 갖고 경계에서만 짧게
 *  섞이게 하고, ③ 보간은 지원 브라우저에서 oklch 색공간으로 한다(회색 경유 방지). */

export interface CoverColor {
  hex: string
  h: number // 0~360
  s: number // 0~1
  l: number // 0~1
}

export interface SpectrumStop {
  isbn13: string
  coverUrl: string
  title: string
  color: CoverColor
  /** 평점 가중치 — 좋아한 책일수록 띠에서 넓은 폭을 차지한다 */
  weight: number
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** 화면 요소(레이더 채움·지표 막대·카드 강조)에 쓸 때의 명도 범위. 표지 대표색은 흰 배경 표지의 파스텔이 많아
 *  그대로 칠하면 종이 위에서 거의 안 보인다(레이더가 연하다는 지적, 09-16). 색상(h)·채도(s)는 두고 명도만 이 안으로 접는다. */
const TONE_LIGHTNESS_MIN = 0.3
const TONE_LIGHTNESS_MAX = 0.5

/** 표지 대표색 → 화면에 칠할 색. 스펙트럼 띠(buildSpectrum)는 표지 그대로를 보이는 자리라 이 보정을 쓰지 않는다. */
export function displayTone(color: CoverColor): string {
  const l = Math.min(TONE_LIGHTNESS_MAX, Math.max(TONE_LIGHTNESS_MIN, color.l))
  return hslToHex(color.h, color.s, l)
}

/** 막대·레이더 채움에 쓸 색 하나를 고른다.
 *
 *  줄마다 다른 색을 칠하면 무지개가 되는데, 표지 대표색은 채도가 고르지 않아 그 무지개가
 *  대개 진흙색으로 끝난다. 값의 차이는 길이가 이미 말하므로 색까지 나눌 이유가 없다 —
 *  한 화면에 강조색 하나만 두고, 그 하나는 표지에서 가장 선명한 색으로 고른다.
 *
 *  채도가 바닥이면(표지가 전부 무채색) 색을 억지로 만들지 않고 잉크로 돌아간다. */
const ACCENT_MIN_SATURATION = 0.22
/** 종이 위에서 가장 또렷하게 읽히는 밝기 — 이보다 밝으면 묻히고, 어두우면 잉크와 구별되지 않는다 */
const ACCENT_IDEAL_LIGHTNESS = 0.42

export function accentOf(hexes: readonly string[] | null | undefined): string | null {
  if (!hexes || hexes.length === 0) return null
  let best: { hex: string; score: number } | null = null
  for (const hex of hexes) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex)
    if (!m) continue
    const n = parseInt(m[1], 16)
    const [, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
    if (s < ACCENT_MIN_SATURATION) continue
    const score = s * (1 - Math.abs(l - ACCENT_IDEAL_LIGHTNESS))
    if (!best || score > best.score) best = { hex, score }
  }
  return best?.hex ?? null
}

const imageCache = new Map<string, Promise<CoverColor>>()

/** 표지가 전부 무채색일 때의 폴백 (종이 계열, placeholder보다 살짝 짙게) */
const NEUTRAL: CoverColor = { hex: '#c9c4b8', h: 40, s: 0.13, l: 0.75 }

/** 표지 한 장의 도미넌트 색. 같은 URL은 캐시로 1회만 계산한다. */
export function extractCoverColor(src: string): Promise<CoverColor> {
  const hit = imageCache.get(src)
  if (hit) return hit

  const job = new Promise<CoverColor>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const W = 24, H = 34 // 표지 비율 0.7 근사 — 도미넌트 색에는 이 해상도로 충분
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return resolve(NEUTRAL)
      ctx.drawImage(img, 0, 0, W, H)
      let data: Uint8ClampedArray
      try {
        data = ctx.getImageData(0, 0, W, H).data
      } catch {
        return resolve(NEUTRAL) // 외부 CDN 표지가 섞여 CORS로 막힌 경우
      }

      // 12개 색상(hue) 버킷에 채도 가중으로 누적 → 가장 무거운 버킷이 도미넌트
      const N = 12
      const wsum = new Array<number>(N).fill(0)
      const hsum = new Array<number>(N).fill(0)
      const ssum = new Array<number>(N).fill(0)
      const lsum = new Array<number>(N).fill(0)
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue
        const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
        if (l > 0.93 || l < 0.07 || s < 0.12) continue // 흰 배경·검정 잉크·회색 제거
        const w = s * (1 - Math.abs(l - 0.5)) // 채도 높고 중간 밝기일수록 대표성 ↑
        const b = Math.min(N - 1, Math.floor((h / 360) * N))
        wsum[b] += w; hsum[b] += h * w; ssum[b] += s * w; lsum[b] += l * w
      }
      const top = wsum.indexOf(Math.max(...wsum))
      if (wsum[top] <= 0) return resolve(NEUTRAL)

      const h = hsum[top] / wsum[top]
      // 흰 여백에 눌린 채도·밝기를 보정하고, 여러 색이 나란해도 톤이 튀지 않게 정규화
      const s = Math.min(0.78, Math.max(0.32, (ssum[top] / wsum[top]) * 1.2 + 0.06))
      const l = Math.min(0.62, Math.max(0.46, lsum[top] / wsum[top]))
      resolve({ hex: hslToHex(h, s, l), h, s, l })
    }
    img.onerror = () => resolve(NEUTRAL)
    img.src = src
  })

  imageCache.set(src, job)
  return job
}

interface Cluster { h: number; s: number; l: number; weight: number }

/** 색상환 순서로 정렬 (무채색 폴백은 맨 뒤) */
function orderByHue(stops: SpectrumStop[]): SpectrumStop[] {
  return [...stops].sort((a, b) => (a.color.s < 0.15 ? 999 : a.color.h) - (b.color.s < 0.15 ? 999 : b.color.h))
}

/** 스펙트럼 합성 — 표지 색을 색 가족으로 묶어 plateau + 짧은 블렌드의 띠 CSS를 만든다. */
export function buildSpectrum(stops: SpectrumStop[]): { css: string; ordered: SpectrumStop[] } {
  const ordered = orderByHue(stops)
  if (ordered.length === 0) return { css: 'none', ordered }

  // 1) 색이 있는 책만 그라데이션 재료로 (무채색 폴백은 표지 스트립에는 남는다)
  const colored = ordered.filter((s) => s.color.s >= 0.15)
  const source = colored.length > 0 ? colored : ordered

  // 2) hue가 36° 이내로 가까운 색끼리 가중 평균으로 병합 → 색 가족
  const clusters: Cluster[] = []
  for (const s of source) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(s.color.h - last.h) < 36) {
      const w = last.weight + s.weight
      last.h = (last.h * last.weight + s.color.h * s.weight) / w
      last.s = (last.s * last.weight + s.color.s * s.weight) / w
      last.l = (last.l * last.weight + s.color.l * s.weight) / w
      last.weight = w
    } else {
      clusters.push({ h: s.color.h, s: s.color.s, l: s.color.l, weight: s.weight })
    }
  }

  // 3) 가족이 너무 많으면 지분 상위 6개만 (hue 순서는 유지)
  const kept =
    clusters.length <= 6
      ? clusters
      : clusters.filter((c) => c.weight >= [...clusters.map((x) => x.weight)].sort((a, b) => b - a)[5])

  // 4) 각 가족은 폭의 가운데가 평평(plateau)하고 이웃과는 짧게만 섞인다
  const total = kept.reduce((sum, c) => sum + c.weight, 0)
  let acc = 0
  const parts: string[] = []
  for (const c of kept) {
    const start = (acc / total) * 100
    const end = ((acc + c.weight) / total) * 100
    const pad = Math.min(5, (end - start) * 0.28)
    const hex = hslToHex(c.h, c.s, c.l)
    parts.push(`${hex} ${(start + pad).toFixed(1)}%`, `${hex} ${(end - pad).toFixed(1)}%`)
    acc += c.weight
  }

  // 5) 지원 브라우저는 oklch 보간 — 파랑↔주황 사이가 회색을 경유하지 않는다
  const oklch = typeof CSS !== 'undefined' && CSS.supports('background', 'linear-gradient(90deg in oklch, red, blue)')
  return { css: `linear-gradient(90deg${oklch ? ' in oklch' : ''}, ${parts.join(', ')})`, ordered }
}
