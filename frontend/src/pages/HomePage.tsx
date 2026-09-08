import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AnnouncementsCard } from '@/features/home/AnnouncementsCard'
import { CalendarCard } from '@/features/home/CalendarCard'
import { ContinueWorkCard } from '@/features/home/ContinueWorkCard'
import { MentionsCard } from '@/features/home/MentionsCard'
import { TodayTasksCard } from '@/features/home/TodayTasksCard'
import { UnreadChatCard } from '@/features/home/UnreadChatCard'
import { useMentions } from '@/features/home/api'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useChannels } from '@/features/chat/api'
import { useCreateDoc } from '@/features/docs/api'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '늦은 시간까지 고생 많으십니다'
  if (hour < 12) return '좋은 아침이에요'
  if (hour < 18) return '안녕하세요'
  return '오늘도 수고하셨습니다'
}

const TODAY = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

export function HomePage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const createDoc = useCreateDoc()

  // 청사진의 "안 읽은 항목 N". 채널 미읽음과 멘션을 합친 수다.
  const unreadMessages =
    useChannels().data?.items.reduce((sum, channel) => sum + channel.unread, 0) ?? 0
  const unreadMentions = useMentions().data?.items.length ?? 0
  const unreadTotal = unreadMessages + unreadMentions

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-bold">
            {greeting()}, {user.name}님
          </h1>
          <p className="text-subtle mt-1.5 text-[13px]">
            {TODAY.format(new Date())}
            {unreadTotal > 0 && ` · 안 읽은 항목 ${unreadTotal}`}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() =>
              createDoc.mutate(undefined, {
                onSuccess: (doc) => void navigate(`/docs/${doc.id}`),
              })
            }
            disabled={createDoc.isPending}
          >
            <Plus className="size-4" />새 문서
          </Button>
          <Button variant="secondary" onClick={() => void navigate('/chat')}>
            <Plus className="size-4" />새 메시지
          </Button>
        </div>
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <CalendarCard />
          <ContinueWorkCard />
          <MentionsCard />
        </div>
        <div className="flex flex-col gap-6">
          <UnreadChatCard />
          <AnnouncementsCard />
          <TodayTasksCard />
        </div>
      </div>
    </>
  )
}
