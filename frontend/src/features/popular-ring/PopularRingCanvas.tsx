import { useEffect, useRef } from 'react'
import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import type { PopularBook, PopularSegment, PopularSelection } from './types'

const TAU = Math.PI * 2
const SECTOR_GAP = 2.6 * (Math.PI / 180)
const IDLE_SPEED = 0.035
const MAX_VELOCITY = 2.4
const LOAD_CONCURRENCY = 8
// 이 각도(rad)만큼 돈 첫 방향으로 드래그 방향을 고정한다.
const DIRECTION_LOCK_THRESHOLD = 0.004
// 포인터 이벤트 하나가 만들 수 있는 최대 회전. 튀는 입력을 막는다.
const MAX_DRAG_STEP = 0.3
// 링 중심 근처(정규화 반지름)에서는 각도가 급격히 튀므로 회전에 쓰지 않는다.
const DRAG_DEAD_ZONE = 0.12

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (value: number) => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI

interface Slot {
  segment: PopularSegment
  book: PopularBook
  baseAngle: number
  placeholder: Sprite
  cover: Sprite | null
}

interface Props {
  segments: PopularSegment[]
  activeSegmentId: string | null
  onActiveSegmentChange: (segmentId: string | null) => void
  onSelectionChange: (selection: PopularSelection | null) => void
  onBookOpen: (book: PopularBook) => void
  onLoadProgress: (loaded: number, total: number) => void
  onRendererReady: (renderer: 'webgl' | 'fallback') => void
}

