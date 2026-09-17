import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'

/** 백엔드 `NonBlank` 제약(`routers/docs.py`). 공백만 있는 이름은 422. */
export const FOLDER_TITLE_MAX = 200

/**
 * 폴더 이름을 받는 작은 대화상자. 새 폴더와 이름 변경이 같은 폼을 쓴다.
 *
 * 부르는 쪽이 열 때 마운트한다. 처음 값을 다시 채우는 일을 effect 로 하면 리렌더가 겹치고,
 * 리셋을 닫기 함수에 두면 Esc·바깥 클릭으로 닫을 때 지난 입력이 남는다(`PostComposer` 와 같다).
 */
export function FolderNameModal({
  title,
  initial = '',
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  initial?: string
  submitLabel: string
  pending: boolean
  error: string | null
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const trimmed = value.trim()

  const close = () => {
    if (pending) return
    onClose()
  }

  return (
    <Modal
      open
      onClose={close}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={() => onSubmit(trimmed)}
            disabled={!trimmed || trimmed === initial.trim() || pending}
          >
            {pending ? <Spinner className="border-t-on-accent" /> : submitLabel}
          </Button>
        </>
      }
    >
      <Field label="폴더 이름" required error={error}>
        {(slot) => (
          <Input
            {...slot}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={FOLDER_TITLE_MAX}
            placeholder="예: 회의록"
            onKeyDown={(e) => {
              // 한글 조합 확정 Enter 는 거른다(팔레트·작성창과 같은 규약).
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && trimmed && !pending) {
                e.preventDefault()
                onSubmit(trimmed)
              }
            }}
          />
        )}
      </Field>
    </Modal>
  )
}
