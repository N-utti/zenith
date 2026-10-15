import { useRef, useState } from 'react'
import { Cpu, FilePlus, FileText, Loader2, Paperclip, SendHorizontal, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/ToastContext'
import { useTree } from '@/features/docs/api'
import { ApiError } from '@/lib/api'
import { uploadAiAttachment } from './api'
import { canEdit } from './attachEdit'
import { AttachmentEditor } from './AttachmentEditor'
import { AI_TEMPLATES } from './catalog'
import { RefDocPicker } from './RefDocPicker'
import { MAX_ATTACHMENTS, MAX_REF_DOCS, SCOPE_ALL, topFolders } from './scope'
import type { AiAttachment, AiModel } from './types'

/** 서버가 읽는 형식(백엔드 #396). 서버가 확장자로 가르므로 고르는 창도 확장자로 거른다. */
const ATTACH_ACCEPT = '.txt,.md,.csv,.docx,.xlsx,.pdf,.hwpx'
/** 서버 상한. 넘는 파일은 올리기 전에 막는다(12MB 를 넘으면 서버 앞단이 사유 없이 끊는다). */
const ATTACH_MAX_BYTES = 10 * 1024 * 1024

export function AiComposer({
  models,
  disabled,
  initialText = '',
  dropAttachments = 0,
  onSend,
}: {
  models: AiModel[]
  disabled: boolean
  /** 최근 질문을 눌러 들어온 값. 부모가 `key`로 리마운트시켜 채운다. */
  initialText?: string
  /** 서버가 첨부를 거절할 때마다 오른다(7일 지나 지워짐). 오르면 칩을 비운다. 안 그러면 다음 질문도 같은 422 다. */
  dropAttachments?: number
  onSend: (prompt: string, scope: string | null, docs: string[], attachments: string[]) => void
}) {
  const toast = useToast()
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

  // 첨부도 보낸 뒤에 남는다(참고 문서와 같은 이유). 올리는 중에는 보내지 않는다. 첨부 없이 나가 버린다.
  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [uploading, setUploading] = useState(0)
  // 이전 렌더 기억 패턴(effect 아님). 칩은 서버가 어느 첨부를 거절했는지 몰라 전부 비운다.
  const [dropped, setDropped] = useState(dropAttachments)
  if (dropped !== dropAttachments) {
    setDropped(dropAttachments)
    setAttachments([])
  }
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AiAttachment | null>(null)
  const room = MAX_ATTACHMENTS - attachments.length - uploading

  const attach = (files: File[]) => {
    // 크기부터 거른다. 거절될 파일이 자리를 차지해 멀쩡한 파일이 빠지면 안 된다.
    const fits = files.filter((file) => {
      if (file.size <= ATTACH_MAX_BYTES) return true
      toast.error(`${file.name}: 10MB 이하 파일만 올릴 수 있습니다.`)
      return false
    })
    if (fits.length > room) toast.info(`첨부는 ${MAX_ATTACHMENTS}개까지입니다.`)
    for (const file of fits.slice(0, Math.max(room, 0))) {
      setUploading((n) => n + 1)
      uploadAiAttachment(file)
        .then((uploaded) => setAttachments((list) => [...list, uploaded]))
        .catch((cause: unknown) =>
          toast.error(
            `${file.name}: ${cause instanceof ApiError && cause.message ? cause.message : '올리지 못했습니다.'}`,
          ),
        )
        .finally(() => setUploading((n) => n - 1))
    }
  }

  const send = () => {
    const prompt = text.trim()
    if (!prompt || disabled || uploading > 0) return
    onSend(
      prompt,
      scope === SCOPE_ALL ? null : scope,
      refDocs.map((doc) => doc.id),
      attachments.map((file) => file.id),
    )
    setText('')
  }
  const refs = [refDocs.length > 0 && '참고 문서', attachments.length > 0 && '첨부']
    .filter(Boolean)
    .join('·')

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
          {(attachments.length > 0 || uploading > 0) && (
            <ul aria-label="첨부" className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  title={file.name}
                  className="border-line bg-canvas text-muted flex max-w-60 items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
                >
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  {/* 서버가 뽑은 글자 수. 길면 앞부분만 읽힌다. */}
                  <span className="text-subtle shrink-0">{file.chars.toLocaleString()}자</span>
                  {canEdit(file.name) && (
                    <button
                      type="button"
                      onClick={() => setEditing(file)}
                      aria-label={`${file.name} AI로 고치기`}
                      title="AI로 고치기"
                      className="text-subtle hover:bg-surface-hover hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors"
                    >
                      <Wand2 className="size-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((list) => list.filter((each) => each.id !== file.id))
                    }
                    aria-label={`${file.name} 빼기`}
                    className="text-subtle hover:bg-surface-hover hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              {uploading > 0 && (
                <li
                  role="status"
                  className="border-line text-subtle flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  올리는 중
                </li>
              )}
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
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={room <= 0}
              title="txt·md·csv·docx·xlsx·pdf·hwpx, 10MB 까지. 7일 뒤 지워집니다."
              className="border-line text-muted hover:border-line-strong hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Paperclip className="size-3.5" />
              첨부
              {attachments.length > 0 && (
                <span className="text-subtle">
                  {attachments.length}/{MAX_ATTACHMENTS}
                </span>
              )}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ATTACH_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                attach([...(e.target.files ?? [])])
                // 같은 파일을 다시 골라도 바뀜이 일어나게 비운다.
                e.target.value = ''
              }}
            />
            <Button
              size="sm"
              onClick={send}
              disabled={disabled || uploading > 0 || text.trim().length === 0}
              className="ml-auto shrink-0"
            >
              <SendHorizontal className="size-4" />
              보내기
            </Button>
          </div>
        </div>

        <p className="text-subtle mt-2 text-center text-[11px]">
          Enter 전송 · Shift+Enter 줄바꿈 · 답변은 {refs && `${refs}와 `}
          {scope === SCOPE_ALL
            ? refs
              ? '사내 문서·게시글을'
              : '사내 문서와 게시글을'
            : refs
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
        {editing && <AttachmentEditor file={editing} onClose={() => setEditing(null)} />}
      </div>
    </div>
  )
}
