import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Radio } from '@/components/ui/Checkbox'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/ToastContext'
import { PersonChips } from '@/features/people/PersonChip'
import { useColleagues } from '@/features/people/colleagues'
import { ApiError } from '@/lib/api'
import { useSetFolderAccess } from './api'
import { folderAccessChange } from './tree'
import type { Folder } from './types'

const ROLE_CHOICES: { value: Folder['min_role']; label: string; description: string }[] = [
  { value: 'member', label: '전원', description: '모든 사람이 봅니다.' },
  { value: 'lead', label: '팀장 이상', description: '팀장·임원과 아래에서 지정한 사람이 봅니다.' },
  { value: 'exec', label: '임원만', description: '임원과 아래에서 지정한 사람이 봅니다.' },
]

/**
 * 폴더 열람 권한(백엔드 #421). 등급 셋 중 하나와 그 등급이 아니어도 볼 사람. 임원만 연다(서버도 403).
 *
 * 부르는 쪽이 열 때 마운트한다(`FolderNameModal` 과 같은 이유).
 */
export function FolderAccessModal({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  // 연 때의 값과 비교한다. 창이 열린 사이 트리를 다시 받아 `folder` 가 바뀌어도(다른 임원이 고침)
  // 손대지 않은 칸을 옛 값으로 되돌려 보내지 않는다.
  const [base] = useState(folder)
  const [minRole, setMinRole] = useState(base.min_role)
  const [picked, setPicked] = useState(base.allowed_users)
  const radioName = useId()
  const peopleLabel = useId()
  const { people, isPending: loadingPeople, isError: peopleFailed } = useColleagues()
  const save = useSetFolderAccess()
  const toast = useToast()

  const change = folderAccessChange(base, minRole, picked)
  // 명단(`/people`)은 나와 비활성 계정을 빼고 준다. 그런 사람도 지정에서 지우지 않고 그대로 둔다.
  const unlisted = loadingPeople
    ? 0
    : picked.filter((id) => !people.some((p) => p.id === id)).length

  const close = () => {
    if (save.isPending) return
    onClose()
  }
  // 약속으로 받는다. 창이 닫혀 언마운트되면 `mutate` 의 콜백은 불리지 않는다.
  const submit = () => {
    if (!change || save.isPending) return
    // 실패는 `save.error` 가 창 안에 보인다. 받아 두지 않으면 처리 안 된 거절로 남는다.
    void save.mutateAsync({ id: folder.id, ...change }).then(
      () => {
        toast.success(`${folder.title} 폴더의 열람 권한을 바꿨습니다.`)
        onClose()
      },
      () => undefined,
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title={`${folder.title} 열람 권한`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={save.isPending}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={!change || save.isPending}>
            {save.isPending ? <Spinner className="border-t-on-accent" /> : '저장'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-fg mb-2 text-sm font-medium">볼 수 있는 등급</legend>
          {ROLE_CHOICES.map((choice) => (
            <Radio
              key={choice.value}
              name={radioName}
              checked={minRole === choice.value}
              onChange={() => {
                setMinRole(choice.value)
                // 다시 고치기 시작하면 실패 문구를 지운다(`FolderNameModal` 과 같다).
                save.reset()
              }}
              label={choice.label}
              description={choice.description}
            />
          ))}
        </fieldset>

        <div role="group" aria-labelledby={peopleLabel}>
          <p id={peopleLabel} className="text-fg mb-2 text-sm font-medium">
            따로 볼 사람
          </p>
          {minRole === 'member' ? (
            <p className="text-subtle text-xs">
              전원이 보는 폴더라 따로 지정하지 않습니다.
              {picked.length > 0 && ` 저장하면 지정한 ${picked.length}명이 빠집니다.`}
            </p>
          ) : loadingPeople ? (
            <Spinner />
          ) : peopleFailed ? (
            <p className="text-danger text-xs">사람 목록을 불러오지 못했습니다.</p>
          ) : (
            <>
              <PersonChips
                people={people}
                picked={picked}
                onToggle={(id) => {
                  setPicked((prev) =>
                    prev.includes(id) ? prev.filter((each) => each !== id) : [...prev, id],
                  )
                  save.reset()
                }}
              />
              {unlisted > 0 && (
                <p className="text-subtle mt-2 text-xs">
                  목록에 없는 {unlisted}명(나, 비활성 계정)은 그대로 둡니다.
                </p>
              )}
            </>
          )}
        </div>

        <p className="text-subtle text-xs leading-relaxed">
          아래 폴더와 문서도 이 설정을 따릅니다. 위 폴더가 막혀 있으면 여기서 지정한 사람도 볼 수
          없습니다. 제한이 걸린 폴더를 오가는 이동은 임원만 할 수 있습니다.
        </p>

        {save.isError && (
          <p role="alert" className="text-danger text-sm">
            {save.error instanceof ApiError ? save.error.message : '열람 권한을 바꾸지 못했습니다.'}
          </p>
        )}
      </div>
    </Modal>
  )
}
