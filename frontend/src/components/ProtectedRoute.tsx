import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '../stores/authStore'

/** 로그인 필수 라우트. 토큰이 없으면 랜딩으로 보낸다.
 *
 *  stage 는 이 라우트가 온보딩의 어느 쪽인지 말한다. 한쪽만 막으면 주소창으로 건너뛰는 길이 남아 양방향으로 막는다.
 *    'onboarded' (기본) 온보딩을 마친 사람만 — 아직이면 온보딩으로.
 *    'pending'          아직 안 마친 사람만 — 이미 마쳤으면 홈으로. 마친 사람이 /onboarding 을 직접 쳐서 취향 설정을
 *                       처음부터 다시 밟는 걸 막는다(09-23). 다시 하고 싶으면 /tune 이 정식 경로다.
 *  온보딩 화면까지 이 컴포넌트로 감싸는 이유는 그대로다(§9-12: 프로필·취향 POST 가 토큰 없이 나가지 않게). */
export default function ProtectedRoute({ stage = 'onboarded' }: { stage?: 'onboarded' | 'pending' }) {
  const { accessToken, onboarded } = useAuthStore()
  if (!accessToken) return <Navigate to="/" replace />
  if (stage === 'onboarded' && !onboarded) return <Navigate to="/onboarding" replace />
  if (stage === 'pending' && onboarded) return <Navigate to="/home" replace />
  return <Outlet />
}
