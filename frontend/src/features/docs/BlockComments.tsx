import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { MentionTextarea } from '@/features/people/MentionTextarea'
import { useMentionNames } from '@/features/people/colleagues'
import { useAddComment, useComments } from './api'
import { findBlock, firstRowTableAnchor } from './blockId'
import { CommentRow } from './CommentPanel'
import { COMMENT_BODY_MAX, type DocComment } from './types'

/** 본문 상자의 오른쪽 여백(px-6). 말풍선이 드는 자리다. */
const GUTTER = 24

/** 말풍선 높이(h-7). 본문 한 줄 높이와 같다. */
const MARKER = 28

/** 이보다 긴 블록(큰 표, 긴 문단)은 창을 블록 아래가 아니라 말풍선 아래에 띄운다. */
const TALL = 200

/** 기준 상자에서 잰 블록의 자리. `overhang` 은 본문 폭 밖으로 뻗은 만큼이다(넓은 표). */
type Spot = { top: number; bottom: number; overhang: number }

/** `ids` 에 든 닻 블록들이 기준 상자(`base`)에서 어디에 있는지. 지워진 블록은 빠진다. */
function measureSpots(editor: Editor, base: DOMRect, ids: Set<string>): Record<string, Spot> {
  const spots: Record<string, Spot> = {}
  if (ids.size === 0) return spots
  editor.state.doc.descendants((node, pos) => {
    const id = node.attrs.blockId as string | null | undefined
    if (!id || !ids.has(id)) return
    const el = editor.view.nodeDOM(pos)
    if (!(el instanceof HTMLElement)) return
    const rect = el.getBoundingClientRect()
    spots[id] = {
      top: Math.round(rect.top - base.top),
      bottom: Math.round(rect.bottom - base.top),
      overhang: Math.max(0, Math.round(rect.right - base.right)),
    }
  })
  return spots
}

/**
 * 블록에 달린 댓글을 본문의 그 블록 옆에 보인다(05 SCR-02, FR-DOC-04).
 *
 * 댓글이 달린 블록의 오른쪽 여백에 말풍선과 개수를 두고, 누르면 그 블록 곁에 그 블록의 댓글과
 * 입력칸이 든 창을 띄운다. 손잡이·툴바의 「이 블록에 댓글」도 이 창을 연다(`openId`).
 *
 * 편집기 DOM 에 끼워 넣지 않고 편집기 앞의 높이 0 상자를 기준으로 겹쳐 그린다(행 옆 표 버튼과 같은
 * 방식). 편집기 안에 넣으면 ProseMirror 가 그 DOM 을 본문으로 읽으려 들고, 표·사진 같은 노드 뷰
 * 에는 붙일 자리도 없다. 대신 블록의 자리를 재야 한다: 본문이 바뀌거나 편집기 크기가 바뀔 때.
 */
