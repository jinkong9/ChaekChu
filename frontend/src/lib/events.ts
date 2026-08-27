import { api } from '../api/client'

type EventName =
  | 'recommendation_impression'
  | 'recommendation_click'
  | 'recommendation_reason_view'
  | 'preset_select'
  | 'weight_apply'
  | 'not_interested'
  | 'book_save'
  | 'reading_feedback'

interface EventPayload {
  bookId?: number
  recommendationId?: string
  rank?: number
  reasonType?: string
  status?: string
  rating?: number
  preset?: string
}

/** 행동 이벤트 전송 — 실패해도 사용자 흐름을 막지 않는다 (fire-and-forget) */
export function trackEvent(event: EventName, payload: EventPayload = {}) {
  api.post('/events', { event, ...payload, ts: new Date().toISOString() }).catch(() => {})
}
