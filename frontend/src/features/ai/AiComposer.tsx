import { useState } from 'react'
import { Cpu, FileText, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Textarea } from '@/components/ui/Textarea'
import { AI_SCOPES, AI_TEMPLATES } from './catalog'
import type { AiModel } from './types'

export function AiComposer({
  models,
  disabled,
  initialText = '',
  onSend,
}: {
  models: AiModel[]
  disabled: boolean
  /** 최근 질문을 눌러 들어온 값. 부모가 `key`로 리마운트시켜 채운다. */
  initialText?: string
  onSend: (prompt: string, scope: string | null) => void
}) {
  const [text, setText] = useState(initialText)
  const [scope, setScope] = useState(AI_SCOPES[0].id)

  const send = () => {
    const prompt = text.trim()
    if (!prompt || disabled) return
    onSend(prompt, scope === 'all' ? null : scope)
    setText('')
  }

  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        {/* 템플릿 자동작성. 누르면 컴포저에 프롬프트를 채운다 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-subtle text-[11.5px] font-bold">템플릿으로 자동작성</span>
          {AI_TEMPLATES.map((template) => (
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
            {/* 모델은 서버가 정한다(`/ai/chat` 에 model 필드가 없다). 무엇으로 답하는지만 밝힌다. */}
            <span className="text-subtle flex items-center gap-1.5 text-xs" title="공급자 모델">
              <Cpu className="size-3.5" />
              {models[0]?.name ?? '모델 확인 중'}
            </span>
            <Dropdown
              label="지식 소스:"
              value={scope}
              onChange={setScope}
              options={AI_SCOPES.map((s) => ({ value: s.id, label: s.label }))}
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
