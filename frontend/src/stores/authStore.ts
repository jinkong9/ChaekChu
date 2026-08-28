import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  nickname: string | null // OAuth 직후엔 null — 온보딩 Step 0에서 입력
  onboarded: boolean // 초기 취향 설정 완료 여부
  login: (token: string, nickname: string | null, onboarded: boolean) => void
  setNickname: (nickname: string) => void
  completeOnboarding: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      nickname: null,
      onboarded: false,
      login: (accessToken, nickname, onboarded) => set({ accessToken, nickname, onboarded }),
      setNickname: (nickname) => set({ nickname }),
      completeOnboarding: () => set({ onboarded: true }),
      logout: () => set({ accessToken: null, nickname: null, onboarded: false }),
    }),
    { name: 'auth' },
  ),
)
