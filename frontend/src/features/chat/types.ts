import type { Schema } from '@/types'
import type { Notification } from '@/features/notifications/types'

/** 백엔드 `routers/channels.py` 의 `Person`. */
export type Person = Schema<'Person'>

/**
 * 메시지에 붙은 파일. 소켓의 `msg` 에 그대로 실어 보낸다.
 *
 * `content_type` 은 업로드가 저장한 형식이다. **보낸 쪽 값이라 판정에 쓰지 않는다**(`attachments.ts`).
 * 2026-09-18 이전 메시지는 `null` 이라 `undefined` 만 분기하면 놓친다.
 */
export type ChatAttachment = Schema<'AttachmentOut'>

/**
 * 백엔드 `MessageOut`. 소켓이 밀어 주는 메시지도 같은 모양이다.
 * `doc_ref` 는 문서 id뿐이라(`MessageList.tsx` 의 `DocCard`), 제목·수정 정보는 그 문서를 따로 조회해 채운다.
 */
export type ChatMessage = Schema<'MessageOut'>

/**
 * 백엔드 `MessagePage`. 메시지 한 쪽(오래된 순). `next_cursor` 는 더 과거가 있을 때만 오고, 다음
 * 요청의 `?cursor=` 로 그대로 돌려준다. 뜻은 서버만 안다(화면은 읽지 않는다).
 */
export type MessagePage = Schema<'MessagePage'>

/**
 * 백엔드 `ChannelOut`. DM 은 보는 사람에 따라 이름이 다르다. `name` 에 상대의 이름이 온다.
 *
 * 비공개 채널(`is_private`)은 만든 사람과 고른 사람만 멤버고, 멤버가 사람을 더하고 뺀다.
 * DM 은 `false` 로 온다.
 */
export type ChatChannel = Schema<'ChannelOut'>

/**
 * 서버가 WebSocket 으로 밀어 주는 이벤트(04 §4.1). 봉투 키는 `ev` 이고 필드는 snake_case 다.
 *
 * `presence`(재실)도 같은 소켓으로 오지만 여기에 없다. 받을 화면이 없어서 받아서 버린다.
 * 재실은 근태 모듈이 판정한다(`WorkStatus.tsx`). 화면이 생기면 union 에 더한다.
 */
export type ChatEvent =
  | { ev: 'msg'; channel_id: string; message: ChatMessage }
  /**
   * 메시지가 고쳐졌거나 지워졌다. 채널 멤버 전원에게 온다(고친 사람 포함). 고치기는 고친 뒤의
   * 메시지 전체가, 지우기는 id 만 온다(백엔드 #284. 04 §4.1 에는 아직 없다).
   */
  | { ev: 'msg_edit'; channel_id: string; message: ChatMessage }
  | { ev: 'msg_del'; channel_id: string; message_id: string }
  /** 알림 행 하나(`realtime/chat.py` 의 `push_notice`). 멘션·댓글·새 글·결재 알림이 생긴 순간에 온다. */
  | ({ ev: 'notice' } & Pick<Notification, 'id' | 'kind' | 'payload' | 'created_at'>)
  /** 내 안읽음 숫자. 새 메시지 때는 사람마다 자기 숫자, `read` 뒤에는 본인에게 0. */
  | { ev: 'unread'; channel_id: string; count: number }
  /**
   * 내 채널 목록이 바뀌었다(비공개 채널에 들어왔거나 빠졌거나, 멤버가 달라졌다). 목록을 다시 받는다.
   * 비공개 채널을 만들 때와 멤버가 바뀔 때 전·후 멤버에게 온다. 다른 칸은 없다.
   */
  | { ev: 'channels' }
  | { ev: 'typing'; channel_id: string; user_id: string; name: string }
  /**
   * 보낸 것이 거절됐다. 소켓은 닫히지 않는다.
   *
   * `detail` 은 문구 하나일 때도 있고 필드별 오류 배열일 때도 있다(프레임이 스키마에 안 맞으면
   * pydantic 오류가 그대로 온다). 사람에게 보일 문구는 `events.ts` 의 `errorText()` 가 고른다.
   */
  | { ev: 'error'; code: string; detail: unknown; channel_id?: string }
