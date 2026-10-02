import { useState } from 'react'
import { useNavigate } from 'react-router'
import { EyeOff, MoreHorizontal, Pencil } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { useToast } from '@/components/ui/ToastContext'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { ApiError } from '@/lib/api'
import { CHANNEL_NAME_MAX, useHideDm, useRenameChannel } from './api'
import type { ChatChannel } from './types'

/**
 * 채팅 화면 머리줄의 더보기 버튼. 채널은 이름 바꾸기, DM 은 목록에서 숨기기.
 *
 * 자리는 사이드바의 방 줄 우클릭이 아니라 여기다. 우클릭 메뉴는 아이폰에서 안 뜬다.
 * 메뉴 부품은 워크스페이스 트리의 것을 그대로 쓴다. 버튼 바로 아래에 띄운다.
 */
export function ChannelMenu({ channel }: { channel: ChatChannel }) {
  const toast = useToast()
  const navigate = useNavigate()
  const rename = useRenameChannel(channel.id)
  const hide = useHideDm()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hideDm = () =>
    // 약속으로 받는다. 숨기면 이 방이 목록에서 사라져 이 버튼도 같이 없어지는데, `mutate` 의
    // 콜백은 그 뒤로 불리지 않는다.
    void hide.mutateAsync(channel.id).then(
      () => {
        toast.success(
          `${channel.name} 님과의 대화를 목록에서 숨겼습니다. 새 메시지가 오면 다시 보입니다.`,
        )
        void navigate('/chat')
      },
      (err: unknown) =>
        toast.error(err instanceof ApiError ? err.message : '대화를 숨기지 못했습니다.'),
    )

  return (
    <>
      <button
        type="button"
        aria-label={`${channel.name} 더보기`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        title="더보기"
        // 열린 채로 다시 누르면 닫는다. 메뉴는 바깥을 누르는 순간 스스로 닫히는데, 그게 여기까지
        // 오면 닫혔다가 이 클릭으로 다시 열린다.
        onPointerDown={(e) => at && e.stopPropagation()}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setAt(at ? null : { x: rect.left, y: rect.bottom + 4 })
        }}
        className="text-subtle hover:bg-surface-hover hover:text-fg grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {at && (
        <ContextMenu at={at} label={`${channel.name} 메뉴`} onClose={() => setAt(null)}>
          {channel.is_dm ? (
            <ContextMenuItem icon={EyeOff} label="목록에서 숨기기" onSelect={hideDm} />
          ) : (
            <ContextMenuItem
              icon={Pencil}
              label="이름 바꾸기"
              onSelect={() => {
                setError(null)
                setRenaming(true)
              }}
            />
          )}
        </ContextMenu>
      )}

      {renaming && (
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
          onSubmit={(name) =>
            rename.mutate(name, {
              onSuccess: () => {
                setRenaming(false)
                toast.success('채널 이름을 바꿨습니다.')
              },
              onError: (err) =>
                setError(err instanceof ApiError ? err.message : '이름을 바꾸지 못했습니다.'),
            })
          }
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  )
}
