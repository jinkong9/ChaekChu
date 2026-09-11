import { create } from 'zustand'

/** 완독 모달 호출 대상 — libraryItemId 가 있으면 기존 항목 수정(PATCH), 없으면 신규 등록(POST → 409 폴백 → PATCH).
 *  id 는 서버가 문자열, 화면 타입은 아직 number 라 둘 다 받는다 (string id rename MR 에서 string 으로 좁힌다). */
export interface FinishTarget {
  bookId: string | number
  title: string
  libraryItemId?: string | number
  rating?: number | null
  reviewText?: string | null
  /** null = 완독일 없음(서비스 이전에 읽은 책) · undefined = 신규(오늘로 초기화) */
  finishedDate?: string | null
}

interface FinishModalState {
  target: FinishTarget | null
  open: (t: FinishTarget) => void
  close: () => void
}

/** 완독 기록 모달 전역 상태 — 상세·서재·찜 어디서든 READ 전환은 이 스토어를 거친다.
 *  모달 본체(FinishReadModal)는 Layout 에 한 번만 마운트된다. */
export const useFinishModalStore = create<FinishModalState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
