import { useQuery } from '@tanstack/react-query'
import { fetchMyDna } from '../api/dna'

/** 로그인 사용자의 실제 서재 기반 Book DNA. profile은 FastAPI가 계산한 값을 그대로 사용한다. */
export function useDna() {
  return useQuery({
    queryKey: ['dna', 'me'],
    queryFn: fetchMyDna,
    staleTime: 60_000,
  })
}
