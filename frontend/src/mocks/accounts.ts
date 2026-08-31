/**
 * 백엔드가 붙기 전까지 MSW가 API를 흉내 낸다.
 * 실제 FastAPI에 붙이려면 `VITE_DISABLE_MSW=true npm run dev`.
 */
export const MSW_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DISABLE_MSW !== 'true'

export const DEMO_PASSWORD = 'zenith1234'

export const DEMO_ACCOUNTS = [
  { email: 'sujin@zenith.co.kr', label: '사원 · 김수진' },
  { email: 'donghyun@zenith.co.kr', label: '팀장 · 박동현' },
  { email: 'jaeho@zenith.co.kr', label: '임원 · 최재호' },
] as const
