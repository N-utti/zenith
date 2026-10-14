import { useState } from 'react'
import { Cpu, FilePlus, FileText, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Textarea } from '@/components/ui/Textarea'
import { useTree } from '@/features/docs/api'
import { AI_TEMPLATES } from './catalog'
import { RefDocPicker } from './RefDocPicker'
import { MAX_REF_DOCS, SCOPE_ALL, topFolders } from './scope'
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
  onSend: (prompt: string, scope: string | null, docs: string[]) => void
}) {
  const [text, setText] = useState(initialText)
  const tree = useTree().data
  const folders = topFolders(tree)
  const [picked, setPicked] = useState(SCOPE_ALL)
  // 고른 폴더가 목록에서 사라지면(지워짐, 서버 거절 뒤 트리를 다시 받음) 전체로 본다.
  const scope = folders.some((folder) => folder.id === picked) ? picked : SCOPE_ALL
  // 참고 문서는 보낸 뒤에도 남는다. 서버는 대화에 남기지 않아, 이어 묻는 질문에도 실어야 같은 문서를 본다.
  // 지워졌거나 근거 쓰기가 꺼진 문서(서버 거절 뒤 트리를 다시 받음)는 칩에서 빠진다. 폴더와 같은 규칙.
  const [pickedDocs, setPickedDocs] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const refDocs = pickedDocs.flatMap((id) => {
    const doc = tree?.docs.find((each) => each.id === id && each.ai_source)
    return doc ? [doc] : []
  })

  const send = () => {
    const prompt = text.trim()
    if (!prompt || disabled) return
    onSend(
      prompt,
      scope === SCOPE_ALL ? null : scope,
      refDocs.map((doc) => doc.id),
    )
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
          {refDocs.length > 0 && (
            <ul aria-label="참고 문서" className="mb-2 flex flex-wrap gap-1.5">
              {refDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="border-line bg-canvas text-muted flex max-w-60 items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{doc.title}</span>
                  <button
                    type="button"
                    onClick={() => setPickedDocs(pickedDocs.filter((id) => id !== doc.id))}
                    aria-label={`${doc.title} 빼기`}
                    className="text-subtle hover:bg-surface-hover hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* 바깥 박스가 이미 테두리를 갖고 있어, 여기서는 껍데기를 벗기고 글자만 둔다. */}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            submitOnEnter
            onSubmitEnter={send}
            rows={2}
            // 서버 상한(ChatIn.message). 넘기면 422 인데 그 사유는 배열이라 화면에 일반 실패만 뜬다.
            maxLength={30000}
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
              onChange={setPicked}
              options={[
                { value: SCOPE_ALL, label: '전체' },
                ...folders.map((folder) => ({ value: folder.id, label: folder.title })),
              ]}
            />
            <button
              type="button"
              onClick={() => setPicking(true)}
              aria-haspopup="dialog"
              className="border-line text-muted hover:border-line-strong hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors"
            >
              <FilePlus className="size-3.5" />
              참고 문서
              {refDocs.length > 0 && (
                <span className="text-subtle">
                  {refDocs.length}/{MAX_REF_DOCS}
                </span>
              )}
            </button>
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
          Enter 전송 · Shift+Enter 줄바꿈 · 답변은 {refDocs.length > 0 && '참고 문서와 '}
          {scope === SCOPE_ALL
            ? refDocs.length > 0
              ? '사내 문서·게시글을'
              : '사내 문서와 게시글을'
            : refDocs.length > 0
              ? '고른 폴더의 문서를'
              : '고른 폴더의 문서만'}{' '}
          근거로 만들어집니다
        </p>

        {/* 열 때마다 새로 그려 검색어를 비운다. */}
        {picking && (
          <RefDocPicker
            onClose={() => setPicking(false)}
            tree={tree}
            value={refDocs.map((doc) => doc.id)}
            onChange={setPickedDocs}
          />
        )}
      </div>
    </div>
  )
}
