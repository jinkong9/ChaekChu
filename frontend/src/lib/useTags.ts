import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { TagItem } from '../api/types'

/** GET /tags?kind= — 태그 사전(DB tags 테이블이 단일 원천). 온보딩 장르 칩·기준 조절 칩·추천 태그 표시가 같은 캐시를 쓴다.
 *  고정 표라 세션 동안 다시 묻지 않는다. 지금 서버 사전은 GENRE 12개뿐이다(§10-0). */
export function useTags(kind: TagItem['kind'] = 'GENRE') {
  return useQuery({
    queryKey: ['tags', kind],
    queryFn: async () => (await api.get<{ items: TagItem[] }>('/tags', { params: { kind } })).data.items,
    staleTime: Infinity,
  })
}

/** 서버가 준 태그 값 → 화면 라벨('#소설').
 *  추천 응답의 `appliedTags`·`items[].tags` 는 코드(`FIC`, `SCIENCE`)로 오고, 기준 조절은 라벨(`#소설`)로 보낸다 —
 *  둘을 사전으로 이어 준다. 사전에 없는 값(THEME·SIGNAL 등 아직 코드만 있는 태그)은 `#` 만 붙여 그대로 보여 준다. */
export function tagLabel(value: string, tags: readonly TagItem[] | undefined): string {
  const hit = tags?.find((t) => t.code === value || t.label === value)
  if (hit) return hit.label
  return value.startsWith('#') ? value : `#${value}`
}
