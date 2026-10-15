import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { prependOlder } from './events'
import type { ChatAttachment, ChatChannel, MessagePage } from './types'

/**
 * 채팅만 MSW를 거치지 않고 개발 서버로 간다 (vite 프록시). 누구인지는 URL·본문이 아니라
 * 세션 쿠키가 말한다(11 §7.5). 개발 릴레이(scripts/chat.js)도 실제 백엔드도 쿠키만 본다.
 */
export const chatKeys = {
  channels: ['chat', 'channels'] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
  /** 채널 구분 없이 모든 메시지 목록. 재연결 때 한꺼번에 다시 받는 데 쓴다. */
  allMessages: ['chat', 'messages'] as const,
}

/** 한 번에 받는 메시지 수. 서버 기본값과 같다(상한 200). */
const PAGE_SIZE = 50

export function useChannels() {
  return useQuery({
    queryKey: chatKeys.channels,
    queryFn: () => api<{ items: ChatChannel[] }>('/channels'),
  })
}

export function useMessages(channelId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(channelId ?? ''),
    // 최근 한 쪽. 더 과거는 `useOlderMessages` 가 이 캐시 앞에 붙인다.
    queryFn: () => api<MessagePage>(`/channels/${channelId}/messages?limit=${PAGE_SIZE}`),
    enabled: channelId !== null,
  })
}

/**
 * 더 과거 한 쪽을 받아 같은 캐시 앞에 붙인다. 커서는 목록에 실려 온 `next_cursor` 다.
 *
 * 쿼리를 쪽마다 나누지 않고 한 목록에 붙이는 이유는 소켓이다. 새 메시지(`appendMessage`)가
 * 이 캐시 하나에 쓰고, 화면도 이것 하나를 그린다.
 *
 * ponytail: 목록을 다시 받으면(창 복귀, 소켓 재연결) 최근 한 쪽으로 돌아가고 붙여 둔 과거는
 * 사라진다. 다시 누르면 된다. 오래 거슬러 읽는 일이 잦아지면 쪽 단위 쿼리(useInfiniteQuery)로 바꾼다.
 */
export function useOlderMessages(channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cursor: string) =>
      api<MessagePage>(
        `/channels/${channelId}/messages?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      ),
    onSuccess: (older, cursor) =>
      qc.setQueryData<MessagePage>(chatKeys.messages(channelId), (page) =>
        prependOlder(page, older, cursor),
      ),
  })
}

// 보내기·읽음은 REST 가 아니라 소켓 op 이다(04 §4.1). `useChatSocket` 의 sendMessage·sendRead.
// 전에 여기 있던 `POST /channels/{id}/messages`·`/read` 는 실서버에 없는 경로였고 405·404 가 났다.

/**
 * 서버가 비공개 채널을 아는가. 채널 목록에 `is_private` 칸이 실려 오는지로 안다.
 *
 * 지금 서버는 늘 이 칸을 준다(#236). 타입으로는 항상 참이라 실제로 온 값을 본다. 남겨 둔 이유는
 * #236 이전 서버다. 그 서버의 `ChannelCreateIn` 은 모르는 칸을 조용히 버려서, 비공개를 요청하면
 * 거절이 아니라 **전원이 들어오는 공개 채널**이 만들어지고 만든 사람은 그것을 비공개로 안다.
 * 그래서 서버가 칸을 주기 전에는 고르는 자리 자체를 그리지 않는다.
 *
 * 채널이 하나도 없으면 알 수 없어 `false` 다. 공개 채널이나 DM 이 하나 생기면 풀린다.
 */
export function supportsPrivate(channels: ChatChannel[]): boolean {
  return channels.some((channel) => typeof channel.is_private === 'boolean')
}

/**
 * `is_private` 와 `member_ids` 는 같이 간다. 한쪽만 보내면 서버가 422 로 거절한다(조용한
 * 공개 금지). `never` 는 그 조합을 타입에서도 막는다. 유니온은 다른 갈래의 속성을 초과 속성으로
 * 잡지 않아서, 적어 두지 않으면 `{ name, member_ids }` 가 첫 갈래로 통과한다.
 */
export type ChannelCreateInput =
  | { name: string; is_private?: never; member_ids?: never }
  | { name: string; is_private: true; member_ids: string[] }
  | { dm_user_id: string; is_private?: never; member_ids?: never }

/**
 * 채널 또는 DM 을 만든다. 서버가 `name` 과 `dm_user_id` 중 하나만 받는다(`ChannelCreateIn`).
 *
 * 공개 채널은 만드는 순간 전원이 멤버다(15명 사내, 초대·탈퇴 없음). 비공개 채널은 만든 사람과
 * 고른 사람만 멤버다. DM 은 같은 두 사람의 것이 이미 있으면 새로 만들지 않고 그것을 돌려준다.
 *
 * 비공개를 청했으면 **응답의 `is_private` 를 확인해야 한다**(`NewChatModal`). 서버가 목록에는
 * 칸을 주면서 생성 요청의 칸은 버리면 공개 채널이 돌아온다.
 */
export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ChannelCreateInput) =>
      api<ChatChannel>('/channels', { method: 'POST', body: JSON.stringify(input) }),
    // 약속을 돌려준다. 목록이 갱신된 뒤에 호출부의 이동이 일어나야, 방금 만든 채널을
    // 목록에서 못 찾아 "채널을 선택하세요" 가 한 번 스치는 일이 없다.
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.channels }),
  })
}

/**
 * 비공개 채널에 사람을 더한다. 멤버면 누구나 한다. 이미 멤버인 사람이 섞여 있어도 된다.
 *
 * 응답의 채널을 목록 캐시에 넣지 않는다. 서버가 이 응답의 `unread` 를 0, `last_message` 를
 * `null` 로 고정해 줘서, 넣으면 안읽음 배지와 마지막 메시지가 지워진다. 목록을 다시 받는다.
 */
export function useAddMembers(channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<ChatChannel>(`/channels/${channelId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_ids: userIds }),
      }),
    // 실패해도 다시 받는다. 명단이 낡아서 난 실패(이미 빠진 사람)면 다시 받아야 줄이 사라진다.
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.channels }),
  })
}

