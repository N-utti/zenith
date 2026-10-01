import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/ToastContext'
import { useCurrentUser } from '@/features/auth/AuthContext'
import { useColleagues } from '@/features/people/colleagues'
import { PersonChips } from '@/features/people/PersonChip'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { useAddMembers, useRemoveMember } from './api'
import type { ChatChannel } from './types'

/**
 * 비공개 채널의 멤버를 보고, 더하고, 뺀다. 멤버면 누구나 한다(채널에 주인이 없다).
 *
 * 명단은 `channel.members` 그대로다. 더하거나 빼면 채널 목록을 다시 받고, 그 응답이 이 명단을
 * 바꾼다(낙관적 갱신 없음). 내가 빠지면 채널이 목록에서 사라져 `ChatPage` 가 이 모달째 닫는다.
 *
 * 남을 빼는 것은 묻지 않는다. 다시 더하면 된다(비활성 계정만 예외다. 고르는 명단에 없다).
 * 나가기만 한 번 더 묻는다. 나간 사람은 스스로 돌아올 수 없다.
 */
export function ChannelMembersModal({
  channel,
  onClose,
}: {
  channel: ChatChannel
  onClose: () => void
}) {
  const me = useCurrentUser()
  const toast = useToast()
  const navigate = useNavigate()
  const { people, isPending: peoplePending, isError: peopleError } = useColleagues()
  const add = useAddMembers(channel.id)
  const remove = useRemoveMember(channel.id)

  const [picked, setPicked] = useState<string[]>([])
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busy = add.isPending || remove.isPending
  const memberIds = new Set(channel.members.map((member) => member.id))
  const outsiders = people.filter((person) => !memberIds.has(person.id))
  // 고른 뒤 누가 먼저 더했거나 명단에서 빠졌으면 그 사람은 보내지 않는다.
  const toAdd = picked.filter((id) => outsiders.some((person) => person.id === id))

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : '바꾸지 못했습니다.')

  const leave = () => {
    setError(null)
    remove.mutate(me.id, {
      onSuccess: () => {
        toast.success(`${channel.name} 채널에서 나갔습니다.`)
        onClose()
        void navigate('/chat')
      },
      onError: fail,
    })
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={`${channel.name} 멤버`}
      description="멤버만 보는 채널입니다. 멤버가 더하고 뺍니다."
      size="sm"
    >
      {error && (
        <p role="alert" className="text-danger mb-2 text-sm">
          {error}
        </p>
      )}

      <ul className="-mx-2">
        {channel.members.map((member) => {
          const mine = member.id === me.id
          return (
            <li key={member.id} className="flex items-center gap-2.5 px-2 py-1">
              <Avatar name={member.name} hue={hueOf(member.id)} size="sm" />
              <span className="text-fg min-w-0 flex-1 truncate text-sm">
                {member.name}
                {mine && <span className="text-subtle"> (나)</span>}
              </span>
              {mine && leaving ? (
                // 확정을 왼쪽에 둔다. 방금 누른 자리에 확정이 오면 더블클릭이 그대로 나가기가 된다.
                <>
                  <Button variant="danger" size="sm" disabled={busy} onClick={leave}>
                    나가기
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setLeaving(false)}
                  >
                    취소
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={mine ? '채널에서 나가기' : `${member.name} 빼기`}
                  onClick={() => {
                    setError(null)
                    if (mine) setLeaving(true)
                    else remove.mutate(member.id, { onError: fail })
                  }}
                >
                  {mine ? '나가기' : '빼기'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {leaving && (
        <p className="text-muted mt-1 text-xs">
          {channel.members.length === 1
            ? '마지막 멤버입니다. 나가면 이 채널과 대화를 아무도 볼 수 없습니다.'
            : '나가면 이 채널이 안 보입니다. 다시 들어오려면 멤버가 더해 줘야 합니다.'}
        </p>
      )}

      <h3 className="text-fg mt-5 mb-1.5 text-sm font-medium">사람 더하기</h3>
      {outsiders.length === 0 ? (
        <p className="text-subtle text-sm">
          {peoplePending
            ? '불러오는 중입니다.'
            : peopleError
              ? '사람 목록을 불러오지 못했습니다.'
              : '더할 수 있는 사람이 없습니다.'}
        </p>
      ) : (
        <>
          <div role="group" aria-label="더할 사람">
            <PersonChips
              people={outsiders}
              picked={picked}
              onToggle={(id) =>
                setPicked((ids) =>
                  ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id],
                )
              }
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={toAdd.length === 0 || busy}
              onClick={() => {
                setError(null)
                add.mutate(toAdd, { onSuccess: () => setPicked([]), onError: fail })
              }}
            >
              {toAdd.length > 0 ? `${toAdd.length}명 더하기` : '더하기'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
