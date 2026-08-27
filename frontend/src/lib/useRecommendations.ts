import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { RecommendationResponse } from '../api/types'

/** 추천 덱 조회 — 홈·이유·기준조절 화면이 같은 캐시를 공유 */
export function useRecommendations() {
  return useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => (await api.get<RecommendationResponse>('/recommendations')).data,
    staleTime: 5 * 60_000,
  })
}