export default function PopularRingCanvas({
  segments,
  activeSegmentId,
  onActiveSegmentChange,
  onSelectionChange,
  onBookOpen,
  onLoadProgress,
  onRendererReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([])
  const activeRef = useRef(activeSegmentId)
  const selectionRef = useRef(onSelectionChange)
  const bookOpenRef = useRef(onBookOpen)
  const activeChangeRef = useRef(onActiveSegmentChange)
  const snapTargetRef = useRef<number | null>(null)
  const rotationValueRef = useRef(0)

  activeRef.current = activeSegmentId
  selectionRef.current = onSelectionChange
  bookOpenRef.current = onBookOpen
  activeChangeRef.current = onActiveSegmentChange

  useEffect(() => {
    const host = hostRef.current
    const labels = labelsRef.current
    if (!host || segments.length === 0) return

    let cancelled = false
    let app: Application | null = null
    let initialized = false
    let labelsPositioned = false
    const listeners: Array<() => void> = []

    const setup = async () => {
      const nextApp = new Application()
      app = nextApp

      try {
        await nextApp.init({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 1.5),
          preference: 'webgl',
          powerPreference: 'high-performance',
        })
        initialized = true
      } catch {
        onRendererReady('fallback')
        return
      }

      if (cancelled) {
        nextApp.destroy(true)
        return
      }

      onRendererReady('webgl')
      const canvas = nextApp.canvas as HTMLCanvasElement
      canvas.className = 'popular-ring__canvas'
      canvas.setAttribute('aria-hidden', 'true')
      host.prepend(canvas)

      const world = new Container()
      world.sortableChildren = true
      nextApp.stage.addChild(world)

      const sectorSpan = TAU / segments.length
      const slots: Slot[] = []
      const slotsByCover = new Map<string, Slot[]>()
      const geometryOwner = host.closest<HTMLElement>('.popular-home')
      let lastGeometryKey = ''

      segments.forEach((segment, segmentIndex) => {
        const innerSpan = sectorSpan - SECTOR_GAP
        const count = Math.max(1, segment.items.length)
        segment.items.forEach((book, itemIndex) => {
          const local = count === 1 ? innerSpan / 2 : (itemIndex / (count - 1)) * innerSpan
          const baseAngle = segmentIndex * sectorSpan + SECTOR_GAP / 2 + local - Math.PI
          const placeholder = new Sprite(Texture.WHITE)
          placeholder.anchor.set(0.5, 1)
          placeholder.tint = 0xe8e8e4
          placeholder.alpha = 0.42
          world.addChild(placeholder)

          const slot: Slot = { segment, book, baseAngle, placeholder, cover: null }
          slots.push(slot)
          if (book.coverUrl) {
            const group = slotsByCover.get(book.coverUrl) ?? []
            group.push(slot)
            slotsByCover.set(book.coverUrl, group)
          }
        })
      })

      let rotation = 0
      let velocity = 0
      let dragging = false
      let pointerId = -1
      let lastX = 0
      let lastY = 0
      let lastTime = 0
      let moved = 0
      // 드래그를 각도로 환산하려면 티커가 매 프레임 계산하는 링 형상이 필요하다.
      let ringCenterX = 0
      let ringCenterY = 0
      let ringRadiusX = 1
      let ringRadiusY = 1
      let lastAngle: number | null = null
      // 한 번 누른 동안에는 처음 움직인 방향으로만 돈다. 손이 되돌아오는 구간은
      // 회전에 반영하지 않아, 누르고 있는 중에 링이 앞뒤로 흔들리지 않는다.
      let dragDirection = 0
      let hovered: Slot | null = null
      let pinned: Slot | null = null
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      const setHover = (slot: Slot | null) => {
        if (dragging || hovered === slot) return
        hovered = slot
        const visibleSlot = hovered ?? pinned
        selectionRef.current(visibleSlot ? { book: visibleSlot.book, segment: visibleSlot.segment } : null)
      }

      const bindPointer = (sprite: Sprite, slot: Slot) => {
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointerover', () => setHover(slot))
        sprite.on('pointerout', () => {
          if (hovered === slot) setHover(null)
        })
        sprite.on('pointertap', () => {
          if (moved > 5) return
          bookOpenRef.current(slot.book)
        })
      }

      slots.forEach((slot) => bindPointer(slot.placeholder, slot))

      const loadOrder = [...slotsByCover.keys()].sort((a, b) => {
        const aa = slotsByCover.get(a)?.[0]?.baseAngle ?? 0
        const ba = slotsByCover.get(b)?.[0]?.baseAngle ?? 0
        return Math.abs(Math.cos(ba)) - Math.abs(Math.cos(aa))
      })

      let loaded = 0
      onLoadProgress(0, loadOrder.length)

      const loadTexture = async (url: string) => {
        try {
          const texture = await Assets.load<Texture>(url)
          if (cancelled || !texture) return
          slotsByCover.get(url)?.forEach((slot) => {
            const cover = new Sprite(texture)
            cover.anchor.set(0.5, 1)
            bindPointer(cover, slot)
            slot.cover = cover
            world.addChild(cover)
          })
        } catch {
          // 실패한 외부 이미지는 자리표시자를 유지한다. 중앙 상세의 일반 img가 한 번 더 폴백한다.
        } finally {
          loaded += 1
          onLoadProgress(loaded, loadOrder.length)
        }
      }

      let nextTexture = 0
      const textureWorker = async () => {
        while (!cancelled && nextTexture < loadOrder.length) {
          const url = loadOrder[nextTexture]
          nextTexture += 1
          await loadTexture(url)
        }
      }
      void Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, loadOrder.length) }, textureWorker))

      // 타원을 원으로 정규화한 좌표에서 본 커서의 각도. 표지를 배치할 때 쓰는 각도와
      // 같은 좌표계라, 이 각도의 변화량을 그대로 rotation에 더하면 잡은 표지가
      // 커서를 따라온다 — 위/아래로 끌든 좌우로 끌든 같은 규칙으로 돈다.
      const pointerAngle = (event: PointerEvent): number | null => {
        const bounds = canvas.getBoundingClientRect()
        const nx = (event.clientX - bounds.left - ringCenterX) / ringRadiusX
        const ny = (event.clientY - bounds.top - ringCenterY) / ringRadiusY
        if (Math.hypot(nx, ny) < DRAG_DEAD_ZONE) return null
        return Math.atan2(ny, nx)
      }

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        dragging = true
        pointerId = event.pointerId
        lastX = event.clientX
        lastY = event.clientY
        lastAngle = pointerAngle(event)
        lastTime = performance.now()
        moved = 0
        velocity = 0
        dragDirection = 0
        snapTargetRef.current = null
        canvas.setPointerCapture(event.pointerId)
      }

      const onPointerMove = (event: PointerEvent) => {
        if (!dragging || event.pointerId !== pointerId) return
        const now = performance.now()
        const dt = Math.max((now - lastTime) / 1000, 1 / 240)

        const angle = pointerAngle(event)
        const step = angle != null && lastAngle != null
          ? clamp(shortestAngle(angle - lastAngle), -MAX_DRAG_STEP, MAX_DRAG_STEP)
          : 0
        if (angle != null) lastAngle = angle

        if (dragDirection === 0 && Math.abs(step) >= DIRECTION_LOCK_THRESHOLD) dragDirection = Math.sign(step)
        const delta = Math.sign(step) === dragDirection ? step : 0
        rotation += delta
        velocity = clamp(velocity * 0.65 + (delta / dt) * 0.35, -MAX_VELOCITY, MAX_VELOCITY)

        const previousMoved = moved
        moved += Math.hypot(event.clientX - lastX, event.clientY - lastY)
        if (previousMoved <= 5 && moved > 5) {
          hovered = null
          pinned = null
          selectionRef.current(null)
        }
        lastX = event.clientX
        lastY = event.clientY
        lastTime = now
      }

      const endPointer = (event: PointerEvent) => {
        if (!dragging || event.pointerId !== pointerId) return
        if (moved <= 5) {
          pinned = hovered
          selectionRef.current(hovered ? { book: hovered.book, segment: hovered.segment } : null)
        }
        dragging = false
        pointerId = -1
      }

      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        snapTargetRef.current = null
        velocity = clamp(velocity - event.deltaY * 0.0015, -MAX_VELOCITY, MAX_VELOCITY)
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', endPointer)
      canvas.addEventListener('pointercancel', endPointer)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      listeners.push(
        () => canvas.removeEventListener('pointerdown', onPointerDown),
        () => canvas.removeEventListener('pointermove', onPointerMove),
        () => canvas.removeEventListener('pointerup', endPointer),
        () => canvas.removeEventListener('pointercancel', endPointer),
        () => canvas.removeEventListener('wheel', onWheel),
      )

      nextApp.ticker.add((ticker) => {
        const dt = Math.min(ticker.deltaMS / 1000, 0.05)
        const snapTarget = snapTargetRef.current
        if (!dragging && snapTarget != null) {
          const distance = snapTarget - rotation
          velocity += distance * 16 * dt
          velocity *= Math.exp(-7.5 * dt)
          rotation += velocity * dt
          if (Math.abs(distance) < 0.002 && Math.abs(velocity) < 0.01) {
            rotation = snapTarget
            velocity = 0
            snapTargetRef.current = null
          }
        } else if (!dragging && !reducedMotion) {
          // 필터를 걸면 자동 회전을 멈춘다 — 고른 그룹을 들여다보는 중에 링이
          // 계속 흐르면 읽기 어렵다. 해제하면 다시 돈다. 드래그·휠은 그대로 먹고,
          // 손을 떼면 여기서 감속해 멈춘다.
          const targetVelocity = hovered || activeRef.current != null ? 0 : IDLE_SPEED
          velocity += (targetVelocity - velocity) * (1 - Math.exp(-2.8 * dt))
          rotation += velocity * dt
        }

        // screen은 CSS 픽셀 기준이다. renderer.width를 resolution으로 다시 나누면
        // 고밀도 화면에서 링이 좌상단으로 축소되어 중앙 UI와 어긋난다.
        const width = nextApp.screen.width
        const height = nextApp.screen.height
        // The ring and the HTML content inside it use the same measured geometry.
        // As the viewport narrows, the ellipse gets proportionally smaller and a
        // little rounder instead of being held at a fixed minimum width.
        const compactness = 1 - clamp((width - 390) / 510, 0, 1)
        // 라벨이 표시되는 중간 폭에서는 가장 긴 라벨까지 들어갈 바깥 여백을
        // 먼저 확보한다. 모바일은 라벨을 숨기므로 기존 링 크기를 유지한다.
        const labelSafeRadius = width > 640 && width <= 900
          ? width * 0.5 - clamp(width * 0.18, 112, 140)
          : width
        const radiusX = Math.min(width * (0.36 + compactness * 0.04), height * 0.66, labelSafeRadius, 540)
        const radiusY = radiusX * (0.47 + compactness * 0.09)
        const centerX = width * 0.5
        const centerY = height * 0.5
        ringCenterX = centerX
        ringCenterY = centerY
        ringRadiusX = radiusX
        ringRadiusY = radiusY
        const baseWidth = clamp(radiusX * 0.087, 22, 50)
        const baseHeight = baseWidth * 1.45
        const geometryKey = `${Math.round(radiusX * 10)}:${Math.round(radiusY * 10)}`

        if (geometryOwner && geometryKey !== lastGeometryKey) {
          geometryOwner.style.setProperty('--popular-ring-radius-x', `${radiusX}px`)
          geometryOwner.style.setProperty('--popular-ring-radius-y', `${radiusY}px`)
          geometryOwner.style.setProperty('--popular-wordmark-shift', `${radiusY * -0.1}px`)
          geometryOwner.style.setProperty('--popular-preview-shift', `${radiusY * -0.14}px`)
          lastGeometryKey = geometryKey
        }

        slots.forEach((slot) => {
          const angle = slot.baseAngle + rotation
          const sine = Math.sin(angle)
          const cosine = Math.cos(angle)
          const depth = (sine + 1) / 2
          const perspective = 0.56 + depth * 0.58
          const face = 0.11 + Math.abs(cosine) * 0.89
          const isHot = hovered === slot
          const isDimmed = activeRef.current != null && activeRef.current !== slot.segment.id
          const hotScale = isHot ? 1.24 : 1
          const x = centerX + cosine * radiusX
          const y = centerY + sine * radiusY
          const widthPx = baseWidth * perspective * face * hotScale
          const heightPx = baseHeight * perspective * hotScale
          const alpha = isHot ? 1 : (isDimmed ? 0.14 : 0.34 + depth * 0.66)
          const zIndex = Math.round(depth * 1000) + (isHot ? 2000 : 0)

          ;[slot.placeholder, slot.cover].forEach((sprite) => {
            if (!sprite) return
            sprite.position.set(x, y)
            sprite.width = widthPx
            sprite.height = heightPx
            sprite.rotation = -cosine * 0.018
            sprite.alpha = alpha
            sprite.zIndex = zIndex
          })
          slot.placeholder.visible = !slot.cover
        })

        let positionedLabelCount = 0
        segments.forEach((segment, index) => {
          const label = labelRefs.current[index]
          if (!label) return
          const angle = index * sectorSpan + sectorSpan / 2 - Math.PI + rotation
          const sine = Math.sin(angle)
          const cosine = Math.cos(angle)
          const ringX = centerX + cosine * radiusX
          const ringY = centerY + sine * radiusY

          // 타원 중심에서 단순 방사형으로 밀면 좌우와 대각선에서 긴 라벨의
          // 안쪽 절반이 표지 위로 되돌아온다. 타원의 실제 바깥 법선과 라벨의
          // 측정 크기를 사용해 어떤 각도에서도 라벨 가장자리가 링 밖에 놓이게 한다.
          const normalLength = Math.hypot(cosine / radiusX, sine / radiusY) || 1
          const normalX = (cosine / radiusX) / normalLength
          const normalY = (sine / radiusY) / normalLength
          const labelWidth = label.offsetWidth
          const labelHeight = label.offsetHeight
          const labelHalfExtent = Math.abs(normalX) * labelWidth * 0.5
            + Math.abs(normalY) * labelHeight * 0.5

          // 표지는 아래쪽이 기준점인 스프라이트라서 링 위쪽에서는 높이 전체가
          // 바깥으로 돌출된다. 현재 각도의 표지 외곽까지 포함해 여백을 계산한다.
          const depth = (sine + 1) / 2
          const perspective = 0.56 + depth * 0.58
          const face = 0.11 + Math.abs(cosine) * 0.89
          const coverWidth = baseWidth * perspective * face
          const coverHeight = baseHeight * perspective
          const coverOutset = Math.abs(normalX) * coverWidth * 0.5
            + Math.max(0, -normalY) * coverHeight
          const visualGap = clamp(width * 0.008, 6, 10)
          let offset = labelHalfExtent + coverOutset + visualGap

          // 타원의 곡률 때문에 접선 기준 여백만으로는 라벨 모서리가 아주 조금
          // 안쪽으로 보일 수 있다. 라벨 사각형에서 타원 중심에 가장 가까운 점이
          // 안전선 밖에 놓일 때까지 추가 이동량을 이분 탐색한다.
          const ellipseScoreAt = (candidateOffset: number) => {
            const labelX = ringX + normalX * candidateOffset
            const labelY = ringY + normalY * candidateOffset
            const nearestX = clamp(centerX, labelX - labelWidth * 0.5, labelX + labelWidth * 0.5)
            const nearestY = clamp(centerY, labelY - labelHeight * 0.5, labelY + labelHeight * 0.5)
            return ((nearestX - centerX) / radiusX) ** 2 + ((nearestY - centerY) / radiusY) ** 2
          }
          const targetEllipseScore = 1.025
          if (ellipseScoreAt(offset) < targetEllipseScore) {
            let low = offset
            let high = offset + Math.max(labelWidth, labelHeight)
            for (let pass = 0; pass < 8; pass += 1) {
              const middle = (low + high) * 0.5
              if (ellipseScoreAt(middle) < targetEllipseScore) low = middle
              else high = middle
            }
            offset = high
          }

          const x = ringX + normalX * offset
          const y = ringY + normalY * offset
          const frontness = (sine + 1) / 2
          label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
          label.style.zIndex = String(15 + Math.round(frontness * 10))
          label.style.opacity = activeRef.current && activeRef.current !== segment.id ? '0.28' : String(0.5 + frontness * 0.5)
          positionedLabelCount += 1
        })
        if (!labelsPositioned && positionedLabelCount === segments.length) {
          labelsPositioned = true
          labels?.classList.add('is-ready')
        }
        rotationValueRef.current = rotation
      })
    }

    void setup()
    return () => {
      cancelled = true
      listeners.forEach((remove) => remove())
      const geometryOwner = host.closest<HTMLElement>('.popular-home')
      geometryOwner?.style.removeProperty('--popular-ring-radius-x')
      geometryOwner?.style.removeProperty('--popular-ring-radius-y')
      geometryOwner?.style.removeProperty('--popular-wordmark-shift')
      geometryOwner?.style.removeProperty('--popular-preview-shift')
      labels?.classList.remove('is-ready')
      if (app && initialized) app.destroy(true, { children: true })
    }
  }, [segments, onLoadProgress, onRendererReady])

  useEffect(() => {
    if (!activeSegmentId || segments.length === 0) return
    const index = segments.findIndex((segment) => segment.id === activeSegmentId)
    if (index < 0) return
    const sectorSpan = TAU / segments.length
    const center = index * sectorSpan + sectorSpan / 2 - Math.PI
    const current = rotationValueRef.current
    snapTargetRef.current = current + shortestAngle(Math.PI / 2 - center - current)
  }, [activeSegmentId, segments])

  const snapToSegment = (segmentId: string) => {
    const index = segments.findIndex((segment) => segment.id === segmentId)
    if (index < 0) return
    activeChangeRef.current(activeRef.current === segmentId ? null : segmentId)
    const sectorSpan = TAU / segments.length
    const center = index * sectorSpan + sectorSpan / 2 - Math.PI
    const current = rotationValueRef.current
    snapTargetRef.current = current + shortestAngle(Math.PI / 2 - center - current)
  }

  return (
    <div ref={hostRef} className="popular-ring__webgl" role="listbox" aria-label="연령대와 성별 인기도서 링" tabIndex={0}>
      <div ref={labelsRef} className="popular-ring__labels" aria-label="인기도서 섹션">
        {segments.map((segment, index) => (
          <button
            key={segment.id}
            ref={(node) => { labelRefs.current[index] = node }}
            type="button"
            className={`popular-ring__label ${activeSegmentId === segment.id ? 'is-active' : ''}`}
            onClick={() => snapToSegment(segment.id)}
            aria-pressed={activeSegmentId === segment.id}
          >
            {segment.label} <sup>({segment.items.length})</sup>
          </button>
        ))}
      </div>
    </div>
  )
}
