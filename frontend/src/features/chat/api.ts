import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ChatAttachment, ChatChannel, ChatMessage } from './types'

/**
 * 채팅만 MSW를 거치지 않고 개발 서버로 간다 (vite 프록시). 누구인지는 URL·본문이 아니라
 * 세션 쿠키가 말한다(11 §7.5). 개발 릴레이(scripts/chat.js)도 실제 백엔드도 쿠키만 본다.
 */
export const chatKeys = {
  channels: ['chat', 'channels'] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
}

export function useChannels() {
  return useQuery({
    queryKey: chatKeys.channels,
    queryFn: () => api<{ items: ChatChannel[] }>('/channels'),
  })
}

export function useMessages(channelId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(channelId ?? ''),
    // 백엔드 `MessagePage`. `next_cursor` 는 더 과거가 있을 때 다음 요청의 `?cursor=` 다.
    // 지금 화면은 과거 스크롤을 하지 않아 읽지 않는다.
    queryFn: () =>
      api<{ items: ChatMessage[]; next_cursor: string | null }>(
        `/channels/${channelId}/messages?limit=50`,
      ),
    enabled: channelId !== null,
  })
}

export function useSendMessage(channelId: string) {
  return useMutation({
    mutationFn: ({ body, attachments }: { body: string; attachments?: ChatAttachment[] }) =>
      api<ChatMessage>(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, attachments }),
      }),
    // 캐시 반영은 WebSocket 이벤트가 한다. 내가 보낸 것도 같은 경로로 돌아온다.
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      // 04 에 없는 경로. 백엔드는 읽음을 WS 의 read 이벤트로 받는다(realtime/chat.py ReadOp).
      // 그때까지 실제 백엔드에서는 404 다. 화면은 안 죽지만 안읽음 배지가 지워지지 않는다.
      api<{ ok: true }>(`/channels/${channelId}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
  })
}

/**
 * 공개 채널 또는 DM 을 만든다. 서버가 둘 중 하나만 받는다(`ChannelCreateIn`).
 *
 * 공개 채널은 만드는 순간 전원이 멤버다(15명 사내, 초대·탈퇴 없음). DM 은 같은 두 사람의
 * 것이 이미 있으면 새로 만들지 않고 그것을 돌려준다.
 */
export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string } | { dm_user_id: string }) =>
      api<ChatChannel>('/channels', { method: 'POST', body: JSON.stringify(input) }),
    // 약속을 돌려준다. 목록이 갱신된 뒤에 호출부의 이동이 일어나야, 방금 만든 채널을
    // 목록에서 못 찾아 "채널을 선택하세요" 가 한 번 스치는 일이 없다.
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.channels }),
  })
}

/** 사내망 파일 업로드 상한. 서버도 같은 값을 강제한다(`MAX_ATTACHMENT_BYTES`). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** 메시지 하나에 붙일 수 있는 파일 수. 백엔드 `MAX_ATTACHMENTS`. */
export const MAX_ATTACHMENTS = 10

/**
 * 첨부를 먼저 올리고 `{url, name, size}` 를 받는다. 그 값을 메시지의 `attachments[]` 에
 * 그대로 넣는다. 바이너리는 메시지 본문에 실리지 않는다.
 */
export function useUploadAttachment(channelId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<ChatAttachment>(`/channels/${channelId}/attachments`, {
        method: 'POST',
        body: form,
      })
    },
  })
}
