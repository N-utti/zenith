import { useEffect } from 'react'
import { useParams } from 'react-router'
import { AtSign, Hash, MessagesSquare, WifiOff } from 'lucide-react'
import { useChannels, useMarkRead, useMessages } from '@/features/chat/api'
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
  const { connected, typingByChannel, notifyTyping } = useChatSocketContext()
  const { mutate: markRead } = useMarkRead()

  const channel = channels?.items.find((c) => c.id === channelId)
  const { data: messages } = useMessages(channelId ?? null)
  const latestId = messages?.items.at(-1)?.id

  // 채널을 열거나 보고 있는 동안 새 메시지가 오면 읽음으로 처리한다.
  useEffect(() => {
    if (channelId) markRead(channelId)
  }, [channelId, latestId, markRead])

  return (
    <div className="flex h-full flex-col md:flex-row">
      <ChannelList />

      {channelId && channel ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="border-line bg-surface flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {channel.kind === 'channel' ? (
              <Hash className="text-subtle size-4" />
            ) : (
              <AtSign className="text-subtle size-4" />
            )}
            <h1 className="text-fg text-sm font-semibold">{channel.name}</h1>
            <span className="text-subtle text-xs">
              {channel.kind === 'channel' ? `멤버 ${channel.memberIds.length}명` : '다이렉트 메시지'}
            </span>

            {!connected && (
              <span
                title="npm run server 로 개발 서버를 켜면 실시간으로 주고받습니다."
                className="text-warning ml-auto flex items-center gap-1.5 text-xs"
              >
                <WifiOff className="size-3.5" />
                연결 끊김. 새 메시지가 오지 않습니다
              </span>
            )}
          </header>

          <MessageList channelId={channelId} />

          <div className="px-4">
            <TypingLine names={typingByChannel[channelId] ?? []} />
          </div>

          <Composer
            channelId={channelId}
            channelName={channel.name}
            onTyping={() => notifyTyping(channelId)}
          />
        </div>
      ) : (
        <div className="grid flex-1 place-items-center p-8">
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
