/** 완전 랜덤 책 가챠의 후보 — 소설 전체.
 *
 *  다른 콘텐츠(월드컵)는 내 서재에서 고르지만, 가챠는 이름 그대로 "완전 랜덤 책 뽑기"다.
 *  내가 가진 책 안에서 뽑으면 랜덤이 아니라 서재 섞기고, 인기 대출 상위권에서만 뽑으면
 *  장르는 벗어나도 유명한 책 안에서만 벗어난다. 그래서 검색을 후보 창구로 쓴다 —
 *  `GET /books/search?kdc=` 는 누적 대출순으로 페이지를 주므로, 뒤 페이지로 갈수록
 *  덜 읽힌 책이 나온다. 그게 이 콘텐츠가 노리는 자리다.
 *
 *  나라를 먼저 고르고 그 안에서 한 묶음을 집는다. 한 코드로만 뽑으면 한국소설만 쏟아진다.
 *  이미 읽은 책은 후보에서 뺀다 — 다 읽은 책을 뽑아 놓고 "새 영역"이라 말하면 우스워진다. */
import { useQuery } from '@tanstack/react-query'
import { searchBooksRaw } from '../../api/books'
import type { ServerBookSummary } from '../../api/types'
import type { DnaBook } from './dnaTypes'

/** KDC 의 소설 — 둘째 자리가 나라, 셋째 자리 3 이 소설이다(813 한국 · 833 일본 · 843 영미 …) */
const FICTION_KDC = ['813', '823', '833', '843', '853', '863', '873', '883', '893']
/** 고른 나라가 비었을 때 돌아갈 자리 — 카탈로그가 가장 두껍다 */
const FALLBACK_KDC = '813'
/** 한 번에 받아 오는 묶음 크기 — 검색 size 상한이 50 이다 */
const WINDOW = 50
/** 서버 탐색 한도 10,000건(page*size+size) 안에서만 페이지를 고른다 */
const MAX_PAGE = Math.floor(10_000 / WINDOW) - 1

const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)]

/** 정보나루 저자 표기는 역할어를 달고 온다("이해인 지음"). 서버 authors[] 도 원문을 그대로 나눠 담아 여기서 한 번 턴다. */
function cleanAuthor(raw: string): string {
  return raw.replace(/^글쓴이\s*[:：]\s*/, '').split(/\s*(지음|엮음|옮김|저|글·그림|글|그림|·|;|,)\s*/)[0].trim() || raw
}

function toDnaBook(b: ServerBookSummary): DnaBook {
  return {
    bookId: b.bookId,
    isbn13: b.isbn13 ?? b.bookId,
    title: b.title,
    author: b.authors.length > 0 ? cleanAuthor(b.authors[0]) : '',
    classNo: b.classNo || '813',
    coverUrl: b.coverUrl ?? '',
    // 가챠는 평점·완독일을 쓰지 않는다 — 내 기록이 없는 책들이다
    rating: 0,
    finishedAt: '',
  }
}

export interface GachaWindow {
  /** 이번에 집어 온 묶음 (표지가 있는 것만) */
  books: DnaBook[]
  /** 그 나라 소설의 전체 권수 — 화면에 "소설 N권 가운데"로 적는다 */
  total: number
}

/** 한 나라의 소설에서 묶음 하나. 이미 읽은 책은 뽑히지 않게 걷어낸다 */
async function windowOf(kdc: string, read: ReadonlySet<string>): Promise<GachaWindow> {
  const head = await searchBooksRaw('', 0, WINDOW, kdc)
  const lastPage = Math.min(MAX_PAGE, Math.floor(Math.max(0, head.total - 1) / WINDOW))
  // 첫 페이지는 베스트셀러다. 뒤가 있으면 뒤에서 집어 와야 '취향 밖'이 된다
  const page = lastPage > 0 ? 1 + Math.floor(Math.random() * lastPage) : 0
  const window = page === 0 ? head : await searchBooksRaw('', page, WINDOW, kdc)
  const items = (window.items.length > 0 ? window.items : head.items)
    .map(toDnaBook)
    .filter((b) => b.coverUrl !== '' && !read.has(b.isbn13))
  return { books: items, total: head.total }
}

/** 소설 한 나라를 고르고, 그 안에서 한 묶음을 집어 온다. 부를 때마다 다른 묶음이다.
 *  고른 나라에 한 권도 없을 수 있다(이탈리아소설·중국소설은 카탈로그가 얇다).
 *  그때 빈손으로 돌아오면 화면은 '꺼내는 중'에 갇히고 손잡이가 잠긴 채로 남는다 —
 *  그래서 카탈로그가 가장 두꺼운 한국소설로 한 번 되돌아간다. */
export async function fetchGachaWindow(read: ReadonlySet<string> = new Set()): Promise<GachaWindow> {
  const first = await windowOf(pick(FICTION_KDC)!, read)
  if (first.books.length > 0) return first
  return windowOf(FALLBACK_KDC, read)
}

/** 유리구를 채울 표지와 "소설 N권" 문구에 쓸 묶음 하나. 뽑을 때는 매번 새 묶음을 부른다.
 *  대화상자를 열 때만 부른다 — 리포트를 볼 때마다 검색을 두 번 때릴 이유가 없다. */
export function useGachaWindow(enabled: boolean, read: ReadonlySet<string>) {
  return useQuery({
    queryKey: ['gacha', 'fiction'],
    queryFn: () => fetchGachaWindow(read),
    enabled,
    // 열 때마다 다른 묶음을 본다. gcTime 0 은 쓰지 않는다 —
    // StrictMode 가 붙였다 떼는 사이에 진행 중이던 요청째로 캐시가 지워져 '꺼내는 중'에서 멈춘다
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  })
}
