import { api } from '../api/client'

/** 추천·도서 행동 이벤트 — WISH는 서재 찜 등록을 뜻한다. */
export type EventType = 'IMPRESSION' | 'CLICK' | 'WISH' | 'BOOK_VIEW'

interface EventPayload {
  bookId?: number
  recommendationId?: string
  rank?: number
}

/** 행동 이벤트 전송 — 실패해도 사용자 흐름을 막지 않는다 (fire-and-forget) */
export function trackEvent(eventType: EventType, payload: EventPayload = {}) {
  api.post('/events', { eventType, ...payload, occurredAt: new Date().toISOString() }).catch(() => {})
}
