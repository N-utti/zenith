import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { useChannels, useCreateChannel } from './api'
import { useColleagues } from '@/features/people/colleagues'

/** 백엔드 `ChannelCreateIn.name` 의 제약(`NonBlank`, 100자). */
const NAME_MAX = 100

/**
 * 채널을 만들거나 DM 을 연다.
 *
 * DM 상대 목록은 **내가 속한 채널의 멤버**를 합쳐 만든다. 04 에 일반 사용자용 사용자 목록
 * 경로가 없기 때문이다. 공개 채널에는 전원이 들어가므로 이게 사실상 전체 명단이다.
 *
 * 다만 그 "전원" 에는 **비활성 계정도 들어간다**(백엔드가 일부러 넣는다. 복직하면 그 사이
 * 생긴 채널도 보여야 하므로). 그런데 DM 을 만들 때는 비활성이면 422 다. 지금은 `Person` 에
 * 활성 여부가 없어 프론트가 미리 거를 수 없다. 백엔드에 `Person.active` 를 요청해 뒀다
 * (PR 본문). 그때까지는 실패 문구로 사정을 밝힌다.
 *
 * 부르는 쪽은 열 때 마운트한다(`{open && <NewChatModal .../>}`). 폼 리셋을 닫기 함수에 두면
 * Esc·바깥 클릭처럼 그 함수를 안 거치는 닫기에서 지난 입력이 남는다.
 */
export function NewChatModal({
  mode,
  onClose,
  onCreated,
}: {
  mode: 'channel' | 'dm'
  onClose: () => void
  /** 만들고 그 대화로 들어갈 때. 취소와 달라야 한다(모바일에서는 서랍도 같이 닫힌다). */
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const { data } = useChannels()
  const create = useCreateChannel()

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { people } = useColleagues()

  /** 이미 DM 이 있는 사람. 고르면 그 대화가 열린다. 사이드바에도 이미 있으니 그렇다고 알린다. */
  const talkingTo = useMemo(
    () =>
      new Set(
        (data?.items ?? [])
          .filter((channel) => channel.is_dm)
          .flatMap((channel) => channel.members.map((m) => m.id)),
      ),
    [data],
  )

  const close = () => {
    if (create.isPending) return
    onClose()
  }

  const submit = (input: { name: string } | { dm_user_id: string }) => {
    setError(null)
    create.mutate(input, {
      onSuccess: (channel) => {
        onCreated()
        // DM 은 이미 있으면 그것을 돌려준다. 어느 쪽이든 그 대화로 들어간다.
        toast.success(
          'dm_user_id' in input
            ? `${channel.name} 님과의 대화입니다.`
            : `#${channel.name} 채널을 만들었습니다.`,
        )
        void navigate(`/chat/${channel.id}`)
      },
      // 실패는 토스트가 아니라 입력 옆에 낸다. 고칠 곳이 이 폼 안에 있다(같은 이름의 채널 409).
      onError: (err) => {
        // 목록에 보이는 사람을 눌렀는데 서버가 "없는 사용자입니다" 라고 하면 화면과 모순된다.
        // 비활성 계정이 목록에 남아 있어서 생기는 일이라 사정을 밝힌다(위 주석).
        if (mode === 'dm' && err instanceof ApiError && err.status === 422) {
          setError('지금은 이 사람과 대화를 시작할 수 없습니다. 비활성 계정일 수 있습니다.')
          return
        }
        setError(err instanceof ApiError ? err.message : '만들지 못했습니다.')
      },
    })
  }

  if (mode === 'dm') {
    return (
      <Modal open onClose={close} title="대화 상대 고르기" size="sm">
        {error && (
          <p role="alert" className="text-danger mb-2 text-sm">
            {error}
          </p>
        )}
        <ul className="-mx-2 max-h-80 overflow-y-auto">
          {people.length === 0 && (
            <li className="text-muted px-2 py-6 text-center text-sm">
              아직 같은 채널에 있는 사람이 없습니다.
            </li>
          )}
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                disabled={create.isPending}
                onClick={() => submit({ dm_user_id: person.id })}
                className="hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50"
              >
                <Avatar name={person.name} hue={hueOf(person.id)} size="sm" />
                <span className="text-fg min-w-0 flex-1 truncate text-sm">{person.name}</span>
                {talkingTo.has(person.id) && (
                  <span className="text-subtle shrink-0 text-[11px]">대화 중</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    )
  }

  const trimmed = name.trim()
  return (
    <Modal
      open
      onClose={close}
      title="새 채널"
      description="공개 채널입니다. 만들면 모두가 들어옵니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={create.isPending}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={() => submit({ name: trimmed })}
            disabled={!trimmed || create.isPending}
          >
            {create.isPending ? <Spinner className="border-t-on-accent" /> : '만들기'}
          </Button>
        </>
      }
    >
      <Field label="채널 이름" required error={error}>
        {(slot) => (
          <Input
            {...slot}
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            maxLength={NAME_MAX}
            placeholder="예: 디자인"
            onKeyDown={(e) => {
              // 한글 조합 확정 Enter 는 거른다(팔레트·작성창과 같은 규약).
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && trimmed && !create.isPending) {
                e.preventDefault()
                submit({ name: trimmed })
              }
            }}
          />
        )}
      </Field>
    </Modal>
  )
}
