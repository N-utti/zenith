import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { meQueryKey } from '@/features/auth/queries'
import { api, ApiError } from '@/lib/api'
import { clearNotifications, notify } from '@/lib/desktop'
import { wsUrl } from '@/lib/serverOrigin'
import { approvalsKey } from '@/features/approvals/api'
import { homeKeys } from '@/features/home/keys'
import { notificationKeys } from '@/features/notifications/api'
import { noticeToast } from '@/features/notifications/view'
import { AI_NAME, isAiCommand } from './aiCommand'
import { chatKeys } from './api'
import {
  appendMessage,
  errorText,
  removeMessage,
  replaceMessage,
  withEditedLast,
  withLastMessage,
  withUnread,
} from './events'
import type { ChatAttachment, ChatChannel, ChatEvent, ChatMessage } from './types'

/** 타이핑 표시는 이 시간 동안만 유지한다. 상대가 멈춰도 서버가 알려 주지 않는다. */
const TYPING_TTL_MS = 3000
/** 키를 칠 때마다 보내지 않는다. */
const TYPING_THROTTLE_MS = 2000
/** `/ai` 를 보낸 뒤 봇 답을 기다리는 표시의 상한. 서버의 답 제한 시간(120초)과 같다. 답 없이 끝나는 길(채널을 나감)이 있다. */
const AI_REPLY_TTL_MS = 120_000
/** 다시 붙는 간격. 연달아 실패하면 두 배씩 늘려 상한에서 멈춘다. */
const RECONNECT_MS = 2000
const RECONNECT_MAX_MS = 10_000
/**
 * 열린 뒤 이만큼 버텨야 연결된 것으로 친다. 서버는 거절할 때도 일단 열었다가 코드를 실어 닫는다
 * (4401·1013, 백엔드 #343). 열리자마자 연결로 치면 DB 가 끊긴 동안 연결 표시가 깜빡이고, 다시
 * 붙을 때마다 목록을 새로 받고, 끊김 배너의 유예(`connectionLost.ts`)가 매번 처음부터 돈다.
 *
 * ponytail: 서버가 접속 직후 늘 보내는 프레임이 없어 시간으로 가른다. 그런 프레임이 생기면
 * 그걸 받은 때로 바꾼다.
 */
const OPEN_SETTLE_MS = 300

/** 누구인지는 핸드셰이크에 실리는 세션 쿠키가 말한다(11 §7.5). URL 에 사용자 id 를 싣지 않는다. */
function socketUrl(): string {
  return wsUrl('/api/ws')
}

/**
 * 새 메시지를 OS 알림으로 띄운다. 데스크탑 셸이 아니면 notify가 알아서 빠진다.
 *
 * 창을 보고 있을 때는 띄우지 않는다. 화면에 이미 메시지가 나타나는데 토스트까지
 * 겹치면 방해만 된다. 최소화·다른 앱 사용 중일 때만 알린다.
 */
function notifyIncoming(qc: QueryClient, message: ChatMessage, currentUserId: string): void {
  if (message.author.id === currentUserId) return
  if (document.hasFocus()) return

  const channels = qc.getQueryData<{ items: ChatChannel[] }>(chatKeys.channels)
  const channel = channels?.items.find((item) => item.id === message.channel_id)

  // DM은 채널명이 곧 상대 이름이라 "정성운 · 정성운"이 되므로 이름만 쓴다.
  const title =
    channel && !channel.is_dm
      ? `${channel.is_private ? '' : '#'}${channel.name} · ${message.author.name}`
      : message.author.name

  void notify({ title, body: message.body })
}

export interface ChatSocket {
  connected: boolean
  /** 채널별로 지금 입력 중인 사람 이름. 본인은 빠진다. */
  typingByChannel: Record<string, string[]>
  notifyTyping: (channelId: string) => void
  /**
   * 메시지를 보낸다(04 §4.1 `msg`). 본문이나 첨부 중 하나는 있어야 한다.
   *
   * 소켓이 닫혀 있으면 아무것도 보내지 않고 `false` 를 준다. 호출부는 그때 입력창을 비우지
   * 말아야 한다. 응답이 없는 단방향이라 이 `false` 가 유일한 즉시 실패 신호다.
   */
  sendMessage: (
    channelId: string,
    input: { body: string; attachments?: ChatAttachment[] },
  ) => boolean
  /**
   * 여기까지 읽었다고 알린다(04 §4.1 `read`). 닫혀 있으면 버린다. 다시 열릴 때 호출부가
   * 또 보내므로(`ChatPage`) 재시도를 여기서 쌓아 두지 않는다.
   */
  sendRead: (channelId: string) => void
  /**
   * 내가 보낸 메시지의 글을 고친다. 화면은 돌아오는 `msg_edit` 로 바뀐다(낙관적 반영 없음).
   * 닫혀 있으면 `false`. 서버가 거절하면 `error` 이벤트가 토스트로 뜬다.
   *
   * 쓴 사람만 된다(백엔드 #284). 남의 메시지면 `FORBIDDEN`, 없는 메시지면 `NOT_FOUND` 가 온다.
   */
  editMessage: (channelId: string, messageId: string, body: string) => boolean
  /** 내가 보낸 메시지를 지운다. 화면은 돌아오는 `msg_del` 로 바뀐다. 닫혀 있으면 `false`. */
  deleteMessage: (channelId: string, messageId: string) => boolean
}

