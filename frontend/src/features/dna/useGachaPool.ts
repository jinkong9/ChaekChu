/** 완전 랜덤 책 가챠의 후보 풀.
 *
 *  다른 두 콘텐츠(월드컵·사주)는 내 서재에서 고르지만, 가챠는 이름 그대로 "완전 랜덤 책 뽑기"다 —
 *  내가 이미 가진 책 안에서 뽑으면 그건 랜덤이 아니라 서재 섞기일 뿐이다. 그래서 책 전체에서 뽑는다.
 *
 *  출처는 홈 인기 링과 같다(GET /books/popular-segments · 실패하면 정적 스냅샷).
 *  그 응답만이 표지와 KDC 분류를 함께 들고 있어서, 뽑힌 책이 내 취향의 어디쯤인지까지 말할 수 있다. */
import { useMemo } from 'react'
import { usePopularRingData } from '../popular-ring/usePopularRingData'
import type { DnaBook } from './dnaTypes'

/** 정보나루 저자 표기는 역할어를 달고 온다("이해인 지음", "루리 글·그림").
 *  서재 책은 백엔드가 authors[] 로 정리해 주지만 이 출처는 원문 그대로라 여기서 한 번 턴다. */
function cleanAuthor(raw: string): string {
  return raw.replace(/^글쓴이\s*[:：]\s*/, '').split(/\s*(지음|엮음|옮김|저|글·그림|글|그림|·|;|,)\s*/)[0].trim() || raw
}

export function useGachaPool(): DnaBook[] {
  const { data } = usePopularRingData()
  return useMemo(() => {
    if (!data) return []
    // 세그먼트마다 같은 책이 겹친다 — 한 번씩만 두어야 어느 책이든 뽑힐 확률이 같다
    const seen = new Set<string>()
    const pool: DnaBook[] = []
    for (const segment of data.segments)
      for (const book of segment.items) {
        // 표지를 돌려 보여 주는 연출이라 표지 없는 책은 후보에서 뺀다
        if (!book.coverUrl || seen.has(book.isbn13)) continue
        seen.add(book.isbn13)
        pool.push({
          isbn13: book.isbn13,
          title: book.title,
          author: cleanAuthor(book.author),
          classNo: book.classNo || '000',
          coverUrl: book.coverUrl,
          // 가챠는 평점·완독일을 쓰지 않는다 — 내 기록이 없는 책들이다
          rating: 0,
          finishedAt: '',
        })
      }
    return pool
  }, [data])
}
