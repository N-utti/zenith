import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { notify } from '@/lib/desktop'
import { wsUrl } from '@/lib/serverOrigin'
import { chatKeys } from './api'
import type { ChatChannel, ChatEvent, ChatMessage } from './types'

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
    channel && !channel.is_dm
      ? `#${channel.name} · ${message.author.name}`
      : message.author.name

  void notify({ title, body: message.body })
}

export interface ChatSocket {
  connected: boolean
  /** 채널별로 지금 입력 중인 사람 이름. 본인은 빠진다. */
  typingByChannel: Record<string, string[]>
  notifyTyping: (channelId: string) => void
}

/**
 * 채팅 실시간 채널. 메시지 전송은 REST로 하고, 반영은 전부 이 소켓이 한다.
 * 내가 보낸 메시지도 서버를 한 바퀴 돌아 같은 경로로 돌아온다. 낙관적 추가를
 * 하지 않으므로 다른 탭·다른 사람과 순서가 어긋날 일이 없다.
 */
export function useChatSocket(): ChatSocket {
  const user = useCurrentUser()
  const qc = useQueryClient()

  const [connected, setConnected] = useState(false)
  const [typingByChannel, setTypingByChannel] = useState<Record<string, string[]>>({})

  const socketRef = useRef<WebSocket | null>(null)
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

      socket.onopen = () => setConnected(true)

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

        if (event.type === 'message') {
          const { message } = event
          qc.setQueryData<{ items: ChatMessage[] }>(
            chatKeys.messages(message.channel_id),
            (old) => {
              if (!old) return old
              // 탭이 여러 개면 같은 이벤트를 중복으로 받을 수 있다.
              if (old.items.some((item) => item.id === message.id)) return old
              return { items: [...old.items, message] }
            },
          )
          void qc.invalidateQueries({ queryKey: chatKeys.channels })
          notifyIncoming(qc, message, user.id)
          return
        }

        if (event.type === 'read') {
          void qc.invalidateQueries({ queryKey: chatKeys.channels })
          return
        }

        if (event.type === 'typing') {
          if (event.userId === user.id) return
          const { channelId, name } = event

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
        }
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
  }, [user.id, qc])

  const notifyTyping = useCallback((channelId: string) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return

    const now = Date.now()
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return
    lastTypingSentRef.current = now
    socket.send(JSON.stringify({ type: 'typing', channelId }))
  }, [])

  return { connected, typingByChannel, notifyTyping }
}