/** 비공개 채널에서 사람을 뺀다. 자기 자신이면 나가기다. 나가면 목록에서 채널이 사라진다. */
export function useRemoveMember(channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.channels }),
  })
}

/** 백엔드 채널 이름 제약(`routers/channels.py` 의 `NonBlank`, 100자). 만들 때와 바꿀 때가 같다. */
export const CHANNEL_NAME_MAX = 100

const NAME_CHARS_ERROR =
  '이름에 쓸 수 없는 문자가 있습니다. 보이지 않는 문자나 합쳐진 이모지를 빼 주세요.'

/**
 * 채널 이름을 서버가 저장할 모양으로 다듬고, 서버가 거절할 이름이면 그 이유를 준다
 * (백엔드 `_clean_name`, #308). 순서도 서버와 같다: 정규화, 금지 문자, 빈 값, 길이.
 *
 * 서버의 거절은 Pydantic 422 라 문구가 배열 안에 들어 있고 `ApiError.message` 로 오지 않는다.
 * 여기서 먼저 걸러야 입력 옆에 이유가 뜬다.
 *
 * 서버는 미할당 문자(Cn)도 막지만 여기서는 뺀다. 브라우저와 서버의 유니코드 판이 다르면 새로
 * 나온 이모지를 서버는 받는데 화면이 막게 된다. 그쪽은 `channelNameFailure` 가 받는다.
 */
export function checkChannelName(raw: string): { name: string; error: string | null } {
  // 한글 호환 자모(ㄱ~ㆎ)는 정규화에서 뺀다. NFKC 는 입력기가 넣은 ㅇ 을 조합용 첫소리(U+110B)로
  // 바꾸는데, 그 글자는 혼자 있으면 위에 작게 그려지고 프리텐다드에도 없다(ㅋㅋ 가 깨져 보인다).
  const name = raw.replace(/[^\u3131-\u318e]+/g, (run) => run.normalize('NFKC')).trim()
  let error: string | null = null
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u.test(name)) error = NAME_CHARS_ERROR
  else if (!name) error = '이름을 적어 주세요.'
  // 글자 수는 서버처럼 코드포인트로 센다. 정규화가 합자를 풀어 길이가 늘 수 있다.
  else if ([...name].length > CHANNEL_NAME_MAX) error = '이름은 100자 이하여야 합니다.'
  return { name, error }
}

/** 채널을 만들거나 이름을 바꾸다 실패했을 때 입력 옆에 낼 문구. */
export function channelNameFailure(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback
  const detail = (err.body as { detail?: unknown } | null)?.detail
  if (err.status !== 422 || !Array.isArray(detail)) return err.message
  // 배열 422 는 이름 말고도 난다(멤버 목록 모양 등). 이름 칸의 거절일 때만 문자 규칙을 말한다.
  // 미리 거른 것 말고 이름에 남는 거절은 문자 규칙뿐이다.
  const onName = detail.some((item: { loc?: unknown }) =>
    Array.isArray(item?.loc) ? item.loc.includes('name') : false,
  )
  return onName ? NAME_CHARS_ERROR : fallback
}