/**
 * 채팅 실시간 채널. 보내기·읽음·타이핑을 전부 이 소켓의 `op` 로 보내고, 화면 반영도 전부
 * 이 소켓의 `ev` 로 받는다(04 §4.1). REST 로 남는 것은 채널 목록·과거 메시지·첨부뿐이다.
 *
 * 내가 보낸 메시지도 서버를 한 바퀴 돌아 `msg` 로 돌아온다. 낙관적 추가를 하지 않으므로
 * 다른 탭·다른 사람과 순서가 어긋날 일이 없다.
 */
export function useChatSocket(): ChatSocket {
  const user = useCurrentUser()
  const qc = useQueryClient()
  const toast = useToast()

  const [connected, setConnected] = useState(false)
  const [typingByChannel, setTypingByChannel] = useState<Record<string, string[]>>({})

  const socketRef = useRef<WebSocket | null>(null)
  /** 한 번이라도 열린 적이 있는지. 재접속 때만 놓친 것을 다시 받으려고 본다. */
  const reconnectedRef = useRef(false)
  const lastTypingSentRef = useRef(0)
  const typingTimersRef = useRef(new Map<string, number>())

  const hideTyping = useCallback((channelId: string, name: string) => {
    const timers = typingTimersRef.current
    const key = `${channelId}:${name}`
    window.clearTimeout(timers.get(key))
    timers.delete(key)
    setTypingByChannel((current) =>
      current[channelId]?.includes(name)
        ? { ...current, [channelId]: current[channelId].filter((n) => n !== name) }
        : current,
    )
  }, [])

  /**
   * 모든 채널의 AI 답 기다림 표시를 끈다. 끊긴 사이 온 봇 답은 소켓이 아니라 과거 메시지 조회로 다시 받아
   * 표시를 끌 계기가 사라진다. 아직 안 온 답은 표시 없이 나타나지만 상한까지 헛표시를 남기는 것보다 낫다.
   */
  const hideAiEverywhere = useCallback(() => {
    for (const key of typingTimersRef.current.keys()) {
      if (key.endsWith(`:${AI_NAME}`)) hideTyping(key.slice(0, -AI_NAME.length - 1), AI_NAME)
    }
  }, [hideTyping])

  /** 타이핑 줄에 이름을 `ttl` 동안 띄운다. 다시 오면 시간을 처음부터 잰다. */
  const showTyping = useCallback(
    (channelId: string, name: string, ttl: number) => {
      setTypingByChannel((current) => {
        const names = current[channelId] ?? []
        if (names.includes(name)) return current
        return { ...current, [channelId]: [...names, name] }
      })
      const timers = typingTimersRef.current
      const key = `${channelId}:${name}`
      window.clearTimeout(timers.get(key))
      timers.set(
        key,
        window.setTimeout(() => hideTyping(channelId, name), ttl),
      )
    },
    [hideTyping],
  )

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    let settleTimer: number | undefined
    /** 자리 잡지 못하고 연달아 닫힌 횟수. */
    let failures = 0
    // 이 effect가 만든 소켓만 따로 붙잡는다. 공유 ref를 닫으면 effect가 겹칠 때
    // (StrictMode의 이중 마운트 등) 남의 소켓을 닫고 자기 것은 남긴다.
    let socket: WebSocket | null = null
    const typingTimers = typingTimersRef.current

    const connect = () => {
      if (closed) return
      socket = new WebSocket(socketUrl())
      socketRef.current = socket

      const settled = () => {
        const late = failures > 0
        failures = 0
        setConnected(true)
        // 끊긴 동안 온 메시지는 아무도 안 받아 왔다. 소켓이 유일한 수신 경로다. 다시 받지
        // 않으면 `ChatPage` 가 연결 직후 읽음을 보내 서버의 안읽음이 0 이 되고, 그 메시지는
        // 화면에도 배지에도 없이 사라진다. 그래서 먼저 다시 받는다.
        //
        // 곧바로 붙은 첫 연결에는 건너뛴다. 방금 화면이 받아 온 것을 한 번 더 받을 뿐이다.
        // 실패하다가 늦게 붙은 첫 연결은 그 사이 온 것을 놓쳤으므로 받는다.
        if (reconnectedRef.current || late) {
          void qc.invalidateQueries({ queryKey: chatKeys.allMessages })
          void qc.invalidateQueries({ queryKey: chatKeys.channels })
          void qc.invalidateQueries({ queryKey: homeKeys.home })
          void qc.invalidateQueries({ queryKey: notificationKeys.list })
          hideAiEverywhere()
        }
        reconnectedRef.current = true
      }

      socket.onopen = () => {
        settleTimer = window.setTimeout(settled, OPEN_SETTLE_MS)
      }

      socket.onclose = (event) => {
        window.clearTimeout(settleTimer)
        setConnected(false)
        if (closed) return
        const delay = Math.min(RECONNECT_MS * 2 ** failures, RECONNECT_MAX_MS)
        failures += 1
        const retry = () => {
          if (!closed) reconnectTimer = window.setTimeout(connect, delay)
        }
        if (event.code !== 4401) return retry()
        // 4401 은 서버가 세션을 거절했다는 뜻이다(쿠키 없음·세션 회수·비활성 계정, 이슈 #340).
        // 그대로 다시 붙으면 같은 거절만 되풀이하므로 `/me` 로 세션부터 확인한다. access 만료면
        // `lib/api.ts` 가 refresh 로 살린다. 그래도 401 이면 진짜 끝이라 프로필을 비워 로그인
        // 화면으로 보낸다. 그 밖의 실패(네트워크·서버 재시작)는 세션 탓이 아니므로 다시 붙어 본다.
        //
        // 내 정보 쿼리를 다시 받지 않고 직접 부른다. 그 쿼리는 실패하면 `AuthProvider` 가
        // 익명으로 판정해서, 서버가 잠깐 502 를 준 것만으로 로그인 화면에 앉게 된다.
        void api('/me').then(retry, (error: unknown) => {
          if (!(error instanceof ApiError && error.status === 401)) return retry()
          // `lib/queryClient.ts` 가 죽은 401 에 하는 것과 같은 정리다.
          qc.setQueryData(meQueryKey, null)
          clearNotifications()
        })
      }

      socket.onmessage = (raw) => {
        let event: ChatEvent
        try {
          event = JSON.parse(String(raw.data)) as ChatEvent
        } catch {
          return
        }

        if (event.ev === 'msg') {
          const { message } = event
          qc.setQueryData<{ items: ChatMessage[] }>(chatKeys.messages(message.channel_id), (old) =>
            appendMessage(old, message),
          )
          // 목록의 마지막 메시지를 직접 꽂는다. 안읽음 숫자는 뒤따라오는 `unread` 가 정한다.
          // 여기서 목록을 다시 받으면 그 응답이 `unread` patch 를 덮어(읽는 중인 채널에도
          // 배지가 남는다) 숫자가 어긋난다. 목록에 없는 채널일 때만 받아 온다.
          const known = qc
            .getQueryData<{ items: ChatChannel[] }>(chatKeys.channels)
            ?.items.some((item) => item.id === message.channel_id)
          if (known) {
            qc.setQueryData<{ items: ChatChannel[] }>(chatKeys.channels, (old) =>
              withLastMessage(old, message),
            )
          } else {
            void qc.invalidateQueries({ queryKey: chatKeys.channels })
          }
          // 홈은 여기서 안 받는다. `msg` 뒤에는 늘 `unread` 가 따라오고(서버가 멤버마다 자기
          // 숫자를 보낸다) 그쪽이 홈을 다시 받는다. 둘 다 하면 메시지 한 통에 홈을 두 번 받는다.
          notifyIncoming(qc, message, user.id)
          // 봇 답이 오면 기다리는 표시를 끈다. 같은 채널에 둘이 물었으면 먼저 온 답에 꺼진다.
          if (message.author.is_bot) hideTyping(message.channel_id, AI_NAME)
          return
        }

        /*
         * 메시지를 고치거나 지우면 서버가 그 메시지의 멘션 알림도 고치거나 지운다(#284). 알림함과
         * 홈의 멘션 카드가 옛 미리보기를 들고 있으면, 가리려고 고친 글이 다음에 받을 때까지 보인다.
         * 알림 캐시의 메시지 id 로 좁힐 수도 있지만 이 규모에서는 그냥 다시 받는다.
         *
         * 지울 때는 홈을 여기서 안 받는다. `msg_del` 뒤에는 `unread` 가 따라오고 그쪽이 받는다.
         */
        const staleMentions = (home: boolean) => {
          void qc.invalidateQueries({ queryKey: notificationKeys.list })
          hideAiEverywhere()
          if (home) void qc.invalidateQueries({ queryKey: homeKeys.home })
        }

        if (event.ev === 'msg_edit') {
          const { message } = event
          qc.setQueryData<{ items: ChatMessage[] }>(chatKeys.messages(message.channel_id), (old) =>
            replaceMessage(old, message),
          )
          qc.setQueryData<{ items: ChatChannel[] }>(chatKeys.channels, (old) =>
            withEditedLast(old, message),
          )
          staleMentions(true)
          return
        }

        if (event.ev === 'msg_del') {
          const { channel_id, message_id } = event
          qc.setQueryData<{ items: ChatMessage[] }>(chatKeys.messages(channel_id), (old) =>
            removeMessage(old, message_id),
          )
          // 지워진 것이 그 채널의 마지막 메시지였으면 미리보기에 무엇이 올지는 서버만 안다
          // (그 앞 메시지를 안 받아 둔 채널일 수 있다). 그때만 목록을 다시 받는다. 안읽음 숫자는
          // 뒤따라오는 `unread` 가 정하고, 다시 받은 응답도 지운 뒤의 숫자라 서로 어긋나지 않는다.
          const wasLast = qc
            .getQueryData<{ items: ChatChannel[] }>(chatKeys.channels)
            ?.items.some((item) => item.last_message?.id === message_id)
          if (wasLast) void qc.invalidateQueries({ queryKey: chatKeys.channels })
          staleMentions(false)
          return
        }

        if (event.ev === 'unread') {
          const { channel_id, count } = event
          qc.setQueryData<{ items: ChatChannel[] }>(chatKeys.channels, (old) =>
            withUnread(old, channel_id, count),
          )
          // 홈은 안 읽은 대화를 카드 목록으로 그려서 숫자만 꽂을 자리가 없다. 다시 받는다.
          void qc.invalidateQueries({ queryKey: homeKeys.home })
          return
        }

        if (event.ev === 'channels') {
          // 빠진 채널을 보고 있었다면 목록에서 사라지는 순간 `ChatPage` 가 방을 닫는다.
          void qc.invalidateQueries({ queryKey: chatKeys.channels })
          void qc.invalidateQueries({ queryKey: homeKeys.home })
          // 채널이 지워졌으면 그 채널의 멘션 알림도 서버에서 사라진다. 안 받으면 죽은 링크가 남는다.
          void qc.invalidateQueries({ queryKey: notificationKeys.list })
          hideAiEverywhere()
          return
        }

        if (event.ev === 'error') {
          // 되돌아가 고칠 입력이 없는 실패라 토스트다(`ui/Toast.tsx`). 소켓이 닫혀서
          // 못 보낸 경우는 sendMessage 가 false 로 알리고 Composer 가 입력 옆에 낸다.
          toast.error(errorText(event))
          // 그 채널에 보낸 것이 거절됐다(`/ai` 를 너무 자주 보냄 등). 봇 답은 오지 않는다.
          // ponytail: 코드를 가리지 않아 같은 채널의 다른 거절(남의 글 고치기 등)에도 꺼지고, 채널이 안 붙는
          // 형식 오류에는 상한까지 남는다. 앞 질문을 기다리는 중 다음 `/ai` 가 거절돼도 꺼진다.
          if (event.channel_id) hideTyping(event.channel_id, AI_NAME)
          return
        }

        if (event.ev === 'typing') {
          if (event.user_id === user.id) return
          showTyping(event.channel_id, event.name, TYPING_TTL_MS)
          return
        }

        if (event.ev === 'notice') {
          // 목록에 직접 꽂지 않고 다시 받는다. 새 글 알림은 서버가 응답을 만들 때 등급을 다시
          // 판정해 제목을 가리는데(`_mask_post_notices`), 소켓으로 온 payload 는 그 판정 전이다.
          void qc.invalidateQueries({ queryKey: notificationKeys.list })
          hideAiEverywhere()
          // 채팅 멘션이면 홈은 같은 메시지의 `unread` 가 이미 다시 받는다.
          if (!event.payload?.channel_id) void qc.invalidateQueries({ queryKey: homeKeys.home })
          // 결재 알림이면 열려 있는 결재함과 문서도 낡았다(내 차례가 왔거나 결과가 났다).
          // 근태 신청(휴가·예외 근무·연장·정정)도 결재 문서라, 그 결과면 근태 화면도 같이 낡는다.
          if (event.kind.startsWith('apv_')) {
            void qc.invalidateQueries({ queryKey: approvalsKey })
            if (event.payload?.type_code !== 'general') {
              for (const key of ['leaves', 'attendance', 'exceptions']) {
                void qc.invalidateQueries({ queryKey: [key] })
              }
            }
          }
          // 창을 보고 있으면 사이드바 배지가 오른다. OS 알림은 `notifyIncoming` 과 같은 조건으로.
          const alert = noticeToast(event)
          if (alert && !document.hasFocus()) void notify(alert)
          return
        }

        // presence 는 받을 화면이 없어 여기서 떨어진다(`types.ts` 의 ChatEvent).
      }
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(settleTimer)
      typingTimers.forEach((timer) => window.clearTimeout(timer))
      typingTimers.clear()
      socket?.close()
      if (socketRef.current === socket) socketRef.current = null
    }
    // toast 는 `ui/Toast.tsx` 의 모듈 상수라 렌더마다 바뀌지 않는다. 바뀌게 되면 이 effect 가
    // 매 렌더 다시 돌아 소켓이 끊겼다 붙는다. 그 파일에서 api 를 렌더 안으로 옮기면 안 된다.
  }, [user.id, qc, toast, showTyping, hideTyping, hideAiEverywhere])

  /**
   * 프레임 하나를 던진다. 닫혀 있으면 안 보내고 false. 응답은 없다(단방향).
   *
   * ponytail: `true` 는 보냈다는 뜻이 아니라 로컬 버퍼에 넣었다는 뜻이다. 죽었지만 아직
   * 닫히지 않은 소켓은 readyState 가 OPEN 으로 남아 있어 그 사이 보낸 것이 조용히 사라진다.
   * uvicorn 의 웹소켓 핑(기본 20초)이 그 창을 ~40초로 묶는다. 더 좁히려면 보낸 초안을 들고
   * 있다가 내 에코(`msg` 중 author 가 나)가 N초 안에 안 오면 입력창에 되돌리는 장치가 필요하다.
   */
  const sendOp = useCallback((op: Record<string, unknown>): boolean => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(op))
    return true
  }, [])

  const sendMessage = useCallback<ChatSocket['sendMessage']>(
    (channelId, { body, attachments }) => {
      // attachments 가 undefined 면 JSON 에서 키가 빠진다. 서버 기본값이 None 이라 그대로 맞다.
      const sent = sendOp({ op: 'msg', channel_id: channelId, body, attachments })
      // 내 글이 돌아올 때가 아니라 보낼 때 켠다. 서버는 거절(`AI_THROTTLED`)을 내 글을 뿌리기 전에 보내서,
      // 돌아올 때 켜면 거절에 꺼진 뒤 다시 켜져 상한까지 남는다.
      if (sent && isAiCommand(body)) showTyping(channelId, AI_NAME, AI_REPLY_TTL_MS)
      return sent
    },
    [sendOp, showTyping],
  )

  const sendRead = useCallback<ChatSocket['sendRead']>(
    (channelId) => {
      sendOp({ op: 'read', channel_id: channelId })
    },
    [sendOp],
  )

  const editMessage = useCallback<ChatSocket['editMessage']>(
    (channelId, messageId, body) =>
      sendOp({ op: 'edit', channel_id: channelId, message_id: messageId, body }),
    [sendOp],
  )

  const deleteMessage = useCallback<ChatSocket['deleteMessage']>(
    (channelId, messageId) => sendOp({ op: 'del', channel_id: channelId, message_id: messageId }),
    [sendOp],
  )

  const notifyTyping = useCallback(
    (channelId: string) => {
      const now = Date.now()
      if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return
      // 못 보냈으면 시각을 갱신하지 않는다. 다시 열린 직후 2초를 기다리지 않게.
      if (sendOp({ op: 'typing', channel_id: channelId })) lastTypingSentRef.current = now
    },
    [sendOp],
  )

  return {
    connected,
    typingByChannel,
    notifyTyping,
    sendMessage,
    sendRead,
    editMessage,
    deleteMessage,
  }
}
