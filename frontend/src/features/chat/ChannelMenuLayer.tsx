import { useState, type Dispatch, type SetStateAction } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { CheckCheck, EyeOff, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api'
import { ApiError } from '@/lib/api'
import {
  CHANNEL_NAME_MAX,
  channelNameFailure,
  checkChannelName,
  useDeleteChannel,
  useHideDm,
  useRenameChannel,
} from './api'
import { useChatSocketContext } from './ChatSocketContext'
import type { ChatChannel } from './types'

export type Point = { x: number; y: number }
/** 지금 떠 있는 것. 메뉴가 닫혀도 이름 바꾸기·지우기 창은 남는다. */
export type Open = { kind: 'menu'; at: Point } | { kind: 'rename' } | { kind: 'delete' }

/**
 * 채널은 이름 바꾸기와 지우기, DM 은 목록에서 숨기기. 안 읽은 게 있으면 읽음 표시.
 * 지우기는 서버가 지울 수 있다고 한 사람에게만 보인다(`can_delete`). 메뉴 부품은 워크스페이스
 * 트리의 것을 그대로 쓴다.
 */
export function ChannelMenuLayer({
  channel,
  open,
  setOpen,
}: {
  channel: ChatChannel
  open: Open
  setOpen: Dispatch<SetStateAction<Open | null>>
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const { connected, sendRead } = useChatSocketContext()
  const { data: notifications } = useNotifications()
  const { mutate: markNotificationsRead } = useMarkNotificationsRead()
  // 사이드바에서 다른 방을 숨기거나 지웠으면 보던 방에 그대로 둔다.
  const viewing = useMatch('/chat/:channelId')?.params.channelId === channel.id
  const rename = useRenameChannel(channel.id)
  const hide = useHideDm()
  const remove = useDeleteChannel()
  const [error, setError] = useState<string | null>(null)
  const close = () => setOpen(null)

  const markRead = () => {
    // 숫자는 서버의 `unread` 가 지운다. 멘션 알림은 따로라 채팅 화면처럼 같이 읽음으로 넘긴다.
    // 안 넘기면 헤더 알림 종의 점이 남는다.
    sendRead(channel.id)
    const mentions = (notifications?.items ?? [])
      .filter((n) => n.read_at === null && n.payload?.channel_id === channel.id)
      .map((n) => n.id)
    if (mentions.length > 0) markNotificationsRead(mentions)
  }

  const hideDm = () =>
    // 약속으로 받는다. 고르면 메뉴가 닫혀 이 층이 내려가는데, `mutate` 의 콜백은 그 뒤로 불리지 않는다.
    void hide.mutateAsync(channel.id).then(
      () => {
        toast.success(
          `${channel.name} 님과의 대화를 목록에서 숨겼습니다. 새 메시지가 오면 다시 보입니다.`,
        )
        if (viewing) void navigate('/chat')
      },
      (err: unknown) =>
        toast.error(err instanceof ApiError ? err.message : '대화를 숨기지 못했습니다.'),
    )

  const deleteChannel = () =>
    // 숨기기와 같은 이유로 약속으로 받는다.
    void remove.mutateAsync(channel.id).then(
      () => {
        // 줄이 사라지기를 기다리지 않고 닫는다. 목록을 다시 받는 사이 창이 남아 한 번 더 눌린다.
        close()
        toast.success(`${channel.name} 채널을 지웠습니다.`)
        if (viewing) void navigate('/chat')
      },
      (err: unknown) => {
        close()
        toast.error(err instanceof ApiError ? err.message : '채널을 지우지 못했습니다.')
      },
    )

  if (open.kind === 'menu')
    return (
      <ContextMenu
        at={open.at}
        label={`${channel.name} 메뉴`}
        // 항목을 고르면 그 동작 뒤에 이것이 돈다. 고른 항목이 창을 열었으면 그 창은 두고 메뉴만 닫는다.
        onClose={() => setOpen((now) => (now?.kind === 'menu' ? null : now))}
      >
        {/* 보고 있는 방은 대개 0 이라 머리줄 메뉴에는 거의 안 나온다. */}
        {channel.unread > 0 && (
          <ContextMenuItem
            icon={CheckCheck}
            label="읽음으로 표시"
            // 끊겨 있으면 읽음이 버려지고 다시 보낼 길이 없다.
            disabledReason={connected ? undefined : '연결이 끊겨 있습니다.'}
            onSelect={markRead}
          />
        )}
        {channel.is_dm ? (
          <ContextMenuItem icon={EyeOff} label="목록에서 숨기기" onSelect={hideDm} />
        ) : (
          <>
            <ContextMenuItem
              icon={Pencil}
              label="이름 바꾸기"
              onSelect={() => setOpen({ kind: 'rename' })}
            />
            {channel.can_delete && (
              <ContextMenuItem
                icon={Trash2}
                label="채널 지우기"
                danger
                onSelect={() => setOpen({ kind: 'delete' })}
              />
            )}
          </>
        )}
      </ContextMenu>
    )

  if (open.kind === 'rename')
    return (
      <FolderNameModal
        title="채널 이름 바꾸기"
        label="채널 이름"
        placeholder="예: 마케팅"
        maxLength={CHANNEL_NAME_MAX}
        initial={channel.name}
        submitLabel="저장"
        pending={rename.isPending}
        error={error}
        onDirty={() => setError(null)}
        onSubmit={(value) => {
          const checked = checkChannelName(value)
          if (checked.error) return setError(checked.error)
          // 다듬고 보니 지금 이름이면 서버도 아무것도 바꾸지 않는다. 바꿨다고 말하지 않고 닫는다.
          if (checked.name === channel.name) return close()
          rename.mutate(checked.name, {
            onSuccess: () => {
              close()
              toast.success('채널 이름을 바꿨습니다.')
            },
            onError: (err) => setError(channelNameFailure(err, '이름을 바꾸지 못했습니다.')),
          })
        }}
        onClose={close}
      />
    )

  return (
    <Modal
      open
      onClose={() => !remove.isPending && close()}
      title="채널을 지울까요?"
      description="대화와 첨부 파일이 모든 멤버에게서 사라집니다. 되돌릴 수 없습니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={remove.isPending}>
            취소
          </Button>
          <Button variant="danger" size="sm" onClick={deleteChannel} disabled={remove.isPending}>
            {remove.isPending ? <Spinner className="border-t-white" /> : '지우기'}
          </Button>
        </>
      }
    >
      <p className="text-muted text-sm leading-relaxed">
        {channel.name} · 멤버 {channel.members.length}명
      </p>
    </Modal>
  )
}
