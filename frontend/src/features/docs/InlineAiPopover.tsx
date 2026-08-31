import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { OPEN_INLINE_AI_EVENT } from './editorBlocks'

interface QuickAction {
  id: string
  label: string
}

const QUICK_ACTIONS: QuickAction[] = [
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
 * 문서 안에서 부르는 AI (청사진 TURN 6a).
 *
 * 어시스턴트 화면과 달리 근거는 **이 문서 본문**이다. 위키 RAG가 아니라서
 * 근거 문서 패널이 없고, 대신 그 사실을 한 줄로 밝힌다.
 */
export function InlineAiPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState('custom')

  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 팝오버를 연 시점의 커서. 입력하는 동안 선택이 흔들려도 삽입 위치는 고정한다.
  const insertAt = useRef<number | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setPrompt('')
    setDraft(null)
    setError(null)
    insertAt.current = null
    editor.commands.focus()
  }, [editor])

  useEffect(() => {
    const onOpen = () => {
      insertAt.current = editor.state.selection.from
      setPos(anchorAt(editor))
      setDraft(null)
      setError(null)
      setPrompt('')
      setOpen(true)
    }
    const dom = editor.view.dom
    dom.addEventListener(OPEN_INLINE_AI_EVENT, onOpen)
    return () => dom.removeEventListener(OPEN_INLINE_AI_EVENT, onOpen)
  }, [editor])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()

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

  const generate = async (action: string) => {
    setBusy(true)
    setError(null)
    setLastAction(action)
    try {
      const result = await api<{ draft: string }>('/ai/inline', {
        method: 'POST',
        body: JSON.stringify({ action, prompt, docText: editor.getText() }),
      })
      setDraft(result.draft)
    } catch {
      setError('초안을 만들지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 삽입: 커서 자리에 / 아래에 추가: 그 블록 다음 줄에. */
  const apply = (mode: 'inline' | 'below') => {
    if (!draft) return
    const at = insertAt.current ?? editor.state.selection.from
    const chain = editor.chain().focus()
    if (mode === 'below') {
      chain.setTextSelection(at).createParagraphNear().insertContent(draft).run()
    } else {
      chain.insertContentAt(at, draft).run()
    }
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
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && prompt.trim() && !busy) void generate('custom')
          }}
          placeholder="이 문서를 두고 무엇을 할까요?"
          className="text-fg placeholder:text-subtle min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
        />
      </div>

      <div className="border-line flex flex-wrap gap-2 border-b px-4 py-3">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
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
        <div className="bg-canvas flex items-center gap-2 px-4 py-4">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-subtle size-1.5 animate-bounce rounded-full"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          <span className="text-subtle text-xs">사내 LLM이 생성 중…</span>
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
            <p className="text-fg text-sm leading-[1.75] whitespace-pre-wrap">{draft}</p>
            <p className="text-subtle mt-2.5 flex items-center gap-1.5 text-[11px]">
              <span className="bg-success size-1.5 rounded-full" />
              로컬 LLM · 근거: 이 문서 본문
            </p>
          </div>

          <div className="border-line flex items-center gap-2 border-t px-4 py-3">
            <Button size="sm" onClick={() => apply('inline')}>
              삽입
            </Button>
            <Button variant="secondary" size="sm" onClick={() => apply('below')}>
              아래에 추가
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void generate(lastAction)}>
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
