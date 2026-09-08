import type { DocSummary } from './types'

export interface TreeNode {
  doc: DocSummary
  children: TreeNode[]
}

/**
 * 평평한 목록을 `parentId`로 접어 트리로 만든다.
 *
 * 부모를 잃은 문서(권한 밖이거나 삭제된 부모)는 최상위로 올린다. 트리에서
 * 사라지면 열 방법이 없어진다.
 */
export function buildTree(docs: DocSummary[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(docs.map((doc) => [doc.id, { doc, children: [] }]))
  const roots: TreeNode[] = []

  for (const node of nodes.values()) {
    const parent = node.doc.parentId ? nodes.get(node.doc.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * 최상위부터 이 문서까지의 경로. 사이드바 트리는 조상만 쓰고,
 * breadcrumb은 문서 자신까지 포함해 쓴다.
 */
export function pathTo(docId: string | undefined, docs: DocSummary[]): DocSummary[] {
  if (!docId) return []
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const path: DocSummary[] = []

  let current = byId.get(docId)
  // 순환 참조가 생겨도 멈추도록 방문한 id를 기록한다.
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

/** 열려 있는 문서까지의 조상 id들. 트리에서 그 경로를 펼쳐 두는 데 쓴다. */
export function ancestorsOf(docId: string | undefined, docs: DocSummary[]): string[] {
  return pathTo(docId, docs)
    .slice(0, -1)
    .map((doc) => doc.id)
}
