import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AnnouncementsCard } from '@/features/home/AnnouncementsCard'
import { CalendarCard } from '@/features/home/CalendarCard'
import { ContinueWorkCard } from '@/features/home/ContinueWorkCard'
import { MentionsCard } from '@/features/home/MentionsCard'
import { OnboardingCard } from '@/features/home/OnboardingCard'
import { TodayTasksCard } from '@/features/home/TodayTasksCard'
import { useMentions } from '@/features/home/api'
import { countUnread } from '@/features/notifications/view'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { NewDocModal } from '@/features/docs/NewDocModal'

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
  const [creatingDoc, setCreatingDoc] = useState(false)

  // 청사진의 "안 읽은 항목 N". 홈 멘션 카드에 실리는 알림 중 안 읽은 것만 센다. 서버는 읽은
  // 알림까지 최근 열 건을 주므로 개수를 그대로 쓰면 다 읽어도 숫자가 남는다. 채팅 안 읽음은
  // 사이드바·탭바 배지가 맡아 여기 더하지 않는다.
  const unreadTotal = countUnread(useMentions().data ?? [])

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
          <Button onClick={() => setCreatingDoc(true)}>
            <Plus className="size-4" />새 문서
          </Button>
          <Button variant="secondary" onClick={() => void navigate('/chat')}>
            <Plus className="size-4" />새 메시지
          </Button>
        </div>
      </div>

      <OnboardingCard />

      {/* 1단(모바일)일 때만 순서를 다시 세운다. 오늘 할 일이 맨 위(폰에서는 확인하고 체크하는 일이
          먼저다), 그 아래는 05 홈 순서(이어서 작업 → 멘션 → 공지), 05 에 없는 캘린더는 맨 뒤.
          lg 부터는 order 를 지우고 기존 2열 격자대로. 안 읽은 메시지 카드는 사이드바 채널·DM
          옆 숫자와 같은 것이라 뺐다.
          `contents` 로 열 래퍼를 없애 다섯 카드가 그리드의 한 열에서 함께 순서를 갖게 한다.
          grid-cols-1 은 minmax(0,1fr) 라서, 가로로 구르는 이어서 작업 줄이 칸을 밀어 넓히지 못한다.
          감수한 것: 1단에서 보이는 순서와 코드 순서(스크린리더·Tab)가 다르다. 코드 순서를 모바일에
          맞추면 lg 2열을 두 flex 열로 나눌 수 없어 카드 높이가 행마다 맞춰지며 빈칸이 생긴다. */}
      <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-4 lg:order-none">
            <CalendarCard />
          </div>
          <div className="order-1 lg:order-none">
            <ContinueWorkCard onCreate={() => setCreatingDoc(true)} />
          </div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-3 lg:order-none">
            <AnnouncementsCard />
          </div>
          <div className="order-first lg:order-none">
            <TodayTasksCard />
          </div>
          <div className="order-2 lg:order-none">
            <MentionsCard />
          </div>
        </div>
      </div>

      {/* 헤더 버튼과 "이어서 작업"의 빈 목록 버튼이 같이 연다. */}
      {creatingDoc && <NewDocModal onClose={() => setCreatingDoc(false)} />}
    </>
  )
}
