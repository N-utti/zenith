/**
 * 백엔드가 붙기 전까지 MSW가 API를 흉내 낸다.
 * 실제 FastAPI에 붙이려면 `VITE_DISABLE_MSW=true npm run dev`.
 */
export const MSW_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DISABLE_MSW !== 'true'

export const DEMO_PASSWORD = 'zenith1234'

/** 로그인 화면의 바로가기. 등급별 한 명씩. 전체 명단은 users.json. */
export const DEMO_ACCOUNTS = [
  { email: 'sungwoon@zenith.co.kr', label: '사원 · 정성운' },
  { email: 'chulsung@zenith.co.kr', label: '임원 · 김철성 대표' },
] as const
