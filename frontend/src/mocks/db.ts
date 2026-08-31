import type { User } from '@/types'

const PRODUCT_TEAM = { id: 'team-product', name: '프로덕트팀' }
const MANAGEMENT_TEAM = { id: 'team-management', name: '경영지원팀' }

export const MOCK_USERS: User[] = [
  {
    id: 'u-1',
    name: '김수진',
    email: 'sujin@zenith.co.kr',
    role: 'member',
    title: '프론트엔드 개발',
    team: PRODUCT_TEAM,
    avatarHue: 275,
  },
  {
    id: 'u-2',
    name: '박동현',
    email: 'donghyun@zenith.co.kr',
    role: 'lead',
    title: '프로덕트 팀장',
    team: PRODUCT_TEAM,
    avatarHue: 155,
  },
  {
    id: 'u-3',
    name: '최재호',
    email: 'jaeho@zenith.co.kr',
    role: 'exec',
    title: '대표이사',
    team: MANAGEMENT_TEAM,
    avatarHue: 25,
  },
]

/** MSW는 새로고침마다 초기화되므로, 세션은 sessionStorage가 아니라 토큰 문자열에 담는다. */
export function tokenFor(user: User) {
  return `mock.${user.id}`
}

export function userFromToken(token: string | null): User | undefined {
  if (!token?.startsWith('mock.')) return undefined
  const id = token.slice('mock.'.length)
  return MOCK_USERS.find((user) => user.id === id)
}
