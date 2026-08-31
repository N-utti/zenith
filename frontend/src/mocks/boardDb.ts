import type { Board, BoardPost, BoardPostDetail } from '@/features/board/types'
import { ROLE_RANK, type Role, type User } from '@/types'

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** 게시판 정의. `allowed`는 요청한 사용자의 등급으로 핸들러가 붙인다. */
export const BOARD_DEFS: Omit<Board, 'allowed'>[] = [
  { id: 'all', name: '전체 공지', minRole: 'member', badge: '전체' },
  { id: 'lead', name: '팀장 회의록', minRole: 'lead', badge: '팀장↑' },
  { id: 'exec', name: '경영 보고', minRole: 'exec', badge: '임원' },
]

export interface StoredPost extends BoardPostDetail {
  minRole: Role
}

let nextId = 100

/**
 * 글 저장소. 홈의 `/announcements`도 여기서 파생된다 —
 * 공지는 게시판의 일부이지 별도 데이터가 아니다.
 */
export const POSTS: StoredPost[] = [
  {
    id: 'p-1',
    boardId: 'all',
    minRole: 'member',
    title: '2026년 하반기 정기 워크숍 안내',
    authorName: '경영지원팀',
    createdAt: minutesAgo(190),
    pinned: true,
    body: '하반기 정기 워크숍을 아래와 같이 진행합니다.\n\n· 일시: 2026년 9월 18일(금) 09:00 ~ 18:00\n· 장소: 본사 대회의실\n· 대상: 전 임직원\n\n참석 여부는 9월 5일까지 각 팀장에게 회신 부탁드립니다.',
  },
  {
    id: 'p-2',
    boardId: 'all',
    minRole: 'member',
    title: '제니스 사내 협업툴 파일럿 참여자 모집',
    authorName: '박동현',
    createdAt: minutesAgo(1180),
    pinned: false,
    body: '사내 협업툴 제니스의 파일럿에 참여할 인원을 모집합니다.\n\n문서 공동편집·채팅·사내 AI를 먼저 써 보고 의견을 주실 분을 찾습니다. 기간은 2주이며, 기존 업무 방식과 병행합니다.\n\n관심 있으신 분은 #개발 채널로 알려 주세요.',
  },
  {
    id: 'p-3',
    boardId: 'all',
    minRole: 'member',
    title: '추석 연휴 근무 일정 · 대체휴무 안내',
    authorName: '경영지원팀',
    createdAt: minutesAgo(3300),
    pinned: false,
    body: '추석 연휴 기간 근무 일정을 안내드립니다.\n\n연휴 중 당직이 필요한 팀은 팀장 승인 후 대체휴무를 신청할 수 있습니다. 신청은 근태 화면에서 처리해 주세요.',
  },
  {
    id: 'p-4',
    boardId: 'lead',
    minRole: 'lead',
    title: '3분기 인사평가 일정 및 평가자 배정',
    authorName: '경영지원팀',
    createdAt: minutesAgo(2400),
    pinned: true,
    body: '3분기 인사평가를 아래 일정으로 진행합니다.\n\n· 자기평가: 9월 8일 ~ 12일\n· 1차 평가(팀장): 9월 15일 ~ 19일\n· 최종 조정: 9월 22일 ~ 24일\n\n평가자 배정표는 첨부를 확인해 주세요.',
  },
  {
    id: 'p-5',
    boardId: 'lead',
    minRole: 'lead',
    title: '8월 팀장 회의 결과 공유',
    authorName: '박동현',
    createdAt: minutesAgo(4600),
    pinned: false,
    body: '8월 팀장 회의 주요 결정사항입니다.\n\n1. 제니스 파일럿을 9월 첫 주 시작\n2. 근태 모듈은 정책 확정 후 착수\n3. 전자결재 도입 여부는 9월 중 재논의',
  },
  {
    id: 'p-6',
    boardId: 'exec',
    minRole: 'exec',
    title: '4분기 예산안 검토 회의 자료',
    authorName: '최재호',
    createdAt: minutesAgo(4100),
    pinned: false,
    body: '4분기 예산안 검토를 위한 자료입니다.\n\n부문별 집행 현황과 잔여 예산, 그리고 내년 초까지의 투자 계획을 정리했습니다.',
  },
]

export function canRead(user: User, minRole: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[minRole]
}

export function listBoards(user: User): Board[] {
  return BOARD_DEFS.map((board) => ({ ...board, allowed: canRead(user, board.minRole) }))
}

/** 목록에 나가는 모양. `minRole`과 `body`는 서버 안에서만 쓰므로 싣지 않는다. */
function toListShape(post: StoredPost): BoardPost {
  return {
    id: post.id,
    boardId: post.boardId,
    title: post.title,
    authorName: post.authorName,
    createdAt: post.createdAt,
    pinned: post.pinned,
  }
}

/** 권한 밖 글은 제목·작성자를 가린 채로 내려간다. 목록에서 지우지 않는다. */
function toListItem(user: User, post: StoredPost): BoardPost {
  if (canRead(user, post.minRole)) return toListShape(post)
  return {
    id: post.id,
    boardId: post.boardId,
    title: '＿'.repeat(6),
    authorName: '＿＿＿',
    createdAt: post.createdAt,
    pinned: false,
    masked: true,
  }
}

/** `boardId`가 없으면 전체 게시판을 합쳐 최신순으로 준다 (홈 공지 카드가 쓴다). */
export function listPosts(user: User, boardId?: string): BoardPost[] {
  return POSTS.filter((post) => !boardId || post.boardId === boardId)
    .map((post) => toListItem(user, post))
    .sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt),
    )
}

export function findPost(id: string): StoredPost | undefined {
  return POSTS.find((post) => post.id === id)
}

export function createPost(
  user: User,
  boardId: string,
  input: { title: string; body: string },
): BoardPostDetail {
  const board = BOARD_DEFS.find((b) => b.id === boardId)
  if (!board) throw new Error('board not found')

  const post: StoredPost = {
    id: `p-${nextId++}`,
    boardId,
    minRole: board.minRole,
    title: input.title,
    authorName: user.name,
    createdAt: new Date().toISOString(),
    pinned: false,
    body: input.body,
  }
  POSTS.unshift(post)
  return toDetail(post)
}

/** 상세에 나가는 모양. `minRole`은 서버 판정용이라 싣지 않는다. */
export function toDetail(post: StoredPost): BoardPostDetail {
  return { ...toListShape(post), body: post.body }
}
