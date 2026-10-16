import { APPROVAL_TYPE_LABEL } from '@/features/approvals/types'
import type { Notification, NotificationPayload } from './types'

/**
 * 멘션으로 보는 종류. 백엔드 `routers/me.py` 의 `MENTION_KINDS` 와 같다.
 *
 * 허용 목록이어야 한다. "글 알림만 빼고 전부 멘션" 으로 두면 근태·결재 알림(`att_*`·`apv_*`)이
 * 붙는 순간 그것들이 전부 멘션 분기로 흘러들어, 문서 id 도 채널 id 도 없는 채로 빈 링크를 만든다.
 */
const MENTION_KINDS = ['mention', 'comment', 'reply']

/**
 * 결재 알림과 그 요약의 끝말. 백엔드 `routers/approvals.py` 의 `_notify` 가 만드는 네 종류다.
 * 근태 신청(휴가·연장근로)도 결재 문서라 승인·반려가 이 종류로 온다. `att_*` 는 서버가 만들지 않는다.
 */
const APPROVAL_SUFFIX: Record<string, string> = {
  apv_request: '결재 차례입니다',
  apv_approved: '결재가 승인되었습니다',
  apv_rejected: '결재가 반려되었습니다',
  apv_closed: '결재가 강제 종결되었습니다',
}

/**
 * 알림 한 건을 화면이 그릴 수 있는 모양으로 바꾼다.
 *
 * `payload` 는 종류마다 다른 자유 형식이라, 멘션 안에서는 어느 필드가 있느냐로 갈라진다.
 * 종류 이름만으로 갈라지지 않는 이유는 멘션 하나가 문서 댓글일 수도 채팅일 수도 있기 때문이다.
 *
 * `to` 가 `null` 이면 누를 수 없는 알림이다. 권한 밖이라 제목이 가려진 글 알림이 그렇다.
 */
export interface NotificationView {
  /** 아바타 색을 만드는 데 쓴다. 보낸 사람을 모르면 빈 문자열. */
  actorId: string
  actorName: string
  /** 한 줄 요약. "누가 어디에서 무엇을" */
  summary: string
  /** 그 아래 회색 줄. 원문 미리보기나 게시판 이름. */
  detail: string | null
  to: string | null
  /** 아이콘 자리. 화면이 이 값으로 고른다. */
  icon: 'doc' | 'chat' | 'board' | 'approval' | 'locked'
  /** 권한 밖이라 가려진 알림. 화면이 이유를 밝히고 아바타를 그리지 않는다. */
  masked: boolean
}

const UNKNOWN = '알 수 없음'

function mentionView(p: NotificationPayload): NotificationView | null {
  const actorId = p.from?.id ?? ''
  const actorName = p.from?.name ?? UNKNOWN

  if (p.doc_id) {
    return {
      actorId,
      actorName,
      // 어느 문서인지 요약에 넣는다. 누르기 전에 알 수 있어야 한다.
      summary: p.doc_title
        ? `${actorName}님이 ${p.doc_title} 문서에서 회원님을 불렀습니다`
        : `${actorName}님이 문서에서 회원님을 불렀습니다`,
      detail: p.preview ?? null,
      // 댓글 id 가 있으면 문서가 댓글을 펼치고 그 댓글(과 닻 블록)로 간다(CommentPanel).
      to: p.comment_id
        ? `/docs/${p.doc_id}?comment=${encodeURIComponent(p.comment_id)}`
        : `/docs/${p.doc_id}`,
      icon: 'doc',
      masked: false,
    }
  }
  if (p.channel_id) {
    return {
      actorId,
      actorName,
      /*
       * DM 이면 `channel_name` 이 `null` 이다(`realtime/chat.py`, #150). payload 에 DM 표시가
       * 따로 없어 이름 유무로 가려낸다. `!== actorName` 은 #150 이전(09-18~21)에 쌓인 알림 행이
       * 보낸 사람 이름을 담고 있어서 남겨 둔다 — 그 행들이 다 읽히면 빼도 된다.
       */
      summary:
        p.channel_name && p.channel_name !== actorName
          ? `${actorName}님이 ${p.channel_name} 채널에서 회원님을 불렀습니다`
          : `${actorName}님이 채팅에서 회원님을 불렀습니다`,
      detail: p.preview ?? null,
      // 메시지 id 가 있으면 그 줄로 내려가 밝힌다(`MessageList` 의 `?m=`). 채널만 열면 불린
      // 말이 위쪽 어딘가에 묻힌다.
      to: p.message_id
        ? `/chat/${p.channel_id}?m=${encodeURIComponent(p.message_id)}`
        : `/chat/${p.channel_id}`,
      icon: 'chat',
      masked: false,
    }
  }
  return null
}

