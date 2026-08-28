import { create } from 'zustand'

/** 기준 조절(해시태그) 상태 — 적용 시 홈의 덱 재정렬에 사용.
 *  서버 반영(POST /recommendations/tags)은 계약 확정 후 연결 */
interface TuneState {
  tags: string[]
  setTags: (tags: string[]) => void
}

export const useTuneStore = create<TuneState>()((set) => ({
  tags: [],
  setTags: (tags) => set({ tags }),
}))
