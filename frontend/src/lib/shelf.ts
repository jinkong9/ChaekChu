import type { ShelfStatus } from '../api/types'

/** 추천 화면에서 서재로 담는 갈래. 세 시안이 같은 순서·같은 말로 보여 주도록 여기 한 곳에 둔다.
 *  '읽는 중'은 빼 두었다 — 추천은 아직 안 읽은 책을 권하는 자리라 그 상태를 여기서 고를 일이 드물고,
 *  읽기 시작한 뒤에는 도서 상세나 서재에서 바꾸는 게 자연스럽다.
 *  첫 갈래(찜하기)만 채운 버튼 — 이 화면에서 가장 흔한 선택이다. */
export const SHELF_ACTIONS: { status: ShelfStatus; label: string }[] = [
  { status: 'WISH', label: '찜하기' },
  { status: 'READ', label: '읽음' },
]