export function BlockComments({
  editor,
  docId,
  openId,
  onOpenChange,
  rowMenu,
}: {
  editor: Editor
  docId: string
  /** 창이 열린 블록. 손잡이·툴바로 여는 것은 바깥(DocSurface)이 정한다. */
  openId: string | null
  onOpenChange: (blockId: string | null) => void
  /** 행 옆 표 버튼(TableRowMenu)이 뜨는 기기인지. 손가락 기기에는 없다. */
  rowMenu: boolean
}) {
  const { data } = useComments(docId)
  const baseRef = useRef<HTMLDivElement>(null)
  const [spots, setSpots] = useState<Record<string, Spot>>({})
  // 블록마다 쓰던 글. 창은 바깥을 누르면 늘 닫히므로(손가락 기기에는 Esc 가 없다) 글은 여기 남겨
  // 다시 열면 돌아오게 한다. 다른 블록의 창을 열었다 와도 남는다.
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const byBlock = useMemo(() => {
    const groups: Record<string, DocComment[]> = {}
    for (const comment of data?.items ?? []) {
      if (comment.block_id) (groups[comment.block_id] ??= []).push(comment)
    }
    return groups
  }, [data])

  // 잴 블록: 댓글이 달린 블록과 창이 열린 블록(첫 댓글을 쓰는 중이면 아직 댓글이 없다).
  const idsKey = JSON.stringify(
    [...new Set([...Object.keys(byBlock), ...(openId ? [openId] : [])])].sort(),
  )

  useEffect(() => {
    const base = baseRef.current
    if (!base) return
    const ids = new Set(JSON.parse(idsKey) as string[])
    let frame = 0
    const measure = () => {
      if (editor.isDestroyed) return
      const next = measureSpots(editor, base.getBoundingClientRect(), ids)
      // 글자를 쳐도 줄이 안 바뀌면 자리가 그대로다. 그때는 다시 그리지 않는다.
      setSpots((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    // 한 프레임에 한 번만 잰다. 사진 같은 React 노드 뷰가 그려진 뒤에 재는 뜻도 있다.
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    schedule()
    // ponytail: 본문이 바뀔 때마다 문서를 한 번 훑는다. 블록 수천 개 문서에서 느려지면 바뀐 범위만 본다.
    editor.on('update', schedule)
    // 편집기: 본문 폭 단계, 사진이 늦게 뜨며 밀리는 것. 문서 영역(본문 상자를 감싼 스크롤 영역,
    // tableBleed 와 같은 상자): 본문 폭은 그대로인데 뻗은 표의 폭만 바뀌는 창 크기 변화.
    const observer = new ResizeObserver(schedule)
    observer.observe(editor.view.dom)
    const area = base.parentElement?.parentElement
    if (area) observer.observe(area)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('update', schedule)
      observer.disconnect()
    }
  }, [editor, idsKey])

  const { coveredId, openAlive } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      // 커서가 표의 첫 행에 있으면 행 옆 표 버튼이 그 표의 말풍선 자리에 뜬다. 겹치면 말풍선이
      // 버튼 밑에서 조각만 삐져나오므로 그동안은 숨긴다. 편집기를 떠나면 버튼도 사라진다.
      coveredId: rowMenu && e.isFocused ? firstRowTableAnchor(e.state) : null,
      openAlive: openId === null || findBlock(e.state.doc, openId) !== null,
    }),
  })

  // 창이 열린 블록이 문서에서 사라졌으면(지움, 남의 편집) 닫는다. 열린 채로 두면 되돌리기로 블록이
  // 돌아올 때 창이 다시 뜨며 본문을 치던 포커스를 가져간다.
  // 두 사람이 같은 블록에 거의 동시에 첫 댓글을 열 때도 여기로 온다. 각자 준 닻 중 하나만 Y.Doc 에
  // 남으므로 진 쪽은 창이 닫히고, 다시 열면 이긴 닻을 쓴다.
  // ponytail: 그때 진 쪽이 쓰던 글은 옛 닻에 묶여 안 보인다. 없애려면 서버가 닻을 발급해야 한다.
  useEffect(() => {
    if (!openAlive) onOpenChange(null)
  }, [openAlive, onOpenChange])

  const openSpot = openId ? spots[openId] : undefined

  return (
    <div ref={baseRef} className="relative">
      {Object.entries(spots).map(([id, spot]) => {
        const count = byBlock[id]?.length
        if (!count || id === coveredId) return null
        return (
          <button
            key={id}
            type="button"
            data-comment-marker
            aria-label={`이 블록의 댓글 ${count}개`}
            aria-haspopup="dialog"
            aria-expanded={openId === id}
            title="이 블록의 댓글"
            onClick={() => onOpenChange(openId === id ? null : id)}
            // h-7: 본문 한 줄 높이(leading-7). 블록 첫 줄 한가운데에 온다(손잡이와 같다).
            // 오른쪽 끝을 여백 끝에 맞추고 왼쪽으로 자란다. 꽉 찬 폭에서 여백 밖으로 나가면 가로
            // 스크롤이 생긴다. 두 자리 수는 글 끝을 몇 px 덮는다.
            style={{ top: spot.top, right: -(GUTTER + spot.overhang) }}
            className={cn(
              'absolute flex h-7 cursor-pointer items-center gap-0.5 rounded px-0.5 text-[11px] font-medium tabular-nums transition-colors',
              openId === id ? 'text-accent' : 'text-subtle hover:text-fg',
            )}
          >
            <MessageSquare className="size-3.5" aria-hidden />
            {count}
          </button>
        )
      })}
      {openId && openSpot && (
        <BlockCommentPopover
          // 다른 블록으로 옮기면 목록 스크롤과 포커스를 새로 시작한다.
          key={openId}
          editor={editor}
          docId={docId}
          blockId={openId}
          comments={byBlock[openId] ?? []}
          body={drafts[openId] ?? ''}
          onBodyChange={(body) => setDrafts((prev) => ({ ...prev, [openId]: body }))}
          // 짧은 블록은 그 아래에(블록의 글을 가리지 않는다), 긴 블록은 말풍선 아래에 띄운다.
          // 큰 표에서 아래에 띄우면 말풍선을 누를 때마다 화면이 표 끝으로 끌려 내려간다.
          top={
            (openSpot.bottom - openSpot.top > TALL ? openSpot.top + MARKER : openSpot.bottom) + 4
          }
          onOpenChange={onOpenChange}
        />
      )}
    </div>
  )
}

