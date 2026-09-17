import type { Notification } from '@/features/notifications/types'
import type { Mention } from '@/features/home/types'
import type { User } from '@/types'
import { canRead, findPost } from './boardDb'
import { hueOf } from '@/lib/avatar'

// 목 데이터는 "오늘"에 붙어 있어야 화면이 자연스럽다. 고정 날짜를 쓰지 않는다.
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** 04 §6 — 권한 밖 글은 제목부터 서버가 가린다. 백엔드 `me.py` 와 같은 문자열. */
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
      channel_id: 'c-1',
      message_id: 'cm-1',
      from: { id: 'u-4', name: '장지윤' },
      preview: '권한 필터 기준 한 번만 확인 부탁드려요',
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
 */
function maskForViewer(user: User, notification: Notification): Notification {
  const p = notification.payload
  if (notification.kind !== 'post' || !p?.post_id) return notification

  const post = findPost(p.post_id)
  // 글이 지워졌으면 등급을 확인할 길이 없다. 가리는 쪽이 안전하다.
  const allowed = post ? canRead(user, post.minRole) : false
  if (allowed) return notification
  return { ...notification, payload: { ...p, title: MASKED_TITLE, masked: true } }
}

export function listNotifications(
  user: User,
  { unread = false, limit = 50 }: { unread?: boolean; limit?: number } = {},
): Notification[] {
  return NOTIFICATIONS.filter((n) => !unread || n.read_at === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
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

/**
 * 홈의 멘션 카드가 쓰는 모양. 알림에서 파생시킨다 — 별도 데이터를 두면 두 벌이 되어 어긋난다
 * (게시판 공지와 같은 이유). 백엔드는 `GET /me/home` 의 `mentions` 로 알림 그대로를 주므로,
 * 그 경로를 붙일 때 이 변환은 화면 쪽으로 옮겨 간다.
 */
export function listMentions(user: User, limit: number): Mention[] {
  return listNotifications(user, { limit: 50 })
    .filter((n) => n.kind !== 'post' && n.payload)
    .slice(0, limit)
    .map((n) => {
      const p = n.payload!
      const actor = p.from ?? { id: '', name: '알 수 없음' }
      return {
        id: n.id,
        actorName: actor.name,
        actorHue: hueOf(actor.id),
        body: p.preview ?? '',
        // 목에는 "나를 콕 집었는가" 를 가릴 정보가 없다. 멘션 알림은 전부 나를 부른 것이다.
        mentionsMe: true,
        source: p.doc_id
          ? { kind: 'doc' as const, docId: p.doc_id, docTitle: p.doc_title ?? '', via: '댓글' as const }
          : {
              kind: 'channel' as const,
              channelId: p.channel_id ?? '',
              channelName: channelName(p.channel_id),
              via: '채널 메시지' as const,
            },
        createdAt: n.created_at,
      }
    })
}

/** 개발 릴레이(`scripts/chat.js`)의 채널 이름. 목이 릴레이를 읽을 수 없어 여기에 둔다. */
function channelName(channelId: string | undefined): string {
  return { 'c-1': '개발', 'c-2': '공지', 'c-3': '잡담' }[channelId ?? ''] ?? '채널'
}
