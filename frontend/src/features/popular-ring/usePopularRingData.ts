import { useQuery } from '@tanstack/react-query'
import type { PopularRingData } from './types'

const DATA_URL = '/data/popular-ring.json'

export function usePopularRingData() {
  return useQuery({
    queryKey: ['popular-ring'],
    queryFn: async () => {
      // 브라우저 캐시는 재사용하되, 데이터 파일이 갱신되면 ETag로 즉시 재검증한다.
      const response = await fetch(DATA_URL, { cache: 'no-cache' })
      if (!response.ok) throw new Error('인기도서 데이터를 불러오지 못했습니다.')
      return response.json() as Promise<PopularRingData>
    },
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  })
}