/**
 * 채널 이름을 바꾼다(백엔드 #280). 멤버면 누구나 한다. DM 은 이름이 없어 안 된다.
 * 이름 규칙은 만들 때와 같다(1~100자, 공개 채널끼리 겹치면 409).
 *
 * 응답을 목록 캐시에 넣지 않고 다시 받는다. 다른 멤버의 화면은 소켓 `channels` 이벤트로 바뀐다.
 */
export function useRenameChannel(channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api<ChatChannel>(`/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.channels }),
  })
}

/**
 * DM 방을 내 목록에서 숨긴다(백엔드 #280). 방과 대화는 그대로다. 상대의 목록에도 그대로 있다.
 * 그 방에 새 메시지가 오거나 같은 사람과 대화를 다시 열면 내 목록에 돌아온다.
 */
export function useHideDm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) => api<void>(`/channels/${channelId}/hide`, { method: 'POST' }),
    // 다시 받기를 기다리지 않는다(약속을 돌려주지 않는다). 기다리면 부른 쪽이 화면을 옮기기 전에
    // 방이 목록에서 먼저 빠져, 보던 자리에 「채널을 선택하세요」가 스친다.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
  })
}

/**
 * 채널을 통째로 지운다. 대화와 첨부도 같이 사라지고 되돌릴 수 없다. 지울 수 있는 사람은
 * 서버가 정한다(`ChatChannel.can_delete`).
 *
 * 다른 멤버의 화면은 소켓 `channels` 이벤트로 바뀐다.
 */
export function useDeleteChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) => api<void>(`/channels/${channelId}`, { method: 'DELETE' }),
    // `useHideDm` 과 같은 이유로 다시 받기를 기다리지 않는다.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
  })
}

/** 사내망 파일 업로드 상한. 서버도 같은 값을 강제한다(`MAX_ATTACHMENT_BYTES`). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** 메시지 하나에 붙일 수 있는 파일 수. 백엔드 `MAX_ATTACHMENTS`. */
export const MAX_ATTACHMENTS = 10

/**
 * 본문 글자 수 상한. 백엔드 `MsgOp.body` 의 `max_length` 와 같다(앞뒤 공백을 다듬은 뒤 센다).
 *
 * 여기서 먼저 막아야 한다. 넘겨 보내면 서버가 스키마 위반으로 필드별 오류 배열을 돌려주는데,
 * 그건 사람이 읽을 문구가 없고 이미 입력창을 비운 뒤라 쓴 글이 사라진다.
 *
 * 이 상한이 프레임 상한(백엔드 `MAX_FRAME` 64,000바이트)도 같이 막는다. 본문 1만 자를 전부
 * 4바이트 글자로 채워도 40KB 고, 첨부는 10개 × 약 1KB(이름은 서버가 200바이트로 자른다)라
 * 최악이 50KB 다. 프레임 상한을 넘으면 서버가 거절 이벤트도 없이 소켓을 닫으므로(1009) 그쪽은
 * 아예 도달하지 않게 두는 것이 맞다. 이 상한이나 첨부 개수를 올리면 그 계산이 깨진다.
 */
export const MAX_BODY_CHARS = 10_000

/**
 * 첨부를 먼저 올리고 `{url, name, size}` 를 받는다. 그 값을 메시지의 `attachments[]` 에
 * 그대로 넣는다. 바이너리는 메시지 본문에 실리지 않는다.
 *
 * 훅이 아니라 그냥 함수다. 파일 여러 개를 한 번에 고를 수 있는데, 뮤테이션 훅 하나를
 * 반복문에서 부르면 새 호출이 앞선 것에서 관찰자를 떼어 간다. 그러면 앞선 파일은 서버에
 * 올라갔는데 성공 콜백이 안 불려 화면에도 메시지에도 없고 서버에만 남는다. 문서 이미지
 * 업로드(`features/docs/useFileUpload`)도 같은 이유로 함수를 쓴다.
 */
export function uploadAttachment(channelId: string, file: File): Promise<ChatAttachment> {
  const form = new FormData()
  form.append('file', file)
  return api<ChatAttachment>(`/channels/${channelId}/attachments`, { method: 'POST', body: form })
}
