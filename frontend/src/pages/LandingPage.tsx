import LandingReader from '../features/landing/LandingReader'

/** 비로그인 랜딩.
 *  신규 회원(onboarded=false) → 온보딩, 기존 회원 → 홈으로 자동 분기한다.
 *  확정된 B안(독자 일러스트)을 사용한다.
 */
export default function LandingPage() {
  return <LandingReader />
}
