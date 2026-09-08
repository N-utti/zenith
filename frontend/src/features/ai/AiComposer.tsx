import { useState } from 'react'
import { FileText, Plus, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Textarea } from '@/components/ui/Textarea'
import type { AiMeta } from './types'

export function AiComposer({
  meta,
  disabled,
  initialText = '',
  onSend,
}: {
  meta: AiMeta | undefined
  disabled: boolean
  /** 최근 질문을 눌러 들어온 값. 부모가 `key`로 리마운트시켜 채운다. */
  initialText?: string
  onSend: (prompt: string) => void
}) {
  const [text, setText] = useState(initialText)
  const [model, setModel] = useState('')
  const [source, setSource] = useState('')

  const models = meta?.models ?? []
  const sources = meta?.sources ?? []
  const templates = meta?.templates ?? []

  const currentModel = model || models[0]?.id || ''
  const currentSource = source || sources[0]?.id || ''

  const send = () => {
    const prompt = text.trim()
    if (!prompt || disabled) return
    onSend(prompt)
    setText('')
  }

  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        {/* 템플릿 자동작성. 누르면 컴포저에 프롬프트를 채운다 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-subtle text-[11.5px] font-bold">템플릿으로 자동작성</span>
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setText(template.prompt)}
              className="border-line bg-surface text-muted hover:border-line-strong hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors"
            >
              <FileText className="size-3.5" />
              {template.label}
            </button>
          ))}
          <button
            type="button"
            title="템플릿 관리는 M3에서 붙습니다"
            className="border-line text-subtle flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-[12.5px]"
          >
            <Plus className="size-3.5" />
            템플릿 선택
          </button>
        </div>

        <div className="border-line bg-surface focus-within:border-line-strong rounded-xl border p-3 transition-colors">
          {/* 바깥 박스가 이미 테두리를 갖고 있어, 여기서는 껍데기를 벗기고 글자만 둔다. */}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            submitOnEnter
            onSubmitEnter={send}
            rows={2}
            aria-label="AI에게 물어보기"
            placeholder="위키에 물어보거나, 템플릿으로 문서를 작성하세요"
            className="resize-none border-0 bg-transparent p-0 text-[13.5px] focus:border-0"
          />

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Dropdown
              label="모델:"
              value={currentModel}
              onChange={setModel}
              options={models.map((m) => ({ value: m.id, label: m.label, note: m.note }))}
            />
            <Dropdown
              label="지식 소스:"
              value={currentSource}
              onChange={setSource}
              options={sources.map((s) => ({
                value: s.id,
                label: s.label,
                disabled: !s.allowed,
                disabledReason: '열람 권한이 없습니다',
              }))}
            />
            <Button
              size="sm"
              onClick={send}
              disabled={disabled || text.trim().length === 0}
              className="ml-auto shrink-0"
            >
              <SendHorizontal className="size-4" />
              보내기
            </Button>
          </div>
        </div>

        <p className="text-subtle mt-2 text-center text-[11px]">
          Enter 전송 · Shift+Enter 줄바꿈 · 답변은 사내 위키를 근거로만 만들어집니다
        </p>
      </div>
    </div>
  )
}
