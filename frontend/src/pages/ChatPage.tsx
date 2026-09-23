import { useEffect } from 'react'
import { useParams } from 'react-router'
import { AtSign, Hash, MessagesSquare, WifiOff } from 'lucide-react'
import { useChannels, useMessages } from '@/features/chat/api'
import { ChannelList } from '@/features/chat/ChannelList'
import { Composer } from '@/features/chat/Composer'
import { MessageList } from '@/features/chat/MessageList'
import { useChatSocketContext } from '@/features/chat/ChatSocketContext'

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

  const channel = channels?.items.find((c) => c.id === channelId)
  const { data: messages } = useMessages(channelId ?? null)
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

  return (
    <div className="flex h-full flex-col">
      {/* 방을 못 정한 동안(안 고름 · 목록 로딩 중 · 없는 id): 모바일은 목록, 데스크톱은 안내(방 목록은
          전역 사이드바). 정해지면 둘 다 방. channelId 가 아니라 channel 로 가르는 이유는 딥링크로
          들어온 모바일이 목록 응답 전이나 잘못된 id 에서 빈 화면이 되지 않게 하려는 것. */}
      {!channel && <ChannelList />}

      {channelId && channel ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="border-line bg-surface flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {!channel.is_dm ? (
              <Hash className="text-subtle size-4" />
            ) : (
              <AtSign className="text-subtle size-4" />
            )}
            <h1 className="text-fg text-sm font-semibold">{channel.name}</h1>
            <span className="text-subtle text-xs">
              {!channel.is_dm ? `멤버 ${channel.members.length}명` : '다이렉트 메시지'}
            </span>

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

          <MessageList channelId={channelId} />

          <div className="px-4">
            <TypingLine names={typingByChannel[channelId] ?? []} />
          </div>

          {/* key 로 채널마다 새로 만든다. 없으면 올려 둔 첨부가 채널을 옮겨도 남아, A 채널에
              올린 파일을 B 채널로 보내다 서버가 거절한다(그 URL 은 B 의 것이 아니다). */}
          <Composer
            key={channelId}
            channelId={channelId}
            channelName={channel.name}
            isDm={channel.is_dm}
            onTyping={() => notifyTyping(channelId)}
          />
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
