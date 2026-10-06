import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EyeOff, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { FolderNameModal } from '@/features/docs/FolderNameModal'
import { ApiError } from '@/lib/api'
import {
  CHANNEL_NAME_MAX,
  channelNameFailure,
  checkChannelName,
  useDeleteChannel,
  useHideDm,
  useRenameChannel,
} from './api'
import type { ChatChannel } from './types'

/**
 * 채팅 화면 머리줄의 더보기 버튼. 채널은 이름 바꾸기와 지우기, DM 은 목록에서 숨기기.
 * 지우기는 서버가 지울 수 있다고 한 사람에게만 보인다(`can_delete`).
 *
 * 자리는 사이드바의 방 줄 우클릭이 아니라 여기다. 우클릭 메뉴는 아이폰에서 안 뜬다.
 * 메뉴 부품은 워크스페이스 트리의 것을 그대로 쓴다. 버튼 바로 아래에 띄운다.
 */
export function ChannelMenu({ channel }: { channel: ChatChannel }) {
  const toast = useToast()
  const navigate = useNavigate()
  const rename = useRenameChannel(channel.id)
  const hide = useHideDm()
  const remove = useDeleteChannel()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  /** 누르기 시작한 순간 메뉴가 열려 있었는가. 뗄 때는 이미 닫혀 있어 그때의 상태로는 알 수 없다. */
  const wasOpen = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  const deleteChannel = () =>
    // 숨기기와 같은 이유로 약속으로 받는다. 지우면 이 버튼도 같이 없어진다.
    void remove.mutateAsync(channel.id).then(
      () => {
        toast.success(`${channel.name} 채널을 지웠습니다.`)
        void navigate('/chat')
      },
      (err: unknown) => {
        setDeleting(false)
        toast.error(err instanceof ApiError ? err.message : '채널을 지우지 못했습니다.')
      },
    )

  return (
    <>
      <button
        type="button"
        aria-label={`${channel.name} 더보기`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        title="더보기"
        // 열린 채로 다시 누르면 닫는다. 메뉴는 누르는 순간 스스로 닫힌다(바깥 누름, 초점이 이
        // 버튼으로 옮겨 감). 그래서 뗄 때 보면 늘 닫혀 있고, 그대로 두면 이 클릭이 다시 연다.
        onPointerDown={() => (wasOpen.current = at !== null)}
        onClick={(e) => {
          if (wasOpen.current) return setAt(null)
          const rect = e.currentTarget.getBoundingClientRect()
          setAt({ x: rect.left, y: rect.bottom + 4 })
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
            <>
              <ContextMenuItem
                icon={Pencil}
                label="이름 바꾸기"
                onSelect={() => {
                  setError(null)
                  setRenaming(true)
                }}
              />
              {channel.can_delete && (
                <ContextMenuItem
                  icon={Trash2}
                  label="채널 지우기"
                  danger
                  onSelect={() => setDeleting(true)}
                />
              )}
            </>
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
          onSubmit={(value) => {
            const checked = checkChannelName(value)
            if (checked.error) return setError(checked.error)
            // 다듬고 보니 지금 이름이면 서버도 아무것도 바꾸지 않는다. 바꿨다고 말하지 않고 닫는다.
            if (checked.name === channel.name) return setRenaming(false)
            rename.mutate(checked.name, {
              onSuccess: () => {
                setRenaming(false)
                toast.success('채널 이름을 바꿨습니다.')
              },
              onError: (err) => setError(channelNameFailure(err, '이름을 바꾸지 못했습니다.')),
            })
          }}
          onClose={() => setRenaming(false)}
        />
      )}

      {deleting && (
        <Modal
          open
          onClose={() => !remove.isPending && setDeleting(false)}
          title="채널을 지울까요?"
          description="대화와 첨부 파일이 모든 멤버에게서 사라집니다. 되돌릴 수 없습니다."
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleting(false)}
                disabled={remove.isPending}
              >
                취소
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={deleteChannel}
                disabled={remove.isPending}
              >
                {remove.isPending ? <Spinner className="border-t-white" /> : '지우기'}
              </Button>
            </>
          }
        >
          <p className="text-muted text-sm leading-relaxed">
            {channel.name} · 멤버 {channel.members.length}명
          </p>
        </Modal>
      )}
    </>
  )
}
