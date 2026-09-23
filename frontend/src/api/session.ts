import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

/** API_SPEC §2.3·§2.4 — 세션 갱신·종료. 인증은 Bearer 가 아니라 HttpOnly 쿠키 `refresh_token` 이다.
 *
 *  `api`(client.ts) 를 쓰지 않고 인터셉터 없는 인스턴스를 따로 두는 이유: 갱신 요청 자체가 401 을 받았을 때
 *  다시 갱신을 부르는 고리를 만들지 않기 위해서다. 쿠키가 실리도록 withCredentials 만 켠다. */
const bare = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  withCredentials: true,
})

interface TokenResponse {
  accessToken: string
  expiresInSeconds: number
}

let inflight: Promise<string | null> | null = null

/** POST /auth/refresh — **한 번에 하나만**. 탭 안에서 401 이 동시에 여러 개 와도 갱신은 한 번 나가고 모두 그 결과를 기다린다.
 *  (서버는 회전 뒤 10초 유예를 두지만, 같은 탭에서 두 번 보내면 그만큼 쿠키 회전이 낭비된다.)
 *  성공하면 새 액세스 토큰을 스토어(메모리)에 넣고 돌려준다. 401(쿠키 없음·만료·폐기·재사용 감지)이나 네트워크 오류면 null. */
export function refreshSession(): Promise<string | null> {
  if (!inflight) {
    inflight = bare
      .post<TokenResponse>('/auth/refresh')
      .then((res) => {
        useAuthStore.getState().setAccessToken(res.data.accessToken)
        return res.data.accessToken
      })
      .catch(() => null)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** POST /auth/logout — 서버가 이 로그인 계열의 리프레시 토큰을 폐기하고 쿠키를 지운다.
 *  실패(네트워크 끊김 등)해도 클라이언트 로그아웃은 진행한다 — 쿠키는 14일 뒤 스스로 만료된다. */
export async function logoutSession(): Promise<void> {
  try {
    await bare.post('/auth/logout')
  } catch {
    /* 서버에 못 닿아도 클라이언트 쪽은 지운다 */
  }
}
