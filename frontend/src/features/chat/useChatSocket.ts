import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { notify } from '@/lib/desktop'
import { wsUrl } from '@/lib/serverOrigin'
import { homeKeys } from '@/features/home/keys'
import { chatKeys } from './api'
import { appendMessage, errorText, withLastMessage, withUnread } from './events'
import type { ChatAttachment, ChatChannel, ChatEvent, ChatMessage } from './types'

/** 타이핑 표시는 이 시간 동안만 유지한다. 상대가 멈춰도 서버가 알려 주지 않는다. */
const TYPING_TTL_MS = 3000
/** 키를 칠 때마다 보내지 않는다. */
const TYPING_THROTTLE_MS = 2000
const RECONNECT_MS = 2000

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
    channel && !channel.is_dm ? `#${channel.name} · ${message.author.name}` : message.author.name

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

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    // 이 effect가 만든 소켓만 따로 붙잡는다. 공유 ref를 닫으면 effect가 겹칠 때
    // (StrictMode의 이중 마운트 등) 남의 소켓을 닫고 자기 것은 남긴다.
    let socket: WebSocket | null = null
    const typingTimers = typingTimersRef.current

    const connect = () => {
      if (closed) return
      socket = new WebSocket(socketUrl())
      socketRef.current = socket

      socket.onopen = () => {
        setConnected(true)
        // 끊긴 동안 온 메시지는 아무도 안 받아 왔다. 소켓이 유일한 수신 경로다. 다시 받지
        // 않으면 `ChatPage` 가 연결 직후 읽음을 보내 서버의 안읽음이 0 이 되고, 그 메시지는
        // 화면에도 배지에도 없이 사라진다. 그래서 먼저 다시 받는다.
        //
        // 첫 연결에는 건너뛴다. 방금 화면이 받아 온 것을 한 번 더 받을 뿐이다.
        if (reconnectedRef.current) {
          void qc.invalidateQueries({ queryKey: chatKeys.allMessages })
          void qc.invalidateQueries({ queryKey: chatKeys.channels })
          void qc.invalidateQueries({ queryKey: homeKeys.home })
        }
        reconnectedRef.current = true
      }

      socket.onclose = () => {
        setConnected(false)
        if (!closed) reconnectTimer = window.setTimeout(connect, RECONNECT_MS)
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

        if (event.ev === 'error') {
          // 되돌아가 고칠 입력이 없는 실패라 토스트다(`ui/Toast.tsx`). 소켓이 닫혀서
          // 못 보낸 경우는 sendMessage 가 false 로 알리고 Composer 가 입력 옆에 낸다.
          toast.error(errorText(event))
          return
        }

        if (event.ev === 'typing') {
          if (event.user_id === user.id) return
          const { channel_id: channelId, name } = event

          setTypingByChannel((current) => {
            const names = current[channelId] ?? []
            if (names.includes(name)) return current
            return { ...current, [channelId]: [...names, name] }
          })

          const key = `${channelId}:${name}`
          window.clearTimeout(typingTimers.get(key))
          typingTimers.set(
            key,
            window.setTimeout(() => {
              setTypingByChannel((current) => ({
                ...current,
                [channelId]: (current[channelId] ?? []).filter((n) => n !== name),
              }))
              typingTimers.delete(key)
            }, TYPING_TTL_MS),
          )
          return
        }

        // presence·notice 는 받을 화면이 없어 여기서 떨어진다(`types.ts` 의 ChatEvent).
      }
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      typingTimers.forEach((timer) => window.clearTimeout(timer))
      typingTimers.clear()
      socket?.close()
      if (socketRef.current === socket) socketRef.current = null
    }
    // toast 는 `ui/Toast.tsx` 의 모듈 상수라 렌더마다 바뀌지 않는다. 바뀌게 되면 이 effect 가
    // 매 렌더 다시 돌아 소켓이 끊겼다 붙는다. 그 파일에서 api 를 렌더 안으로 옮기면 안 된다.
  }, [user.id, qc, toast])

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
    (channelId, { body, attachments }) =>
      // attachments 가 undefined 면 JSON 에서 키가 빠진다. 서버 기본값이 None 이라 그대로 맞다.
      sendOp({ op: 'msg', channel_id: channelId, body, attachments }),
    [sendOp],
  )

  const sendRead = useCallback<ChatSocket['sendRead']>(
    (channelId) => {
      sendOp({ op: 'read', channel_id: channelId })
    },
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

  return { connected, typingByChannel, notifyTyping, sendMessage, sendRead }
}
