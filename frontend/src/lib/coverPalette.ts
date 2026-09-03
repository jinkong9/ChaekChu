/** 표지 이미지가 없을 때 쓰는 자리색.
 *  BookCover(2D)와 Book3D(표지·책등), 우표(Stamp)가 같은 색을 써야 해서 별도 모듈로 둔다
 *  (컴포넌트 파일에서 export하면 react-refresh가 깨진다).
 *
 *  옛 테마 C는 bookId로 네이비·코랄·노랑을 돌려 배정했지만, Editorial Orbit에서는
 *  색을 실제 표지만 담당한다 — 표지가 없는 자리는 DESIGN.md의 placeholder 한 색으로 비워 두고
 *  구분은 제목·순위 같은 텍스트가 맡는다. */
const PLACEHOLDER = { bg: '#e9e9e5', fg: 'rgba(11, 11, 11, 0.56)' }

/** bookId는 더 이상 색을 가르지 않는다. 호출부를 그대로 두려고 시그니처만 남긴다. */
export function coverPalette(bookId: number) {
  void bookId
  return PLACEHOLDER
}
