/** 가챠·월드컵 결과의 표지 — 상세로 가는 문.
 *
 *  결과 화면에서 책을 보고 나면 다음 걸음은 둘이다: 서재에 담기(ShelfActions), 더 알아보기(여기).
 *  표지에 올리면 왼쪽 등을 축으로 살짝 열리고, 누르면 상세로 간다. 열리는 연출은 "이건 눌리는 것"이라는
 *  말을 글자 없이 하는 것이고, 아래 「상세 보기」는 그 말을 글자로 한 번 더 하는 것이다(모바일은 hover 가 없어 늘 보인다).
 *
 *  `?play=` 가 주소에 있어 상세에서 뒤로 오면 이 대화상자가 다시 열린다 — 닫고 갈 필요가 없다. */
import { Link } from 'react-router'
import type { DnaBook } from './dnaTypes'
import { coverAtWidth } from '../../lib/coverUrl'

export default function ResultCover({
  book,
  width,
  className,
}: {
  book: DnaBook
  /** 표지 요청 폭(px) — 그리는 폭과 같게 */
  width: number
  className?: string
}) {
  const src = coverAtWidth(book.coverUrl, width) ?? book.coverUrl
  // 상세로 갈 id 가 없으면(이론상 없지만) 링크 대신 그림만 — 눌러도 아무 데도 안 가는 링크를 두지 않는다
  if (!book.bookId) {
    return (
      <span className={`dnar-cover ${className ?? ''}`}>
        <img className="dnar-cover__img" src={src} alt={`${book.title} 표지`} width={width} decoding="async" />
      </span>
    )
  }
  return (
    <Link to={`/books/${book.bookId}`} className={`dnar-cover dnar-cover--link ${className ?? ''}`}
      aria-label={`${book.title} 상세 보기`}>
      <span className="dnar-cover__book">
        <img className="dnar-cover__img" src={src} alt="" width={width} decoding="async" />
      </span>
      <span className="dnar-cover__hint" aria-hidden="true">상세 보기 →</span>
    </Link>
  )
}
