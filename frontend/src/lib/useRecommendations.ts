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

/** 비회원 추천 — 요청 태그와 서버 기본 가중치만 사용하며 로그인 추천과 캐시를 분리한다. */
export function useAnonymousRecommendations(tags: string[]) {
  return useQuery({
    queryKey: ['recommendations', 'anonymous', tags],
    queryFn: async () => (await api.get<RecommendationResponse>('/recommendations/anonymous', { params: { tags } })).data,
    staleTime: 5 * 60_000,
  })
}
