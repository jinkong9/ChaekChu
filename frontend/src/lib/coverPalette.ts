/** 표지 이미지가 없을 때 쓰는 색 커버 팔레트 — bookId로 고정 배정.
 *  BookCover(2D)와 Book3D(표지·책등)가 같은 색을 써야 해서 별도 모듈로 둔다
 *  (컴포넌트 파일에서 export하면 react-refresh가 깨진다). */
const COLORS = [
  { bg: '#22224a', fg: '#fff8ec' }, { bg: '#ff6b4a', fg: '#fff8ec' }, { bg: '#ffd166', fg: '#22224a' },
  { bg: '#b7d9c8', fg: '#22224a' }, { bg: '#8a84a8', fg: '#fff8ec' }, { bg: '#e8e1cf', fg: '#22224a' },
]

export const coverPalette = (bookId: number) => COLORS[bookId % COLORS.length]
