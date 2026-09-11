import { create } from 'zustand'

/** 기준 조절(해시태그) 상태 — 추천 화면이 `GET /recommendations?tags=` 의 tags 로 보낸다(§5.1). 세션 메모리에만 둔다 */
interface TuneState {
  tags: string[]
  setTags: (tags: string[]) => void
}

export const useTuneStore = create<TuneState>()((set) => ({
  tags: [],
  setTags: (tags) => set({ tags }),
}))
