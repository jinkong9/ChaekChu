import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../stores/authStore'
import { refreshSession } from './session'

/** 공통 API 클라이언트 — 인증 헤더 자동 첨부 + 만료 시 조용한 갱신 (API_SPEC §1.1·§2.3).
 *  withCredentials: 갱신·로그아웃 쿠키(Path=/api/v1/auth)가 같은 출처에서 오가도록. 다른 경로에는 그 쿠키가 실리지 않는다. */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 한 번 재시도한 요청 표시 — 재시도도 401 이면 그때는 로그아웃이다 */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as RetriableConfig | undefined
    if (err.response?.status !== 401 || !config) return Promise.reject(err)

    // 액세스 토큰(15분)이 만료됐을 뿐일 수 있다 — 리프레시 쿠키로 새 토큰을 받아 같은 요청을 한 번만 다시 보낸다.
    // 갱신은 session.ts 가 한 번에 하나로 묶으므로, 401 이 동시에 여럿 와도 서버에는 갱신 한 번만 간다.
    if (!config._retried) {
      const token = await refreshSession()
      if (token) {
        config._retried = true
        config.headers.Authorization = `Bearer ${token}`
        return api.request(config)
      }
    }
    // 갱신도 실패했거나(쿠키 만료·폐기) 재시도까지 401 — 세션이 끝난 것. 화면은 ProtectedRoute 가 랜딩으로 보낸다
    useAuthStore.getState().logout()
    return Promise.reject(err)
  },
)
