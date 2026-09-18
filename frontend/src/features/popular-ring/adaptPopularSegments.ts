import type { ServerBookSummary } from '../../api/types'
import { coverAtWidth } from '../../lib/coverUrl'
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

/** https 로 승격 — DB 표지 일부가 http 라 https 페이지에서 fetch 가 Mixed Content 로 막힌다. 세 CDN 모두 https 를 지원한다 */
const toHttps = (url: string | null) => (url ? url.replace(/^http:\/\//, 'https://') : null)

/** 네이버 책 썸네일 CDN 은 CORS 헤더를 주지 않아 WebGL 텍스처(캔버스 링)로 쓸 수 없다. 알라딘·카카오는 된다(운영 확인 9/11) */
const isNaverCover = (url: string | null) => !!url && url.includes('pstatic.net')

/** 네이버 표지를 같은 origin 으로 받는 nginx 프록시 경로(deploy/web/nginx/snippets/app.conf). 로컬 dev 는 vite.config.ts 가 같은 경로를 넘겨 준다 */
const NAVER_COVER_PROXY = '/covers/naver/'

/** 링 표지가 실제로 그려지는 최대 CSS 폭(px) — 캔버스는 URL 을 그대로 텍스처로 올리므로 여기서 판을 줄여 준다 */
const RING_COVER_W = 160

/** 캔버스 링에 넣을 표지 — 네이버면 알라딘 큰 판을 링 크기로 줄여 대체하고, 대체가 없으면 호스트만 프록시 경로로 바꿔 같은 origin 에서 받는다(09-18).
 *  <img> 로 그리는 미리보기·그리드는 CORS 와 무관해 원본 URL(coverLargeUrl)을 그대로 쓴다. */
const canvasCover = (cover: string | null, large: string | null) =>
  isNaverCover(cover) && large && !isNaverCover(large)
    ? coverAtWidth(large, RING_COVER_W)
    : (cover?.replace(/^https:\/\/bookthumb-phinf\.pstatic\.net\//, NAVER_COVER_PROXY) ?? null)

/** 서버 응답 → 홈 링 화면 타입. 화면·캔버스는 정적 JSON 시절 타입을 그대로 쓰므로 여기서만 모양을 맞춘다.
 *  차이(§9-8): gender M/F → 남/여, publicationYear 숫자 → 문자열, 책 필드가 BookSummary 로 묶여 옴.
 *  네이버 표지의 프록시 경로 치환(canvasCover)도 여기서만 한다 — 캔버스 밖(<img>)은 원본 URL 을 쓴다. */
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
      coverUrl: canvasCover(toHttps(it.book.coverUrl), toHttps(it.coverLargeUrl)),
      coverLargeUrl: toHttps(it.coverLargeUrl ?? it.book.coverUrl),
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
