export interface DnaBook {
  /** 서버 내부 id — 가챠에서 뽑은 책을 바로 서재에 담을 때 쓴다. 서재에서 온 책에는 없다 */
  bookId?: string
  isbn13: string
  title: string
  author: string
  classNo: string
  coverUrl: string
  rating: number
  finishedAt: string
}
