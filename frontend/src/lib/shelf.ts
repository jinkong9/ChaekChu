import type { ShelfStatus } from '../api/types'

/** 서재에 담는 세 갈래. 추천 세 시안이 같은 순서·같은 말로 보여 주도록 여기 한 곳에 둔다.
 *  순서가 곧 읽기 흐름(찜 → 읽는 중 → 읽음)이라 임의로 바꾸지 않는다.
 *  첫 갈래(찜하기)만 채운 버튼 — 아직 안 읽은 책을 권하는 화면에서 가장 흔한 선택이다. */
export const SHELF_ACTIONS: { status: ShelfStatus; label: string }[] = [
  { status: 'WISH', label: '찜하기' },
  { status: 'READING', label: '읽는 중' },
  { status: 'READ', label: '읽음' },
]
