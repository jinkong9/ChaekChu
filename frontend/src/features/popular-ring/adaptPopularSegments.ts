import type { ServerBookSummary } from '../../api/types'
import type { PopularBook, PopularRingData, PopularSegment } from './types'

/** GET /books/popular-segments 서버 응답 (API_SPEC §4.3) */
export interface ServerPopularSegmentsResponse {
  generatedAt: string | null
  period: { startDate: string; endDate: string } | null
  segments: {
    id: string            // "20_F"
    label: string         // "20대 여성"
    age: string           // "20" (60 = 60대 이상)
    gender: 'M' | 'F'
    items: { ranking: number; loanCount: number; book: ServerBookSummary; coverLargeUrl: string | null }[]
  }[]
}

const GENDER_LABEL = { M: '남', F: '여' } as const

/** 서버 응답 → 홈 링 화면 타입. 화면·캔버스는 정적 JSON 시절 타입을 그대로 쓰므로 여기서만 모양을 맞춘다.
 *  차이(§9-8): gender M/F → 남/여, publicationYear 숫자 → 문자열, 책 필드가 BookSummary 로 묶여 옴.
 *  표지가 원격 URL 이라 WebGL 텍스처(CORS)가 막히면 coverUrl 한 줄만 프록시 경로로 바꾸면 되도록 여기 모아 둔다. */
export function adaptPopularSegments(res: ServerPopularSegmentsResponse): PopularRingData {
  const startDate = res.period?.startDate ?? ''
  const endDate = res.period?.endDate ?? ''

  const segments: PopularSegment[] = res.segments.map((s) => ({
    id: s.id,
    label: s.label,
    gender: GENDER_LABEL[s.gender],
    age: s.age === '60' ? '60대 이상' : `${s.age}대`,
    startDate,
    endDate,
    items: s.items.map((it): PopularBook => ({
      // 정적 JSON 의 id 규칙("isbn-성별-연령-순위")을 유지 — 화면이 슬롯 key 로 쓴다
      id: `${it.book.isbn13 ?? it.book.bookId}-${s.gender}-${s.age}-${it.ranking}`,
      ranking: it.ranking,
      title: it.book.title,
      author: it.book.authors.join(' · '),
      publisher: it.book.publisher ?? '',
      publicationYear: it.book.publicationYear != null ? String(it.book.publicationYear) : '',
      // 홈 링은 /books/{isbn13} 으로 이동한다(§4.4 서버가 13자리는 ISBN 으로 해석). ISBN 이 없으면 내부 id 로.
      isbn13: it.book.isbn13 ?? it.book.bookId,
      loanCount: it.loanCount,
      classNo: it.book.classNo ?? '',
      coverUrl: it.book.coverUrl,
      coverLargeUrl: it.coverLargeUrl ?? it.book.coverUrl,
    })),
  }))

  return {
    generatedAt: res.generatedAt ?? '',
    source: 'GET /books/popular-segments',
    segmentCount: segments.length,
    itemCount: segments.reduce((n, s) => n + s.items.length, 0),
    segments,
  }
}
