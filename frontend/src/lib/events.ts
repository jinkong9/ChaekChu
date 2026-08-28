import { api } from '../api/client'

/** 계약 event_type enum 축소판 — IMPRESSION/CLICK + WISH(찜) 추가 제안 (팀 확정 대기).
 *  폐기로 확정되면 이 파일과 호출부만 지우면 된다. */
export type EventType = 'IMPRESSION' | 'CLICK' | 'WISH'

interface EventPayload {
  bookId?: number
  recommendationId?: string
  rank?: number
}

/** 행동 이벤트 전송 — 실패해도 사용자 흐름을 막지 않는다 (fire-and-forget) */
export function trackEvent(eventType: EventType, payload: EventPayload = {}) {
  api.post('/events', { eventType, ...payload, occurredAt: new Date().toISOString() }).catch(() => {})
}
