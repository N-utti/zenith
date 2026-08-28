import type { Announcement } from '@/features/home/types'

// 목 데이터는 "오늘"에 붙어 있어야 화면이 자연스럽다. 고정 날짜를 쓰지 않는다.
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

// ── 콘텐츠 ───────────────────────────────────────────────────

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'a-1',
    title: '2026년 하반기 정기 워크숍 안내',
    boardLevel: 'member',
    authorName: '경영지원팀',
    createdAt: minutesAgo(190),
    pinned: true,
  },
  {
    id: 'a-2',
    title: 'MOA 사내 협업툴 파일럿 참여자 모집',
    boardLevel: 'member',
    authorName: '박동현',
    createdAt: minutesAgo(1180),
    pinned: false,
  },
  {
    id: 'a-3',
    title: '3분기 인사평가 일정 및 평가자 배정',
    boardLevel: 'lead',
    authorName: '경영지원팀',
    createdAt: minutesAgo(2400),
    pinned: false,
  },
  {
    id: 'a-4',
    title: '추석 연휴 근무 일정 · 대체휴무 안내',
    boardLevel: 'member',
    authorName: '경영지원팀',
    createdAt: minutesAgo(3300),
    pinned: false,
  },
  {
    id: 'a-5',
    title: '4분기 예산안 검토 회의 자료',
    boardLevel: 'exec',
    authorName: '최재호',
    createdAt: minutesAgo(4100),
    pinned: false,
  },
]
