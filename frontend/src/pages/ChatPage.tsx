import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { AtSign, Hash, Lock, MessagesSquare, UserPlus, WifiOff } from 'lucide-react'
import { useChannels, useMessages } from '@/features/chat/api'
import { ChannelList } from '@/features/chat/ChannelList'
import { ChannelMembersModal } from '@/features/chat/ChannelMembersModal'
import { Composer } from '@/features/chat/Composer'
import { MessageList } from '@/features/chat/MessageList'
import { useChatSocketContext } from '@/features/chat/ChatSocketContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api'
import { useColleagues } from '@/features/people/colleagues'

function TypingLine({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="h-4" />
  return (
    <span className="text-subtle text-xs">
      {names.slice(0, 2).join(', ')}
      {names.length > 2 && ` 외 ${names.length - 2}명`} 입력 중…
    </span>
  )
}

export function ChatPage() {
  const { channelId } = useParams()
  const { data: channels } = useChannels()
  const { connected, typingByChannel, notifyTyping, sendRead } = useChatSocketContext()
  const me = useCurrentUser()

  const channel = channels?.items.find((c) => c.id === channelId)
  // 열어 둔 채널 id 로 든다. 참·거짓으로 들면 방을 옮겨도 열린 채로 다음 방의 멤버가 뜬다.
  const [membersOf, setMembersOf] = useState<string | null>(null)
  // 방을 옮겼거나 그 채널이 목록에서 사라졌으면(남이 나를 뺐다) 버린다. 남겨 두면 그 방에
  // 돌아오거나 다시 더해졌을 때 창이 저절로 열린다.
  if (membersOf !== null && membersOf !== channel?.id) setMembersOf(null)

  // @ 자동완성 후보와 배지 명단. 서버는 채널 멤버 중 활성 계정에만 멘션 알림을 만든다. 채널 멤버는
  // 비활성으로 바뀌어도 빠지지 않으므로 활성 동료(나는 이미 빠져 있다)와 겹쳐 거른다.
  const { people } = useColleagues()
  const mentionCandidates = useMemo(() => {
    const active = new Set(people.map((person) => person.id))
    return channel?.members.filter((member) => active.has(member.id)) ?? []
  }, [people, channel])
  // 배지 명단은 내용으로 붙잡는다. 메시지 줄이 이 객체가 그대로면 다시 그리지 않는데(`MessageRow`),
  // 후보 배열은 렌더마다 새로 만들어져 deps 로 쓸 수 없다. 채널 목록의 순서만 바뀌어도 그 안의
  // 멤버 배열이 새 객체가 된다(react-query 의 참조 유지는 같은 자리끼리만 견준다).
  const namesKey = JSON.stringify([...mentionCandidates.map((member) => member.name), me.name])
  const mentionNames = useMemo(() => new Set(JSON.parse(namesKey) as string[]), [namesKey])
  // 목록을 받았는데 거기 없는 방이면 메시지를 조회하지 않는다. 빠진 채널의 주소에 머무는 동안
  // 창에 초점이 올 때마다 403 을 받고, 실서버는 그때마다 감사 기록에 거부를 남긴다.
  const { data: messages } = useMessages(channels && !channel ? null : (channelId ?? null))
  const latestId = messages?.items.at(-1)?.id

  // 채널을 열거나 보고 있는 동안 새 메시지가 오면 읽음으로 처리한다. 읽음도 소켓이라
  // 아직 연결되기 전이면 보낼 수 없다. connected 를 deps 에 둬서 연결된 뒤 한 번 더 보낸다.
  //
  // channelId 가 아니라 channel 로 가른다. 주소에 멤버가 아닌(또는 없는) 채널 id 가 들어오면
  // 서버가 읽음을 FORBIDDEN 으로 거절하고, 그 거절이 토스트로 뜬다. 아무것도 안 썼는데
  // 실패 알림이 반복되므로, 내 목록에 있는 채널일 때만 보낸다.
  // 창을 보고 있는지는 안 본다. 같은 소켓의 OS 알림은 `document.hasFocus()` 로 창을 볼 때
  // 건너뛰는데(`useChatSocket`) 읽음은 반대로 보인다. 일부러 그렇게 뒀다: 읽음의 뜻을 "화면에
  // 떠 있었다" 로 두는 것이 지금 설계이고(메시지가 화면에 그려진다), 포커스를 조건에 넣으면
  // 두 번째 모니터에 띄워 둔 대화가 영구히 안 읽음으로 남는다. 팀 전원이 모니터 2개를 쓰므로
  // 어느 쪽이 맞는지는 실제로 써 보고 정할 문제다.
  //
  // deps 에 channel 객체를 넣으면 목록을 다시 받을 때마다 새 객체가 되어 읽음이 또 나간다. id 로.
  const readableId = channel?.id
  useEffect(() => {
    if (readableId && connected) sendRead(readableId)
  }, [readableId, latestId, connected, sendRead])

  // 이 채널의 멘션 알림도 같이 읽음으로 넘긴다. 메시지는 위에서 읽음이 됐는데 알림만 남으면,
  // 방금 눈앞에서 읽은 말 때문에 사이드바 「받은 알림」 숫자가 오른 채로 남는다.
  // 실패하면 그대로 둔다. 안 읽음으로 남아 알림함에서 누를 수 있다.
  //
  // 메시지 읽음과 달리 창을 보고 있을 때만 넘긴다. 멘션은 "나를 불렀다" 는 신호라, 뒤에 깔린
  // 창에서 저절로 읽음이 되면 불린 흔적이 어디에도 안 남는다. 창으로 돌아오면 그때 넘긴다.
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const sync = () => setFocused(document.hasFocus())
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [])
  const { data: notifications } = useNotifications()
  const { mutate: markNotificationsRead } = useMarkNotificationsRead()
  // 배열이 아니라 문자열로 든다. 배열은 렌더마다 새 객체라 deps 에 넣으면 읽음이 매번 나간다.
  const mentionIds = readableId
    ? (notifications?.items ?? [])
        .filter((n) => n.read_at === null && n.payload?.channel_id === readableId)
        .map((n) => n.id)
        .join(',')
    : ''
  useEffect(() => {
    if (mentionIds && connected && focused) markNotificationsRead(mentionIds.split(','))
  }, [mentionIds, connected, focused, markNotificationsRead])

  return (
    <div className="flex h-full flex-col">
      {/* 방을 못 정한 동안(안 고름 · 목록 로딩 중 · 없는 id): 모바일은 목록, 데스크톱은 안내(방 목록은
          전역 사이드바). 정해지면 둘 다 방. channelId 가 아니라 channel 로 가르는 이유는 딥링크로
          들어온 모바일이 목록 응답 전이나 잘못된 id 에서 빈 화면이 되지 않게 하려는 것. */}
      {!channel && <ChannelList />}

      {channelId && channel ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="border-line bg-surface flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {channel.is_dm ? (
              <AtSign className="text-subtle size-4" />
            ) : channel.is_private ? (
              <Lock className="text-subtle size-4" />
            ) : (
              <Hash className="text-subtle size-4" />
            )}
            <h1 className="text-fg max-w-[60%] shrink-0 truncate text-sm font-semibold">
              {channel.name}
            </h1>
            {!channel.is_dm && channel.is_private ? (
              // 비공개 채널은 누가 보는지가 곧 내용이라 이름을 글자로 적는다(올려야 보이면 폰에서는
              // 볼 길이 없다). 누르면 멤버를 더하고 뺀다.
              <button
                type="button"
                onClick={() => setMembersOf(channel.id)}
                className="text-subtle hover:text-fg flex min-w-0 cursor-pointer items-center gap-1.5 text-xs transition-colors"
              >
                <span className="truncate">
                  {/* 인원수를 앞에 둔다. 이름은 길면 잘려서 누가 더해져도 안 보인다. */}
                  비공개 · {channel.members.length}명 ·{' '}
                  {channel.members.map((m) => m.name).join(', ')}
                </span>
                <UserPlus role="img" aria-label="멤버 더하기·빼기" className="size-3.5 shrink-0" />
              </button>
            ) : (
              <span className="text-subtle text-xs">
                {channel.is_dm ? '다이렉트 메시지' : `멤버 ${channel.members.length}명`}
              </span>
            )}

            {!connected && (
              <span
                title="npm run server 로 개발 서버를 켜면 실시간으로 주고받습니다."
                className="text-warning ml-auto flex items-center gap-1.5 text-xs"
              >
                <WifiOff className="size-3.5" />
                연결 끊김. 메시지를 주고받을 수 없습니다
              </span>
            )}
          </header>

          {/* 채널마다 새로 만든다. 과거를 받는 중이라는 표시와 스크롤 자리가 옆 채널로 새지 않게.
              아래 작성창도 채널 id 로 key 를 건다. 형제끼리 key 가 같으면 React 가 경고한다. */}
          <MessageList
            key={`messages-${channelId}`}
            channelId={channelId}
            mentionNames={mentionNames}
          />

          <div className="px-4">
            <TypingLine names={typingByChannel[channelId] ?? []} />
          </div>

          {/* key 로 채널마다 새로 만든다. 없으면 올려 둔 첨부가 채널을 옮겨도 남아, A 채널에
              올린 파일을 B 채널로 보내다 서버가 거절한다(그 URL 은 B 의 것이 아니다). */}
          <Composer
            key={channelId}
            channelId={channelId}
            channelName={channel.name}
            hash={!channel.is_dm && !channel.is_private}
            mentionCandidates={mentionCandidates}
            onTyping={() => notifyTyping(channelId)}
          />

          {membersOf === channel.id && channel.is_private && (
            <ChannelMembersModal channel={channel} onClose={() => setMembersOf(null)} />
          )}
        </div>
      ) : (
        <div className="hidden flex-1 place-items-center p-8 md:grid">
          <div className="text-center">
            <MessagesSquare className="text-subtle mx-auto size-8" />
            <p className="text-fg mt-3 text-sm font-medium">채널을 선택하세요</p>
            <p className="text-muted mt-1 text-sm">
              왼쪽에서 채널이나 대화를 고르면 메시지가 열립니다.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
