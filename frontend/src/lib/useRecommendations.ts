import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { api } from '../api/client'
import type { RecommendationResponse } from '../api/types'

/** 추천 화면이 한 번에 보여 줄 권수. 서버 덱은 이보다 두껍게 오지만 추천 화면은 여기까지만 편다.
 *  훅이 아니라 상수로 두는 이유: 궤도 홈은 같은 덱으로 링을 표지로 채워야 해서 전체가 필요하다. */
export const RECOMMEND_DECK_SIZE = 5

/** 서버가 받는 관심 태그 상한 (§5.1) */
export const MAX_RECOMMEND_TAGS = 5

/** GET /recommendations?tags= (§5.1) — tags 는 반복 파라미터(`tags=#소설&tags=#신간`)라 axios 의 `tags[]=` 직렬화를 끈다.
 *  없으면 서버가 온보딩 관심 태그를 쓰고, 그것도 없으면 연령·성별 인기 콜드스타트로 대체한다. */
async function fetchRecommendations(tags: string[]): Promise<RecommendationResponse> {
  const params = tags.length > 0 ? { tags: tags.slice(0, MAX_RECOMMEND_TAGS) } : undefined
  const res = await api.get<RecommendationResponse>('/recommendations', { params, paramsSerializer: { indexes: null } })
  return res.data
}

/** POST /recommendations/next (§5.2) — 「다시 추천받기」 전용. 기준 덱의 태그·가중치는 서버가 스냅샷에서 복원하므로
 *  프론트는 지금 보고 있는 recommendationId 만 넘긴다. 서버가 기준 덱·최근 같은 조건 덱 3개·서재를 제외해 새 덱을 만든다.
 *  후보가 모자라면 요청한 size 보다 적게 올 수 있고, 아예 없으면 빈 items 다 — 화면이 그 둘을 다르게 말해야 한다. */
export async function fetchNextRecommendations(recommendationId: string, size = RECOMMEND_DECK_SIZE): Promise<RecommendationResponse> {
  const res = await api.post<RecommendationResponse>('/recommendations/next', { recommendationId, size })
  return res.data
}

/** 추천 덱 조회 — 홈·이유·기준조절 화면이 같은 캐시를 공유한다. 태그가 바뀌면 새 스냅샷(새 recommendationId).
 *  서버 사전에 없는 태그로 400 이 오면 태그 없이 한 번 더 받아 덱이 비지 않게 한다 — THEME·SIGNAL 태그는 사전에 아직 없다. */
export function useRecommendations(tags: string[] = []) {
  return useQuery({
    queryKey: ['recommendations', tags],
    queryFn: async () => {
      try {
        return await fetchRecommendations(tags)
      } catch (err) {
        if (tags.length > 0 && isAxiosError(err) && err.response?.status === 400) {
          console.warn('[recommendations] 서버가 태그를 받지 않아 태그 없이 다시 요청합니다.', err.response.data)
          return fetchRecommendations([])
        }
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })
}
