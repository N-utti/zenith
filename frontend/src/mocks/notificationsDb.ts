import type { Notification } from '@/features/notifications/types'
import type { User } from '@/types'
import { BOARD_DEFS, canRead, findPost } from './boardDb'

// 목 데이터는 "오늘"에 붙어 있어야 화면이 자연스럽다. 고정 날짜를 쓰지 않는다.
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** 권한 밖 글은 제목부터 서버가 가린다(04 §6). 백엔드 `me.py` 와 같은 문자열. */
const MASKED_TITLE = '＿＿＿＿＿ 보고'

/**
 * 알림은 사용자마다 한 줄씩 쌓이는 것이지만, 목에서는 로그인한 사람의 것만 있으면 된다.
 * 데모 계정이 둘뿐이라 소유자를 나누지 않고 모두가 같은 목록을 본다.
 */
const NOTIFICATIONS: Notification[] = [
  {
    id: 'n-1',
    kind: 'mention',
    read_at: null,
    created_at: minutesAgo(34),
    payload: {
      doc_id: 'd-1',
      doc_title: '2026 하반기 제품 로드맵',
      comment_id: 'dc-1',
      block_id: null,
      from: { id: 'u-2', name: '정성운' },
      preview: '예산 표에 근거 자료 링크 걸어주세요',
    },
  },
  {
    id: 'n-2',
    kind: 'mention',
    read_at: null,
    created_at: minutesAgo(62),
    payload: {
      channel_id: 'c-dev',
      channel_name: '개발',
      message_id: 'cm-1',
      from: { id: 'u-4', name: '장지윤' },
      preview: '권한 필터 기준 한 번만 확인 부탁드려요',
    },
  },
  {
    // DM 멘션. 채널 이름(`channel_name`)이 `null` 이라 요약에 «»가 들어가지 않는다.
    id: 'n-6',
    kind: 'mention',
    read_at: null,
    created_at: minutesAgo(95),
    payload: {
      channel_id: 'dm-u1-u2',
      channel_name: null,
      message_id: 'cm-2',
      from: { id: 'u-2', name: '정성운' },
      preview: '어제 얘기한 알림 문구 초안 보냈어요',
    },
  },
  {
    id: 'n-3',
    kind: 'post',
    read_at: null,
    created_at: minutesAgo(190),
    payload: {
      post_id: 'p-1',
      board_id: 'all',
      board_name: '전체 공지',
      title: '2026년 하반기 정기 워크숍 안내',
      from: { id: 'team-hr', name: '경영지원팀' },
    },
  },
  {
    id: 'n-4',
    kind: 'mention',
    read_at: minutesAgo(1200),
    created_at: minutesAgo(1400),
    payload: {
      doc_id: 'd-3',
      doc_title: '주간 개발 회의록 (8월 4주차)',
      comment_id: 'dc-2',
      block_id: null,
      from: { id: 'u-1', name: '진수연' },
      preview: '회의록에 결정사항 정리해 뒀습니다',
    },
  },
  {
    id: 'n-5',
    kind: 'post',
    read_at: minutesAgo(4000),
    created_at: minutesAgo(4100),
    payload: {
      post_id: 'p-6',
      board_id: 'exec',
      board_name: '경영 보고',
      title: '4분기 예산안 검토 회의 자료',
      from: { id: 'u-3', name: '홍성완' },
    },
  },
]

/**
 * 글 알림의 제목은 알림을 만든 시점의 값이다. 등급이 내려갔거나 게시판 등급이 올라갔으면
 * 지금 기준으로 다시 판정해 가린다. 저장된 줄은 그대로 두고 응답만 바꾼다.
 * 백엔드 `me.py` 의 `_mask_post_notices` 와 같은 일이다.
 *
 * 글에 복사된 등급이 아니라 **게시판의 지금 등급**을 본다. 백엔드도 글과 게시판을 이어
 * 붙여 `Board.min_role` 로 판정한다. 둘은 게시판 등급이 올라갔을 때 갈린다.
 */
function maskForViewer(user: User, notification: Notification): Notification {
  const p = notification.payload
  if (notification.kind !== 'post' || !p?.post_id) return notification

  const post = findPost(p.post_id)
  const board = post && BOARD_DEFS.find((b) => b.id === post.board_id)
  // 글이나 게시판이 사라졌으면 등급을 확인할 길이 없다. 가리는 쪽이 안전하다.
  const allowed = board ? canRead(user, board.min_role) : false
  if (allowed) return notification
  // 제목만 가리고 작성자를 남기면 누가 임원 게시판에 글을 썼는지가 샌다. 서버도 같이 지운다.
  return { ...notification, payload: { ...p, title: MASKED_TITLE, masked: true, from: null } }
}

export function listNotifications(
  user: User,
  { unread = false, limit = 50 }: { unread?: boolean; limit?: number } = {},
): Notification[] {
  return NOTIFICATIONS.filter((n) => !unread || n.read_at === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((n) => maskForViewer(user, n))
}

/** 내 알림만, 이미 읽은 것은 그대로. 읽은 개수를 돌려준다. */
export function markRead(ids: string[]): number {
  const now = new Date().toISOString()
  let changed = 0
  for (const n of NOTIFICATIONS) {
    if (ids.includes(n.id) && n.read_at === null) {
      n.read_at = now
      changed += 1
    }
  }
  return changed
}

/** 멘션으로 보는 종류. 백엔드 `routers/me.py` 의 `MENTION_KINDS` 와 같다. */
const MENTION_KINDS = ['mention', 'comment', 'reply']

/**
 * 홈 한 벌의 `mentions`. **알림 그대로** 준다. 백엔드도 `NotificationOut` 을 그대로 싣는다.
 *
 * 허용 목록이다(백엔드 `MENTION_KINDS`). "글 알림만 빼고" 로 두면 근태·결재 알림이 붙는 순간
 * 전부 멘션 카드로 흘러든다.
 */
export function listMentionNotifications(user: User, limit: number): Notification[] {
  return listNotifications(user, { limit: 50 })
    .filter((n) => MENTION_KINDS.includes(n.kind))
    .slice(0, limit)
}
