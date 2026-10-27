import { useNavigate } from 'react-router'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useChannels, useCreateChannel } from './api'
import type { ChatChannel } from './types'

/** 내 목록에 있는 그 사람과의 DM. DM 은 늘 둘이다. */
export function findDm(channels: ChatChannel[], personId: string): ChatChannel | undefined {
  return channels.find(
    (channel) => channel.is_dm && channel.members.some((member) => member.id === personId),
  )
}

/**
 * 그 사람과의 DM 으로 간다. 내 목록에 있으면 서버에 묻지 않고, 없으면 연다.
 * 숨긴 DM 도 여는 쪽으로 간다. 서버가 같은 두 사람의 방을 돌려주고 목록에 되살린다.
 *
 * 부르는 쪽(프로필 카드·⌘K)은 부르자마자 닫혀 이 훅도 사라진다. `mutate` 의 콜백은 그 뒤로
 * 불리지 않아서 약속(`mutateAsync`)으로 받는다.
 */
export function useOpenDm(): (personId: string) => void {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateChannel()
  const { data: channels } = useChannels()
  return (personId) => {
    const dm = findDm(channels?.items ?? [], personId)
    if (dm) return void navigate(`/chat/${dm.id}`)
    create.mutateAsync({ dm_user_id: personId }).then(
      (channel) => void navigate(`/chat/${channel.id}`),
      // 비활성 계정은 422 다(`NewChatModal`).
      (err: unknown) =>
        toast.error(
          err instanceof ApiError && err.status === 422
            ? '지금은 이 사람과 대화를 시작할 수 없습니다. 비활성 계정일 수 있습니다.'
            : '대화를 열지 못했습니다.',
        ),
    )
  }
}
