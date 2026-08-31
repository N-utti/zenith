import { useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDocs } from '@/features/docs/api'
import type { DocSummary } from '@/features/docs/types'

interface TreeNode {
  doc: DocSummary
  children: TreeNode[]
}

/** 평평한 목록을 parentId로 접어 트리로 만든다. 고아 문서는 최상위로 올린다. */
function buildTree(docs: DocSummary[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(docs.map((doc) => [doc.id, { doc, children: [] }]))
  const roots: TreeNode[] = []

  for (const node of nodes.values()) {
    const parent = node.doc.parentId ? nodes.get(node.doc.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 열려 있는 문서까지의 조상 id — 그 경로는 처음부터 펼쳐 둔다. */
function ancestorsOf(docId: string | undefined, docs: DocSummary[]): string[] {
  if (!docId) return []
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const path: string[] = []
  let current = byId.get(docId)?.parentId ?? null
  while (current) {
    path.push(current)
    current = byId.get(current)?.parentId ?? null
  }
  return path
}

function TreeRow({
  node,
  depth,
  openPath,
  onNavigate,
}: {
  node: TreeNode
  depth: number
  /** 처음 마운트할 때 펼쳐 둘 조상 id들. 열려 있는 문서까지의 경로다. */
  openPath: Set<string>
  onNavigate?: () => void
}) {
  const [expanded, setExpanded] = useState(() => openPath.has(node.doc.id))
  const hasChildren = node.children.length > 0

  return (
    <>
      <div className="flex items-center">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '접기' : '펼치기'}
            aria-expanded={expanded}
            className="text-subtle hover:text-fg grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors"
            style={{ marginLeft: depth * 14 }}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" style={{ marginLeft: depth * 14 }} />
        )}

        <NavLink
          to={`/docs/${node.doc.id}`}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
              isActive
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-muted hover:bg-surface-hover hover:text-fg',
            )
          }
        >
          <FileText className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{node.doc.title}</span>
        </NavLink>
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.doc.id}
            node={child}
            depth={depth + 1}
            openPath={openPath}
            onNavigate={onNavigate}
          />
        ))}
    </>
  )
}

/** 1b 셸의 '워크스페이스' 섹션 — 사이드바에 문서를 계층으로 보여준다. */
export function DocTree({ onNavigate }: { onNavigate?: () => void }) {
  const { docId } = useParams()
  const { data, isPending } = useDocs('')
  // data.items는 react-query 캐시 객체라 그대로가 안정적인 참조다. `?? []`를 memo 밖에 두면
  // 매 렌더 새 배열이 되어 아래 memo가 전부 무효화된다.
  const tree = useMemo(() => buildTree(data?.items ?? []), [data])
  const openPath = useMemo(() => new Set(ancestorsOf(docId, data?.items ?? [])), [docId, data])

  if (isPending) {
    return (
      <div className="space-y-1.5 px-2 py-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface-hover h-5 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (tree.length === 0) {
    return <p className="text-subtle px-3 py-2 text-xs">문서가 없습니다.</p>
  }

  return (
    <>
      {tree.map((node) => (
        <TreeRow
          key={node.doc.id}
          node={node}
          depth={0}
          openPath={openPath}
          onNavigate={onNavigate}
        />
      ))}
    </>
  )
}
