import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { OPEN_INLINE_AI_EVENT } from './editorBlocks'
import { parseMarkdownTable, tableToHtml } from './markdownTable'

/** 04 §8 `POST /ai/doc-action` 의 `action`. 자유 프롬프트는 계약에 없다. */
type DocAction = 'summarize' | 'continue' | 'polish' | 'translate' | 'table'

const QUICK_ACTIONS: { id: DocAction; label: string }[] = [
  { id: 'summarize', label: '요약' },
  { id: 'continue', label: '이어쓰기' },
  { id: 'polish', label: '문장 다듬기' },
  { id: 'table', label: '표로 정리' },
  { id: 'translate', label: '번역' },
]

/** 커서 자리에 띄우되 화면 밖으로 나가지 않게 가둔다. */
function anchorAt(editor: Editor): { top: number; left: number } {
  const { from } = editor.state.selection
  const coords = editor.view.coordsAtPos(from)
  const width = 420
  const left = Math.min(Math.max(12, coords.left), window.innerWidth - width - 12)
  // 아래로 열되, 아래 공간이 모자라면 위로 붙인다.
  const below = window.innerHeight - coords.bottom
  const top = below > 320 ? coords.bottom + 8 : Math.max(12, coords.top - 328)
  return { top, left }
}

/**
 * 문서 안에서 부르는 AI (청사진 TURN 6a). 편집기에서 `/` 를 치면 뜬다.
 *
 * 어시스턴트 화면과 달리 근거는 **이 문서 본문**이다. 본문은 서버가 Y.Doc 에서 읽으므로
 * 여기서는 문서 id 와 동작만 보낸다(04 §8 `/ai/doc-action`). 위키 RAG 가 아니라서
 * 근거 문서 패널이 없고, 대신 그 사실을 한 줄로 밝힌다.
 */
