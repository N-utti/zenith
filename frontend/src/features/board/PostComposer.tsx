import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'
import { useCreatePost, useUpdatePost } from './api'
import { BOARD_BADGE, BODY_MAX, TITLE_MAX } from './types'
import type { Board, BoardPostDetail } from './types'

/**
 * 글쓰기와 글 수정이 같은 폼을 쓴다. 바뀌는 것은 처음 채워지는 값과 보내는 곳뿐이라
 * 두 벌로 나누면 제목 길이 제한 같은 규칙이 한쪽에만 붙는다.
 *
 * `post`가 있으면 수정, 없으면 새 글.
 *
 * 부르는 쪽은 **열 때 마운트한다**(`{editing && <PostComposer .../>}`). 입력을 원본에서
 * 다시 채우는 일을 effect 로 하면 리렌더가 겹치고, 리셋을 닫기 함수에 두면 Esc·바깥
 * 클릭처럼 그 함수를 안 거치는 닫기에서 지난 입력이 남는다.
 *
 * 대신 보내는 중에는 닫히지 않게 막는다. 언마운트되면 `mutate` 에 넘긴 콜백이 불리지
 * 않아서(관찰자에 리스너가 없다) 403·422 로 실패해도 화면에 아무 표시가 안 남는다.
 */
export function PostComposer({
  board,
  post,
  onClose,
}: {
  board: Board
  post?: BoardPostDetail
  onClose: () => void
}) {
  const create = useCreatePost(board.id)
  const update = useUpdatePost(board.id, post?.id ?? '')
  const mutation = post ? update : create
  const toast = useToast()
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (mutation.isPending) return
    setError(null)
    onClose()
  }

  const submit = () => {
    setError(null)
    mutation.mutate(
      { title: title.trim(), body: body.trim() },
      {
        // 모달이 닫히면 목록이 한 줄 늘거나 본문이 바뀔 뿐이라, 알리지 않으면 반영됐는지 알 수 없다.
        onSuccess: () => {
          close()
          toast.success(post ? '글을 수정했습니다.' : '글을 올렸습니다.')
        },
        // 실패는 토스트가 아니라 입력 옆에 낸다. 고칠 곳이 이 폼 안에 있다.
        onError: (err) =>
          setError(
            err instanceof ApiError
              ? err.message
              : post
                ? '글을 수정하지 못했습니다.'
                : '글을 올리지 못했습니다.',
          ),
      },
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title={post ? '글 수정' : `${board.name}에 글쓰기`}
      description={
        post
          ? '수정한 내용은 바로 반영됩니다.'
          : `${BOARD_BADGE[board.min_role]} 등급 게시판입니다. 열람 권한이 있는 사람에게만 보입니다.`
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={mutation.isPending}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!title.trim() || !body.trim() || mutation.isPending}
          >
            {mutation.isPending ? (
              <Spinner className="border-t-on-accent" />
            ) : post ? (
              '저장'
            ) : (
              '올리기'
            )}
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
              maxLength={TITLE_MAX}
              placeholder="제목을 입력하세요"
            />
          )}
        </Field>

        {/* 본문은 Enter로 제출하지 않는다. 줄바꿈을 하려다 폼이 날아간다. */}
        <Field label="내용" required error={error}>
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={BODY_MAX}
              rows={8}
              placeholder="내용을 입력하세요"
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
