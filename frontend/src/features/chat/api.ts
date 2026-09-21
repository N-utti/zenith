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

// 보내기·읽음은 REST 가 아니라 소켓 op 이다(04 §4.1). `useChatSocket` 의 sendMessage·sendRead.
// 전에 여기 있던 `POST /channels/{id}/messages`·`/read` 는 실서버에 없는 경로였고 405·404 가 났다.

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
 *
 * 훅이 아니라 그냥 함수다. 파일 여러 개를 한 번에 고를 수 있는데, 뮤테이션 훅 하나를
 * 반복문에서 부르면 새 호출이 앞선 것에서 관찰자를 떼어 간다. 그러면 앞선 파일은 서버에
 * 올라갔는데 성공 콜백이 안 불려 화면에도 메시지에도 없고 서버에만 남는다. 문서 이미지
 * 업로드(`features/docs/useImageUpload`)도 같은 이유로 함수를 쓴다.
 */
export function uploadAttachment(channelId: string, file: File): Promise<ChatAttachment> {
  const form = new FormData()
  form.append('file', file)
  return api<ChatAttachment>(`/channels/${channelId}/attachments`, { method: 'POST', body: form })
}
