import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  nickname: string | null
  onboarded: boolean // 초기 취향 설정 완료 여부
  login: (token: string, nickname: string, onboarded: boolean) => void
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
      completeOnboarding: () => set({ onboarded: true }),
      logout: () => set({ accessToken: null, nickname: null, onboarded: false }),
    }),
    { name: 'auth' },
  ),
)
