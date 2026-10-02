import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { AttachmentList } from '@/features/approvals/AttachmentList'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/features/chat/api'
import { ApiError } from '@/lib/api'
import { POST_ATTACHMENTS_ENABLED, uploadPostAttachment, useCreatePost, useUpdatePost } from './api'
import { BOARD_BADGE, BODY_MAX, TITLE_MAX } from './types'
import type { Board, BoardPostDetail, PostAttachment } from './types'

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
 * 대신 보내는 중에는 닫히지 않게 막는다. 닫히면 403·422 로 실패해도 이유를 낼 폼이 없다.
 *
 * 파일은 고른 뒤 올리기(저장)를 누를 때 차례로 올리고, 받은 값을 글에 실어 저장한다. 중간에
 * 실패해도 이미 올린 파일은 붙은 채로 남는다. 다시 누르면 남은 파일만 올린다. 도는 동안 입력칸은
 * 잠근다. 요청 본문은 누른 순간의 값이라, 그 사이 고친 글은 저장되지 않고 사라진다.
 * ponytail: 글에서 뗀 파일과 저장에 실패한 글의 파일은 서버에 남는다(채팅 첨부와 같다).
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
  /** 이미 올린 파일과 아직 안 올린 파일. */
  const [attached, setAttached] = useState<PostAttachment[]>(post?.attachments ?? [])
  const [pending, setPending] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const close = () => {
    if (saving) return
    setError(null)
    onClose()
  }

  const pick = (list: FileList | null) => {
    const chosen = [...(list ?? [])]
    if (chosen.length === 0) return
    setFileError(null)
    if (attached.length + pending.length + chosen.length > MAX_ATTACHMENTS) {
      return setFileError(`파일은 ${MAX_ATTACHMENTS}개까지 붙일 수 있습니다.`)
    }
    // 서버도 막지만(422) 여기서 먼저 걸러야 10MB 를 다 올린 뒤에 거절당하지 않는다.
    const bad = chosen.find((file) => file.size === 0 || file.size > MAX_ATTACHMENT_BYTES)
    if (bad) return setFileError(`${bad.name}: 비어 있지 않은 10MB 이하 파일만 붙일 수 있습니다.`)
    setPending((prev) => [...prev, ...chosen])
  }

  const submit = async () => {
    setError(null)
    setFileError(null)
    setSaving(true)
    /** 올리던 파일. 실패 문구에 이름을 붙여 몇 번째에서 멈췄는지 보인다. */
    let current: File | null = null
    try {
      const uploaded = [...attached]
      for (const file of pending) {
        current = file
        uploaded.push(await uploadPostAttachment(board.id, file))
        setAttached([...uploaded])
        setPending((prev) => prev.filter((each) => each !== file))
      }
      current = null
      // 첨부는 건드렸을 때만 보낸다(안 보내면 서버가 그대로 둔다). 늘 보내면 오래 열어 둔 수정 창이
      // 그사이 다른 사람이 뗀 파일을 다시 붙인다. 붙이기가 꺼져 있으면 건드릴 길이 없어 안 나간다.
      const before = post?.attachments ?? []
      const touched =
        uploaded.length !== before.length || uploaded.some((file, i) => file !== before[i])
      await mutation.mutateAsync({
        title: title.trim(),
        body: body.trim(),
        ...(touched ? { attachments: uploaded } : {}),
      })
      // 모달이 닫히면 목록이 한 줄 늘거나 본문이 바뀔 뿐이라, 알리지 않으면 반영됐는지 알 수 없다.
      onClose()
      toast.success(post ? '글을 수정했습니다.' : '글을 올렸습니다.')
    } catch (err) {
      // 실패는 토스트가 아니라 입력 옆에 낸다. 고칠 곳이 이 폼 안에 있다.
      const reason = err instanceof ApiError ? err.message : null
      if (current) setFileError(`${current.name}: ${reason ?? '파일을 올리지 못했습니다.'}`)
      else setError(reason ?? (post ? '글을 수정하지 못했습니다.' : '글을 올리지 못했습니다.'))
    } finally {
      setSaving(false)
    }
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
          <Button variant="secondary" size="sm" onClick={close} disabled={saving}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={!title.trim() || !body.trim() || saving}
          >
            {saving ? <Spinner className="border-t-on-accent" /> : post ? '저장' : '올리기'}
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
              disabled={saving}
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
              disabled={saving}
              maxLength={BODY_MAX}
              rows={8}
              placeholder="내용을 입력하세요"
            />
          )}
        </Field>

        {POST_ATTACHMENTS_ENABLED && (
          <Field
            label="첨부"
            hint={`파일당 10MB, ${MAX_ATTACHMENTS}개까지. 이 게시판을 볼 수 있는 사람만 받습니다.`}
            error={fileError}
          >
            {(slot) => (
              <div role="group" aria-label="첨부" className="space-y-2">
                <AttachmentList
                  files={[...attached, ...pending]}
                  onRemove={
                    saving
                      ? undefined
                      : (index) =>
                          index < attached.length
                            ? setAttached(attached.filter((_, i) => i !== index))
                            : setPending((prev) =>
                                prev.filter((_, i) => i !== index - attached.length),
                              )
                  }
                />
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    pick(e.target.files)
                    // 같은 파일을 다시 고를 수 있게 비운다.
                    e.target.value = ''
                  }}
                />
                {/* `id` 는 넘기지 않는다. 라벨이 붙으면 버튼 이름이 "첨부" 로 덮여 보이는 글자와 갈린다. */}
                <Button
                  aria-describedby={slot['aria-describedby']}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => picker.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                  파일 붙이기
                </Button>
              </div>
            )}
          </Field>
        )}
      </div>
    </Modal>
  )
}
