import { useRef, useState, type ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { MentionText } from '@/features/people/MentionText'
import { ApiError } from '@/lib/api'
import { hueOf } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/datetime'

/** 줄이 그리는 데 쓰는 칸. 문서 댓글과 게시글 댓글이 같은 모양이다. */
export interface RowComment {
  id: string
  author: { id: string; name: string }
  body: string
  created_at: string
  /** 고친 시각. 고친 적이 없거나 서버가 이 칸을 안 주면 비어 있다. */
  edited_at?: string | null
}

/*
 * 내 댓글 줄의 작은 버튼(고치기·지우기). 줄 위에 올리거나 Tab 으로 닿을 때만 보이고, 호버가 없는
 * 기기에서는 늘 보인다. 숨어 있을 때는 눌리지도 않는다(할 일 카드의 버튼과 같은 규약).
 * -my-1: 이름 줄(16px)보다 큰 버튼이 줄 높이를 키우지 않게 한다.
 */
const ROW_ACTION =
  'text-subtle pointer-events-none -my-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-focus-within/comment:pointer-events-auto group-focus-within/comment:opacity-100 group-hover/comment:pointer-events-auto group-hover/comment:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100'

/**
 * 댓글 한 줄. 문서 댓글(옆 패널·블록 옆 창)과 게시글 댓글이 같이 쓴다. `children` 은 이름과 본문
 * 사이(문서 댓글의 블록 인용)다.
 *
 * 누가 고치고 지울 수 있는지와 서버에 보내는 일은 부르는 쪽이 정한다(`canEdit`·`canDelete`,
 * `onSave`·`onRemove`). 버튼을 감추는 것은 화면 편의일 뿐이고 실제 차단은 서버의 403 이다.
 * 고치기는 그 줄에서 글 칸이 열린다. `onDelete` 는 지우기를 시작한 직후에 불린다.
 */
export function CommentRow({
  comment,
  names,
  id,
  canEdit,
  canDelete,
  maxLength,
  onSave,
  onRemove,
  onDelete,
  children,
}: {
  comment: RowComment
  /** 본문에서 배지로 그릴 이름들. 멘션을 쓰지 않는 곳은 빈 집합을 준다. */
  names: ReadonlySet<string>
  id?: string
  canEdit: boolean
  canDelete: boolean
  maxLength: number
  /** 고친 글을 저장한다. 목록을 다시 받은 뒤에 풀리는 약속이어야 옛 글이 잠깐 비치지 않는다. */
  onSave: (body: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  onDelete?: () => void
  children?: ReactNode
}) {
  const toast = useToast()
  /** 고치는 중인 글. 고치는 중이 아니면 `null`. */
  const [draft, setDraft] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const row = useRef<HTMLDivElement>(null)

  /** 고치는 칸을 닫는다. 칸이 사라지면 초점이 body 로 떨어지므로 이 줄로 돌려놓는다. */
  const closeEdit = () => {
    setDraft(null)
    row.current?.focus({ preventScroll: true })
  }

  const save = () => {
    if (draft === null || saving) return
    const next = draft.trim()
    // 비우면 저장하지 않는다. 댓글을 없애려면 지우기를 쓴다.
    if (!next) return
    if (next === comment.body) return closeEdit()
    setEditError(null)
    setSaving(true)
    onSave(next)
      .then(
        closeEdit,
        // 고치던 글 바로 아래에 낸다. 토스트로 내면 무엇이 안 됐는지와 고칠 곳이 떨어진다.
        (err: unknown) =>
          setEditError(err instanceof ApiError ? err.message : '댓글을 고치지 못했습니다.'),
      )
      .finally(() => setSaving(false))
  }

  return (
    <div
      ref={row}
      id={id}
      // 고치기를 끝내면 초점이 여기로 온다(tabIndex). 블록 옆 창은 고치는 줄이 있는 동안 닫히지
      // 않는다. 닫히면 쓰던 글이 줄과 함께 사라진다(`BlockComments` 가 이 표시를 본다).
      tabIndex={-1}
      data-comment-editing={draft !== null || undefined}
      className="group/comment -mx-2 flex gap-2.5 rounded-lg px-2 py-1"
    >
      <Avatar name={comment.author.name} hue={hueOf(comment.author.id)} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="text-fg min-w-0 flex-1 text-xs font-medium">
            {comment.author.name}
            <span className="text-subtle ml-1.5 font-normal">
              {formatRelative(comment.created_at)}
              {comment.edited_at && ' · 수정됨'}
            </span>
          </p>
          {canEdit && draft === null && (
            <button
              type="button"
              aria-label={`${formatRelative(comment.created_at)} 댓글 고치기`}
              title="댓글 고치기"
              onClick={() => {
                setEditError(null)
                setDraft(comment.body)
              }}
              className={cn(ROW_ACTION, 'hover:text-fg')}
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label={`${formatRelative(comment.created_at)} 댓글 삭제`}
              title="댓글 삭제"
              disabled={removing}
              onClick={() => {
                if (!confirm('이 댓글을 지울까요? 되돌릴 수 없습니다.')) return
                setRemoving(true)
                // 이 줄이 사라져도(창 닫기, 탭 바꾸기) 약속에 붙인 처리는 돈다.
                onRemove()
                  .catch((err: unknown) => {
                    toast.error(err instanceof ApiError ? err.message : '댓글을 지우지 못했습니다.')
                  })
                  .finally(() => setRemoving(false))
                onDelete?.()
              }}
              className={cn(ROW_ACTION, 'hover:text-danger')}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        {children}
        {draft !== null ? (
          <div className="mt-1">
            {/* ponytail: 멘션 자동 완성 없이 글자로만 고친다(채팅 메시지 고치기와 같다). 이미 쓴
                `@이름` 은 그대로 남는다. 사람 목록은 입력칸 위로 뜨는데, 이 줄은 스크롤되는 목록
                안이라 첫 줄에서는 목록이 잘린다. */}
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setEditError(null)
              }}
              submitOnEnter
              onSubmitEnter={save}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                // 블록 옆 창은 Esc 로 창째 닫힌다. 고치기만 그만두고 창은 둔다.
                e.stopPropagation()
                // 한글을 조합하는 중의 Esc 는 조합만 취소한다. 쓰던 글까지 버리지 않는다.
                if (!e.nativeEvent.isComposing) closeEdit()
              }}
              rows={Math.min(6, Math.max(draft.split('\n').length, Math.ceil(draft.length / 30)))}
              maxLength={maxLength}
              aria-label="댓글 고치기"
              aria-invalid={editError ? true : undefined}
              className="w-full resize-none"
            />
            {editError && (
              <p role="alert" className="text-danger mt-1 text-xs">
                {editError}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={!draft.trim() || saving}>
                {saving ? <Spinner className="border-t-on-accent" /> : '저장'}
              </Button>
              <Button size="sm" variant="secondary" onClick={closeEdit} disabled={saving}>
                취소
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted mt-0.5 text-sm break-words whitespace-pre-wrap">
            <MentionText body={comment.body} names={names} />
          </p>
        )}
      </div>
    </div>
  )
}