/** 블록 곁에 뜨는 창. 그 블록의 댓글과 입력칸. */
function BlockCommentPopover({
  editor,
  docId,
  blockId,
  comments,
  body,
  onBodyChange,
  top,
  onOpenChange,
}: {
  editor: Editor
  docId: string
  blockId: string
  comments: DocComment[]
  body: string
  onBodyChange: (body: string) => void
  top: number
  onOpenChange: (blockId: string | null) => void
}) {
  const addComment = useAddComment(docId)
  const names = useMentionNames()
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 열리면 바로 쓸 수 있게 입력칸으로 간다.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // 열릴 때와 댓글 수가 바뀔 때: 목록은 끝(가장 새 댓글)으로, 창이 화면 아래로 잘렸으면 보이는
  // 데까지 본문을 굴린다. 댓글이 실리면 창이 그만큼 길어진다.
  // ponytail: 지워서 줄 때도 끝으로 간다. 목록이 창 높이를 넘을 만큼 길 때만 보인다.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [comments.length])

  // 바깥을 누르면 닫는다. 쓰던 글은 위(BlockComments)에 남아 있다. 말풍선은 제 onClick 이
  // 여닫으므로 여기서 닫지 않는다.
  // ponytail: 누르는 순간(pointerdown) 닫는다. 손가락으로 본문을 굴리려고 대기만 해도 닫힌다.
  // click 으로 바꾸면 손잡이·툴바 버튼이 새 창을 연 직후 이 처리가 그 창을 닫는다.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (ref.current?.contains(target) || target.closest('[data-comment-marker]')) return
      onOpenChange(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onOpenChange])

  const send = () => {
    const text = body.trim()
    if (!text || addComment.isPending) return
    // mutate 의 onSuccess 는 창이 닫히면 불리지 않는다. 보내는 중에 닫아도 쓰던 글은 비워야
    // 다시 열었을 때 이미 보낸 글이 남아 있지 않다. 실패하면 글을 그대로 둔다.
    addComment.mutateAsync({ body: text, block_id: blockId }).then(
      () => onBodyChange(''),
      () => undefined,
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="이 블록의 댓글"
      style={{ top }}
      // 본문 오른쪽 끝에 맞춘다(말풍선 바로 아래). 좁은 화면에서는 본문 폭까지만.
      // overflow 를 걸지 않는다. 사람 목록(@)이 입력칸 위로 창 밖까지 뜬다.
      className="border-line bg-surface absolute right-0 z-20 w-80 max-w-full scroll-mb-4 rounded-xl border shadow-lg"
      onKeyDown={(e) => {
        // 사람 목록이 떠 있으면 Esc 는 그 목록을 닫는 데 쓰인다(MentionTextarea 가 먼저 받는다).
        if (e.key !== 'Escape' || e.defaultPrevented) return
        onOpenChange(null)
        // 굴리지 않는다. 말풍선으로 연 창은 커서가 다른 블록에 있어, 굴리면 본문이 그리로 튄다.
        editor.commands.focus(null, { scrollIntoView: false })
      }}
    >
      {comments.length > 0 && (
        <div ref={listRef} className="max-h-64 space-y-2 overflow-y-auto px-4 pt-3">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              docId={docId}
              comment={comment}
              names={names}
              // 지운 줄은 곧 사라진다. 초점이 body 로 떨어지면 Esc 로 이 창을 닫을 수 없다.
              onDelete={() => inputRef.current?.focus({ preventScroll: true })}
            />
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-2 p-3">
        {/* Enter 로 등록하고 줄바꿈은 Shift+Enter(옆 패널의 입력칸과 같다). */}
        <MentionTextarea
          inputRef={inputRef}
          value={body}
          onValueChange={onBodyChange}
          submitOnEnter
          onSubmitEnter={send}
          rows={1}
          maxLength={COMMENT_BODY_MAX}
          aria-label="이 블록에 댓글"
          placeholder="댓글 남기기…"
          className="min-h-11 w-full"
        />
        <Button
          type="submit"
          disabled={!body.trim() || addComment.isPending}
          className="h-11 shrink-0"
        >
          {addComment.isPending ? <Spinner className="border-t-on-accent" /> : '등록'}
        </Button>
      </form>
    </div>
  )
}
