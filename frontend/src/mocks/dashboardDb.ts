import type { Mention, TodayTask } from '@/features/home/types'

// 목 데이터는 "오늘"에 붙어 있어야 화면이 자연스럽다. 고정 날짜를 쓰지 않는다.
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

// ── 콘텐츠 ───────────────────────────────────────────────────

export const MENTIONS: Mention[] = [
  {
    id: 'm-1',
    actorName: '박동현',
    actorHue: 155,
    body: '예산 표에 근거 자료 링크 걸어주세요',
    mentionsMe: true,
    source: {
      kind: 'doc',
      docId: 'd-1',
      docTitle: '2026 하반기 제품 로드맵',
      via: '댓글',
    },
    createdAt: minutesAgo(34),
  },
  {
    id: 'm-2',
    actorName: '이정민',
    actorHue: 200,
    body: '권한 필터 기준 한 번만 확인 부탁드려요',
    mentionsMe: true,
    source: {
      kind: 'channel',
      channelId: 'c-1',
      channelName: '개발',
      via: '채널 메시지',
    },
    createdAt: minutesAgo(62),
  },
  {
    id: 'm-3',
    actorName: '한지우',
    actorHue: 95,
    body: '회의록에 결정사항 정리해 뒀습니다',
    mentionsMe: false,
    source: {
      kind: 'doc',
      docId: 'd-3',
      docTitle: '주간 개발 회의록 (8월 4주차)',
      via: '댓글',
    },
    createdAt: minutesAgo(1400),
  },
]

/**
 * 할 일은 아직 서버 모델이 없다. 화면 구조를 먼저 잡아 두고, 실제로는
 * 문서 체크박스 블록·멘션에서 모이는 형태가 될 자리다.
 */
export const TODAY_TASKS: TodayTask[] = [
  { id: 't-1', title: '예산안 검토 후 회신', done: false },
  { id: 't-2', title: '근태 설계서 오픈이슈 정리', done: false },
  { id: 't-3', title: '주간 회의록 공유', done: true },
]
