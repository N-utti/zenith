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
 * 백엔드 `ChannelOut`. DM 은 보는 사람에 따라 이름이 다르다. `name` 에 상대의 이름이 온다.
 *
 * `is_private` 는 계약에 들어왔다(백엔드 #236). 명세에서는 늘 오는 값이다.
 * 비공개 채널은 만든 사람과 고른 사람만 멤버고, 멤버가 사람을 더하고 뺀다.
 *
 * ponytail: 여기서는 아직 «없을 수도 있는 값» 으로 둔다. 이 칸이 실려 오는지로 서버가 비공개
 * 채널을 아는지를 가리는 코드(`api.ts` 의 `supportsPrivate`)와 그 테스트가 남아 있어서다.
 * 실서버에서 그 판정은 채널이 하나라도 있으면 참이다(목록이 비면 알 길이 없어 거짓이다. 빈 서버의
 * 첫 채널은 비공개로 못 만든다). 걷어 낼 때 이 타입도 명세 그대로(`Schema<'ChannelOut'>`)로 돌린다.
 */
export type ChatChannel = Omit<Schema<'ChannelOut'>, 'is_private'> & { is_private?: boolean }

/**
 * 서버가 WebSocket 으로 밀어 주는 이벤트(04 §4.1). 봉투 키는 `ev` 이고 필드는 snake_case 다.
 *
 * `presence`(재실)도 같은 소켓으로 오지만 여기에 없다. 받을 화면이 없어서 받아서 버린다.
 * 재실은 근태 모듈이 판정한다(`WorkStatus.tsx`). 화면이 생기면 union 에 더한다.
 */
export type ChatEvent =
  | { ev: 'msg'; channel_id: string; message: ChatMessage }
  /** 알림 행 하나(`realtime/chat.py` 의 `push_notice`). 멘션·댓글·새 글이 생긴 순간에 온다. */
  | ({ ev: 'notice' } & Pick<Notification, 'id' | 'kind' | 'payload' | 'created_at'>)
  /** 내 안읽음 숫자. 새 메시지 때는 사람마다 자기 숫자, `read` 뒤에는 본인에게 0. */
  | { ev: 'unread'; channel_id: string; count: number }
  /**
   * 내 채널 목록이 바뀌었다(비공개 채널에 들어왔거나 빠졌거나, 멤버가 달라졌다). 목록을 다시 받는다.
   * 계약에 아직 없다. 릴레이만 보낸다. 서버가 안 보내면 다음 재조회 때 반영된다.
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
