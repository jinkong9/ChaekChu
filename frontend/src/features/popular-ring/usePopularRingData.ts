import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { adaptPopularSegments, type ServerPopularSegmentsResponse } from './adaptPopularSegments'
import type { PopularRingData } from './types'

/** 서버가 비어 있거나(미적재 · 장애) 실패했을 때 쓰는 09-02 스냅샷. 홈이 비어 보이는 일은 없어야 한다. */
const FALLBACK_URL = '/data/popular-ring.json'

async function fetchFallback(): Promise<PopularRingData> {
  // 브라우저 캐시는 재사용하되, 데이터 파일이 갱신되면 ETag로 즉시 재검증한다.
  const response = await fetch(FALLBACK_URL, { cache: 'no-cache' })
  if (!response.ok) throw new Error('인기도서 데이터를 불러오지 못했습니다.')
  return response.json() as Promise<PopularRingData>
}

/** 홈 인기 링 — GET /books/popular-segments (§4.3). 월 1회 적재라 오래 캐시한다.
 *  segments 가 비면(book_loaned_top20 미적재) 정적 스냅샷으로 폴백 — 데이터 파트 일정에 화면이 묶이지 않게. */
export function usePopularRingData() {
  return useQuery({
    queryKey: ['popular-ring'],
    queryFn: async () => {
      try {
        const res = await api.get<ServerPopularSegmentsResponse>('/books/popular-segments')
        if (res.data.segments.length > 0) return adaptPopularSegments(res.data)
        console.warn('[popular-ring] 서버 세그먼트가 비어 있어 정적 스냅샷으로 대체합니다.')
      } catch (e) {
        console.warn('[popular-ring] API 실패 — 정적 스냅샷으로 대체합니다.', e)
      }
      return fetchFallback()
    },
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  })
}
