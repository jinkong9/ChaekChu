/** 가챠 한 권 뽑기.
 *
 *  서버가 가챠 전용 엔드포인트를 준다(GET /books/random, API_SPEC §4.8) — 표지와 KDC 가 있는
 *  추천 후보 약 44만 권 중 무작위 한 권. 검색을 창구로 쓰던 예전 방식(나라별 KDC 를 골라
 *  묶음을 받아 그 안에서 굴리기)은 탐색 한도 10,000건에 갇히고 요청도 두 번이었다. 이제 한 번이다.
 *
 *  화면이 더 하는 일은 둘뿐이다 — 직전 책을 빼 달라고 서버에 알리고(exclude),
 *  이미 읽은 책이 나오면 다시 뽑는다. 다 읽은 책을 뽑아 놓고 "새 영역"이라 말하면 우스워진다. */
import { fetchRandomBook } from '../../api/books'
import type { ServerBookSummary } from '../../api/types'
import type { DnaBook } from './dnaTypes'

/** 이미 읽은 책이 걸렸을 때 다시 뽑는 횟수. 서재가 아무리 커도 후보 44만에 비하면 티끌이라
 *  두 번이면 충분하고, 그래도 걸리면 그냥 보여 준다 — 뽑기가 멈추는 것보다는 낫다. */
const RETRY_ON_READ = 2

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
    // 서버가 KDC 있는 책만 주지만(§4.8), 타입은 null 을 허용하므로 축 판정이 깨지지 않게 막아 둔다
    classNo: b.classNo || '000',
    coverUrl: b.coverUrl ?? '',
    // 가챠는 평점·완독일을 쓰지 않는다 — 내 기록이 없는 책들이다
    rating: 0,
    finishedAt: '',
  }
}

/**
 * @param exclude 직전에 뽑힌 bookId
 * @param read    이미 읽은 책의 ISBN — 걸리면 다시 뽑는다
 */
export async function drawRandomBook(exclude: string | undefined, read: ReadonlySet<string>): Promise<DnaBook> {
  let last = exclude
  for (let i = 0; i <= RETRY_ON_READ; i++) {
    const book = toDnaBook(await fetchRandomBook(last))
    if (!read.has(book.isbn13)) return book
    last = book.bookId
  }
  return toDnaBook(await fetchRandomBook(last))
}