export function InlineAiPopover({ editor, docId }: { editor: Editor; docId: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<DocAction | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  const firstChipRef = useRef<HTMLButtonElement>(null)
  const applyRef = useRef<HTMLButtonElement>(null)
  // 요청 세대. 닫은 뒤 도착한 응답이 다음에 연 팝오버에 새어 들지 않게 한다.
  const reqId = useRef(0)
  // 팝오버를 연 시점의 커서. 생성을 기다리는 동안 선택이 흔들려도 삽입 위치는 고정한다.
  const insertAt = useRef<number | null>(null)

  const close = useCallback(() => {
    reqId.current++
    setOpen(false)
    setDraft(null)
    setError(null)
    setBusy(false)
    insertAt.current = null
    editor.commands.focus()
  }, [editor])

  useEffect(() => {
    const onOpen = () => {
      insertAt.current = editor.state.selection.from
      setPos(anchorAt(editor))
      setDraft(null)
      setError(null)
      setOpen(true)
    }
    const dom = editor.view.dom
    dom.addEventListener(OPEN_INLINE_AI_EVENT, onOpen)
    return () => dom.removeEventListener(OPEN_INLINE_AI_EVENT, onOpen)
  }, [editor])

  useEffect(() => {
    if (!open) return
    firstChipRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, close])

  const generate = async (action: DocAction) => {
    const id = ++reqId.current
    setBusy(true)
    setError(null)
    setLastAction(action)
    try {
      // block_id 는 편집기가 블록 id 를 갖지 않아 보내지 않는다. 서버는 문서 전체를 본다.
      const result = await api<{ draft: string }>('/ai/doc-action', {
        method: 'POST',
        body: JSON.stringify({ doc_id: docId, action }),
      })
      if (reqId.current === id) setDraft(result.draft)
    } catch {
      if (reqId.current === id) setError('초안을 만들지 못했습니다. 다시 시도해 주세요.')
    } finally {
      if (reqId.current === id) setBusy(false)
    }
  }

  // 생성 중엔 칩이 전부 비활성이라 포커스가 body 로 떨어진다. 초안이 뜨면 "삽입" 으로 되돌린다.
  useEffect(() => {
    if (draft) applyRef.current?.focus()
  }, [draft])

  // "표로 정리" 초안은 마크다운 표로 온다. 미리보기도 삽입도 실제 표로(05 SCR-03, FR-AI-09).
  const table = draft ? parseMarkdownTable(draft) : null

  /** 삽입: 커서 자리에 / 아래에 추가: 커서가 든 최상위 블록 다음에. */
  const apply = (mode: 'inline' | 'below') => {
    if (!draft) return
    const content = table ? tableToHtml(table) : draft
    // 응답을 기다리는 동안 남의 편집으로 문서가 줄면 저장해 둔 좌표가 밖으로 나간다. 문서 끝으로 가둔다.
    // ponytail: 상대 좌표(Y.RelativePosition)로 들면 정확해진다. 어긋난 삽입이 문제가 되면 그때.
    const at = Math.min(
      insertAt.current ?? editor.state.selection.from,
      editor.state.doc.content.size,
    )
    const $at = editor.state.doc.resolve(at)
    const target = mode === 'below' && $at.depth > 0 ? $at.after(1) : at
    editor.chain().focus().insertContentAt(target, content).run()
    close()
  }

  if (!open) return null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="문서 안 AI"
      style={{ top: pos.top, left: pos.left, width: 420 }}
      className="border-line bg-surface fixed z-50 overflow-hidden rounded-xl border shadow-2xl"
    >
      <div className="border-line flex items-center gap-2.5 border-b px-4 py-3">
        <span className="bg-accent-soft text-accent grid size-6 shrink-0 place-items-center rounded-md">
          <Sparkles className="size-3.5" />
        </span>
        <span className="text-fg text-[13.5px] font-semibold">이 문서를 두고 무엇을 할까요?</span>
      </div>

      <div className="border-line flex flex-wrap gap-2 border-b px-4 py-3">
        {QUICK_ACTIONS.map((action, index) => (
          <button
            key={action.id}
            ref={index === 0 ? firstChipRef : undefined}
            type="button"
            disabled={busy}
            onClick={() => void generate(action.id)}
            className="bg-sunken text-muted hover:text-fg cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>

      {busy && (
        <div aria-live="polite" className="bg-canvas flex items-center gap-2 px-4 py-4">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-subtle size-1.5 animate-bounce rounded-full"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          <span className="text-subtle text-xs">AI가 생성 중…</span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-danger bg-danger/10 px-4 py-3 text-xs">
          {error}
        </p>
      )}

      {draft && !busy && (
        <>
          <div className="bg-canvas px-4 py-3.5">
            <p className="text-subtle mb-2 text-[11px] font-bold">생성된 초안</p>
            {table ? (
              <div className="overflow-x-auto">
                <table className="border-line w-full border-collapse border text-xs">
                  <tbody>
                    {table.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          r === 0 ? (
                            <th
                              key={c}
                              scope="col"
                              className="border-line bg-sunken border px-2 py-1 text-left font-semibold"
                            >
                              {cell}
                            </th>
                          ) : (
                            <td key={c} className="border-line border px-2 py-1 align-top">
                              {cell}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-fg text-sm leading-[1.75] whitespace-pre-wrap">{draft}</p>
            )}
            <p className="text-subtle mt-2.5 flex items-center gap-1.5 text-[11px]">
              <span className="bg-success size-1.5 rounded-full" />
              Claude API · 사내 서버 경유 · 근거: 이 문서 본문
            </p>
          </div>

          <div className="border-line flex items-center gap-2 border-t px-4 py-3">
            <Button ref={applyRef} size="sm" onClick={() => apply('inline')}>
              삽입
            </Button>
            <Button variant="secondary" size="sm" onClick={() => apply('below')}>
              아래에 추가
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => lastAction && void generate(lastAction)}
            >
              다시 생성
            </Button>
            <button
              type="button"
              onClick={close}
              className="text-subtle hover:text-fg ml-auto cursor-pointer text-xs transition-colors"
            >
              취소 (Esc)
            </button>
          </div>
        </>
      )}
    </div>
  )
}
