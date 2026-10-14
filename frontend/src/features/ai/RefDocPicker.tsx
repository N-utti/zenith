import { useState } from 'react'
import { Check, FileText, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { DocTreeData } from '@/features/docs/types'
import { cn } from '@/lib/cn'
import { MAX_REF_DOCS } from './scope'

/**
 * 질문에 붙일 참고 문서 고르기(백엔드 #394). 고른 문서의 본문 전체가 근거로 들어간다.
 * 목록은 사이드바 트리(`GET /tree`)다. 통합검색(`GET /search`)은 「AI 근거로 쓰기」 스위치를
 * 주지 않아, 꺼진 문서를 고른 뒤에야 422 로 알게 된다. 트리는 그 값이 있어 미리 막는다.
 * 고르는 즉시 입력창의 칩에 반영되고, 「완료」는 닫기만 한다.
 */
export function RefDocPicker({
  onClose,
  tree,
  value,
  onChange,
}: {
  onClose: () => void
  tree: DocTreeData | undefined
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const folderTitle = new Map(tree?.folders.map((folder) => [folder.id, folder.title]))
  // 트리는 휴지통 문서를 주지 않는다.
  const docs = (tree?.docs ?? []).filter((doc) => doc.title.toLowerCase().includes(q))
  const full = value.length >= MAX_REF_DOCS

  return (
    <Modal
      open
      onClose={onClose}
      title="참고 문서"
      description={`고른 문서의 본문을 근거로 답합니다. ${MAX_REF_DOCS}개까지 고를 수 있고, 본문은 모두 합쳐 5만 자까지 앞 문서부터 들어갑니다.`}
      footer={
        <Button size="sm" onClick={onClose}>
          완료
        </Button>
      }
    >
      <Input
        icon={<Search className="size-4" />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        aria-label="참고 문서 찾기"
        placeholder="문서 제목으로 찾기"
      />
      <p className="text-subtle mt-2 text-xs" aria-live="polite">
        {value.length}/{MAX_REF_DOCS}개 골랐습니다
      </p>
      <ul className="mt-2 space-y-0.5">
        {docs.length === 0 && (
          <li className="text-subtle py-6 text-center text-sm">
            {!tree
              ? '문서 목록을 불러오는 중입니다.'
              : q
                ? '맞는 문서가 없습니다.'
                : '문서가 없습니다.'}
          </li>
        )}
        {docs.map((doc) => {
          const picked = value.includes(doc.id)
          // disabled 대신 aria-disabled. 못 고르는 줄에도 초점이 닿아 아래 줄의 사유를 읽어 준다.
          const blocked = !doc.ai_source || (full && !picked)
          return (
            <li key={doc.id}>
              <button
                type="button"
                aria-pressed={picked}
                aria-disabled={blocked}
                onClick={() => {
                  if (blocked) return
                  onChange(picked ? value.filter((id) => id !== doc.id) : [...value, doc.id])
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
                  picked ? 'bg-accent-soft' : 'hover:bg-surface-hover',
                )}
              >
                <FileText className="text-subtle size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">{doc.title}</span>
                  <span className="text-subtle block truncate text-xs">
                    {!doc.ai_source
                      ? 'AI 근거로 쓰기가 꺼진 문서'
                      : full && !picked
                        ? `${MAX_REF_DOCS}개를 모두 골랐습니다`
                        : folderTitle.get(doc.folder_id)}
                  </span>
                </span>
                {picked && <Check className="text-accent size-4 shrink-0" />}
              </button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