function postView(p: NotificationPayload): NotificationView | null {
  if (!p.post_id || !p.board_id) return null
  const actorName = p.from?.name ?? UNKNOWN

  /*
   * 가려진 글이면 글쓴이를 지운다. 백엔드 마스킹(`_mask_post_notices`)도 2026-09-18 부터
   * `from` 을 `null` 로 지우지만(홈 공지 목록 `_posts` 와 같은 기준), 그전에 쌓인 알림 행은
   * 작성자를 그대로 싣고 있다. 여기서 한 번 더 지운다.
   */
  if (p.masked) {
    return {
      actorId: '',
      actorName: UNKNOWN,
      summary: p.title ?? UNKNOWN,
      detail: p.board_name ?? null,
      to: null,
      icon: 'locked',
      masked: true,
    }
  }

  return {
    actorId: p.from?.id ?? '',
    actorName,
    summary: p.title ?? UNKNOWN,
    detail: p.board_name ? `${p.board_name} · ${actorName}` : actorName,
    to: `/board/${p.board_id}/${p.post_id}`,
    icon: 'board',
    masked: false,
  }
}

function approvalView(kind: string, p: NotificationPayload): NotificationView | null {
  if (!p.approval_id) return null
  const actorName = p.from?.name ?? UNKNOWN
  // 모르는 유형이 붙어도 줄은 그린다. 유형 이름만 뭉뚱그린다.
  const type = (p.type_code && APPROVAL_TYPE_LABEL[p.type_code]) || '결재'
  return {
    // 요청은 문서를 넘긴 사람(기안자나 앞 단계 결재자), 결과는 마지막으로 처리한 사람이다.
    actorId: p.from?.id ?? '',
    actorName,
    summary: p.title ? `${p.title} ${APPROVAL_SUFFIX[kind]}` : APPROVAL_SUFFIX[kind],
    detail: `${type} · ${actorName}`,
    to: `/approvals/${p.approval_id}`,
    icon: 'approval',
    masked: false,
  }
}

/** 모르는 종류는 `null` 이다. 화면은 그 줄을 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다. */
export function notificationView(
  notification: Pick<Notification, 'kind' | 'payload'>,
): NotificationView | null {
  const p = notification.payload
  if (!p) return null
  if (notification.kind === 'post') return postView(p)
  if (MENTION_KINDS.includes(notification.kind)) return mentionView(p)
  if (Object.hasOwn(APPROVAL_SUFFIX, notification.kind)) return approvalView(notification.kind, p)
  return null
}

/**
 * 배지에 올릴 안 읽은 알림 수. 알림함이 그릴 수 있는 것만 센다. 모르는 종류까지 세면 배지는
 * 1 인데 알림함은 비어 있다.
 */
export function countUnread(items: Notification[]): number {
  return items.filter((n) => n.read_at === null && notificationView(n) !== null).length
}

/**
 * 방금 도착한 알림(소켓 `notice`)을 OS 알림 문구로 바꾼다. 띄우지 않을 알림은 `null`.
 *
 * 소켓 payload 는 서버의 읽기 시점 등급 판정(`_mask_post_notices`)을 거치지 않은 값이고, 여기서
 * 그 제목을 그대로 화면 밖에 낸다. 받는 사람이 만든 시점 등급으로 이미 걸러져 있다는 전제에
 * 기댄다(`boards.create_post` 의 수신자 필터). 서버가 그 필터를 넓히면 여기로 제목이 샌다.
 *
 * 채팅 멘션은 뺀다. 같은 메시지가 `msg` 로도 와서 이미 OS 알림을 띄운다(`useChatSocket` 의
 * `notifyIncoming`). 여기서도 띄우면 한 마디에 알림이 두 번 울린다.
 */
export function noticeToast(
  notification: Pick<Notification, 'kind' | 'payload'>,
): { title: string; body?: string } | null {
  if (notification.payload?.channel_id) return null
  const view = notificationView(notification)
  if (!view) return null
  return { title: view.summary, body: view.detail ?? undefined }
}

/** 서버가 준 알림과 화면이 그릴 모양을 짝지은 것. 그릴 수 없는 알림은 애초에 여기 없다. */
export interface NotificationRowData {
  notification: Notification
  view: NotificationView
}

/** 그릴 수 있는 알림만 남긴다. 알림함과 헤더 드롭다운이 같은 기준으로 센다. */
export function toRows(items: Notification[]): NotificationRowData[] {
  return items.flatMap((notification) => {
    const view = notificationView(notification)
    return view ? [{ notification, view }] : []
  })
}
