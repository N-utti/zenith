import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useCreatePost } from './api'
import type { Board } from './types'

export function PostComposer({
  board,
  open,
  onClose,
}: {
  board: Board
  open: boolean
  onClose: () => void
}) {
  const create = useCreatePost(board.id)
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setTitle('')
    setBody('')
    setError(null)
    onClose()
  }

  const submit = () => {
    setError(null)
    create.mutate(
      { title, body },
      {
        // 모달이 닫히면 목록이 한 줄 늘 뿐이라, 알리지 않으면 올라갔는지 알 수 없다.
        onSuccess: () => {
          close()
          toast.success('글을 올렸습니다.')
        },
        // 실패는 토스트가 아니라 입력 옆에 낸다 — 고칠 곳이 이 폼 안에 있다.
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : '글을 올리지 못했습니다.'),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`${board.name}에 글쓰기`}
      description={`${board.badge} 등급 게시판입니다. 열람 권한이 있는 사람에게만 보입니다.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!title.trim() || !body.trim() || create.isPending}
          >
            {create.isPending ? <Spinner className="border-t-on-accent" /> : '올리기'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="제목" required>
          {(slot) => (
            <Input
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
            />
          )}
        </Field>

        {/* 본문은 Enter로 제출하지 않는다 — 줄바꿈을 하려다 폼이 날아간다. */}
        <Field label="내용" required error={error}>
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="내용을 입력하세요"
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
