import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  /** 액세스 JWT(15분). **메모리에만** 둔다 — localStorage 에 두면 XSS 에 그대로 읽힌다(API_SPEC §2.3).
   *  새로고침 뒤에는 App 의 AuthRestore 가 POST /auth/refresh 로 다시 받는다. */
  accessToken: string | null
  nickname: string | null // OAuth 직후엔 null — 온보딩 Step 0에서 입력
  onboarded: boolean // 초기 취향 설정 완료 여부
  /** 앱 시작 시 세션 복원(갱신 + GET /users/me)이 끝났는가. 끝나기 전에는 라우트를 그리지 않는다 — 랜딩이 깜빡이고 보호 라우트가 튕기는 것 방지 */
  sessionReady: boolean
  login: (token: string, nickname: string | null, onboarded: boolean) => void
  setAccessToken: (token: string) => void
  setNickname: (nickname: string) => void
  completeOnboarding: () => void
  markSessionReady: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      nickname: null,
      onboarded: false,
      sessionReady: false,
      login: (accessToken, nickname, onboarded) => set({ accessToken, nickname, onboarded }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setNickname: (nickname) => set({ nickname }),
      completeOnboarding: () => set({ onboarded: true }),
      markSessionReady: () => set({ sessionReady: true }),
      logout: () => set({ accessToken: null, nickname: null, onboarded: false }),
    }),
    {
      name: 'auth',
      // 저장은 표시용 둘만. 토큰은 저장하지 않는다.
      partialize: (s) => ({ nickname: s.nickname, onboarded: s.onboarded }),
      // v1 은 accessToken 까지 저장했다 — 옛 저장분에서 토큰을 걷어낸다
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<Pick<AuthState, 'nickname' | 'onboarded'>>
        return { nickname: p.nickname ?? null, onboarded: p.onboarded ?? false }
      },
    },
  ),
)
