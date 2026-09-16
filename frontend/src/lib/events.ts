import { api } from '../api/client'

/** 행동 이벤트 종류 (API_SPEC §7.1). WISH 는 서재 찜 등록, DISMISS 는 카드를 넘기거나 다른 책으로 바꿔 꺼낸 것 — 하나뿐인 부정 신호.
 *  SEARCH · REASON_VIEW 는 타입만 열어 둔다 — 검색 화면·추천 이유 화면에서 붙일 때 payload 만 채우면 된다. */
export type EventType = 'IMPRESSION' | 'CLICK' | 'WISH' | 'BOOK_VIEW' | 'DISMISS' | 'SEARCH' | 'REASON_VIEW'

/** 이벤트가 난 화면 — 「검색 → 상세 → 찜」처럼 흐름을 이어 볼 수 있게 한다 */
export type EventContext = 'HOME' | 'RECOMMEND' | 'SEARCH' | 'DETAIL' | 'LIBRARY' | 'TUNE' | 'DNA' | 'OTHER'

export interface EventPayload {
  /** 내부 id 와 13자리 ISBN13 을 모두 받는다 — 홈 링은 isbn13 으로 이동한다 */
  bookId?: string | number
  recommendationId?: string
  /** 서버가 매긴 순위 */
  rank?: number
  /** 화면에서 실제로 보인 자리(0부터). rank 와 다르다 — 덱을 재정렬해 편 뒤의 위치라 위치 편향 보정에 쓴다 */
  position?: number
  /** 어느 화면에서 난 일인지. 안 주면 현재 경로에서 추론한다 */
  context?: EventContext
  /** BOOK_VIEW 체류 시간(ms) */
  dwellMs?: number
  /** SEARCH */
  query?: string
  resultCount?: number
}

/** 방문 1회 = 탭 하나. 탭을 닫으면 새 방문이다. sessionStorage 가 막힌 환경(Safari 프라이빗 등)이면 메모리로 버틴다 */
let memorySessionId: string | null = null
function sessionId(): string {
  try {
    const saved = sessionStorage.getItem('eventSession')
    if (saved) return saved
    const fresh = crypto.randomUUID()
    sessionStorage.setItem('eventSession', fresh)
    return fresh
  } catch {
    memorySessionId ??= crypto.randomUUID()
    return memorySessionId
  }
}

/** 경로 → 화면. 호출처가 context 를 안 넘겼을 때만 쓴다 */
function contextFromPath(): EventContext {
  const p = window.location.pathname
  if (p === '/home' || p === '/') return 'HOME'
  if (p.startsWith('/recommend')) return 'RECOMMEND'
  if (p.startsWith('/search')) return 'SEARCH'
  if (p.startsWith('/books/')) return 'DETAIL'
  if (p.startsWith('/library')) return 'LIBRARY'
  if (p.startsWith('/tune')) return 'TUNE'
  if (p.startsWith('/dna')) return 'DNA'
  return 'OTHER'
}

/** 같은 노출을 두 번 보내지 않기 위한 세션 내 기록 — StrictMode 이중 마운트, 뒤로가기 재진입, 히어로 교체 뒤 재렌더가 모두 여기서 걸린다.
 *  키는 덱 + 책. 덱만(bookId 없음) 보내는 노출은 덱 id 하나가 키다 */
const impressed = new Set<string>()

/** 행동 이벤트 전송 — 실패해도 사용자 흐름을 막지 않는다 (fire-and-forget).
 *  서버(§7.1)는 언제나 202 를 주고, 조건이 안 맞는 이벤트는 저장하지 않고 버린다.
 *  clientEventId 는 호출마다 새로 만든다 — 서버가 (userId, clientEventId) 로 중복을 걸러낸다. */
export function trackEvent(eventType: EventType, payload: EventPayload = {}) {
  if (eventType === 'IMPRESSION') {
    const key = `${payload.recommendationId ?? ''}:${payload.bookId ?? ''}`
    if (impressed.has(key)) return
    impressed.add(key)
  }
  api.post('/events', {
    eventType,
    ...payload,
    context: payload.context ?? contextFromPath(),
    sessionId: sessionId(),
    clientEventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  }).catch(() => {})
}
