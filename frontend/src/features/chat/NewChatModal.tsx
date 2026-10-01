import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { supportsPrivate, useChannels, useCreateChannel, type ChannelCreateInput } from './api'
import { useColleagues } from '@/features/people/colleagues'
import { PersonChip } from '@/features/people/PersonChip'

/** 백엔드 `ChannelCreateIn.name` 의 제약(`NonBlank`, 100자). */
const NAME_MAX = 100

/**
 * 채널을 만들거나 DM 을 연다.
 *
 * DM 상대 목록은 `GET /people`(#117) 이다. 서버가 비활성 계정까지 주고(복직하면 그 사이
 * 생긴 채널도 보여야 하므로 백엔드가 일부러 남긴다), DM 은 비활성이면 422 라 `pickable` 이
 * 미리 거른다.
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
  const me = useCurrentUser()
  const { data } = useChannels()
  const create = useCreateChannel()

  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const { people, isPending: peoplePending, isError: peopleError } = useColleagues()

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

  const submit = (input: ChannelCreateInput) => {
    setError(null)
    create.mutate(input, {
      onSuccess: (channel) => {
        onCreated()
        // 비공개를 청했으면 돌아온 채널을 대조한다. 비공개 표시가 없거나 고르지 않은 사람이 들어
        // 있으면 서버가 요청의 칸을 버렸거나 반만 따른 것이다. 채널은 이미 생겼고 지울 방법이
        // 없다. 성공이라고 말하지 않고, 놓치지 않게 오래 띄운다.
        const asked = new Set([me.id, ...(input.member_ids ?? [])])
        const leaked =
          input.is_private === true &&
          (channel.is_private !== true || channel.members.some((m) => !asked.has(m.id)))
        if (leaked) {
          toast.error(
            `${channel.name} 채널이 고른 대로 만들어지지 않았습니다. 고르지 않은 사람도 볼 수 있습니다.`,
            { durationMs: 60_000 },
          )
        } else {
          // DM 은 이미 있으면 그것을 돌려준다. 어느 쪽이든 그 대화로 들어간다.
          toast.success(
            'dm_user_id' in input
              ? `${channel.name} 님과의 대화입니다.`
              : channel.is_private
                ? `${channel.name} 비공개 채널을 만들었습니다.`
                : `#${channel.name} 채널을 만들었습니다.`,
          )
        }
        void navigate(`/chat/${channel.id}`)
      },
      // 실패는 토스트가 아니라 입력 옆에 낸다. 고칠 곳이 이 폼 안에 있다(같은 이름의 채널 409).
      onError: (err) => {
        // 목록에 보이는 사람을 눌렀는데 서버가 "없는 사용자입니다" 라고 하면 화면과 모순된다.
        // 목록을 받은 뒤 그 사람이 비활성으로 바뀌면 남는 경합이다. 드물지만 사정을 밝힌다.
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
          {(peoplePending || peopleError || people.length === 0) && (
            <li className="text-muted px-2 py-6 text-center text-sm">
              {peoplePending
                ? '불러오는 중입니다.'
                : peopleError
                  ? '사람 목록을 불러오지 못했습니다.'
                  : '대화할 수 있는 사람이 없습니다.'}
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
  // 서버가 비공개를 모르면 고르는 자리를 그리지 않는다. 보내면 공개 채널이 된다(`supportsPrivate`).
  const canPrivate = supportsPrivate(data?.items ?? [])
  // 체크 상태만 보지 않는다. 열어 둔 사이 서버가 칸을 거두면 체크만 남아 요청이 나간다.
  const priv = canPrivate && isPrivate
  const ready = trimmed !== '' && !create.isPending
  // 혼자 만들어도 된다. 사람은 나중에 채널 머리말에서 더한다.
  // 고른 뒤 명단에서 사라진 사람(그 사이 비활성)은 칩도 없으니 보내지 않는다.
  const createChannel = () =>
    submit(
      priv
        ? {
            name: trimmed,
            is_private: true,
            member_ids: memberIds.filter((id) => people.some((person) => person.id === id)),
          }
        : { name: trimmed },
    )

  return (
    <Modal
      open
      onClose={close}
      title="새 채널"
      description={
        priv
          ? '비공개 채널입니다. 고른 사람만 들어옵니다.'
          : '공개 채널입니다. 만들면 모두가 들어옵니다.'
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={create.isPending}>
            취소
          </Button>
          <Button size="sm" onClick={createChannel} disabled={!ready}>
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
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready) {
                e.preventDefault()
                createChannel()
              }
            }}
          />
        )}
      </Field>

      {canPrivate && (
        <Checkbox
          className="mt-4"
          label="비공개로 만들기"
          description="사람은 만든 뒤에도 더하고 뺄 수 있습니다."
          checked={isPrivate}
          disabled={create.isPending}
          onChange={(e) => setIsPrivate(e.target.checked)}
        />
      )}

      {priv && (
        <Field
          className="mt-4"
          label="함께할 사람"
          error={peopleError ? '사람 목록을 불러오지 못했습니다.' : null}
        >
          {(slot) => (
            <div
              role="group"
              aria-label="함께할 사람"
              aria-describedby={slot['aria-describedby']}
              className="flex flex-wrap gap-1.5"
            >
              {peoplePending && <Spinner />}
              {!peoplePending && !peopleError && people.length === 0 && (
                <p className="text-subtle text-sm">고를 수 있는 사람이 없습니다.</p>
              )}
              {people.map((person) => (
                <PersonChip
                  key={person.id}
                  person={person}
                  picked={memberIds.includes(person.id)}
                  onToggle={() =>
                    setMemberIds((ids) =>
                      ids.includes(person.id)
                        ? ids.filter((id) => id !== person.id)
                        : [...ids, person.id],
                    )
                  }
                />
              ))}
            </div>
          )}
        </Field>
      )}
    </Modal>
  )
}
