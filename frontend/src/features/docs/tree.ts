import type { DocSummary, DocTreeData, Folder } from './types'

/**
 * 사이드바에 그릴 한 줄. 폴더는 자식을 담고, 문서는 잎이다.
 *
 * 서버는 폴더 목록과 문서 목록을 따로 준다(`GET /tree`). 화면이 그리려면 하나로 접어야 한다.
 */
export type TreeNode =
  | { kind: 'folder'; folder: Folder; children: TreeNode[] }
  | { kind: 'doc'; doc: DocSummary }

function titleOf(node: TreeNode): string {
  return node.kind === 'folder' ? node.folder.title : node.doc.title
}

/** 폴더는 `sort` 순, 같으면 이름순. 문서는 폴더 뒤에 이름순으로 붙는다. */
function ordered(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    if (a.kind === 'folder' && b.kind === 'folder' && a.folder.sort !== b.folder.sort) {
      return a.folder.sort - b.folder.sort
    }
    return titleOf(a).localeCompare(titleOf(b))
  })
}

/**
 * 폴더·문서를 트리로 접는다.
 *
 * 부모를 잃은 폴더·문서(지워졌거나 안 온 것)는 최상위로 올린다. 트리에서 사라지면 열 방법이
 * 없어진다. 휴지통에 든 문서는 빼되, 그건 서버가 이미 빼고 주는 것이라 안전망이다.
 */
export function buildTree({ folders, docs }: DocTreeData): TreeNode[] {
  const byId = new Map<string, { kind: 'folder'; folder: Folder; children: TreeNode[] }>(
    folders.map((folder) => [folder.id, { kind: 'folder', folder, children: [] }]),
  )
  const roots: TreeNode[] = []

  for (const node of byId.values()) {
    const parent = node.folder.parent_id ? byId.get(node.folder.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  for (const doc of docs) {
    if (doc.deleted_at) continue
    const node: TreeNode = { kind: 'doc', doc }
    const parent = byId.get(doc.folder_id)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  for (const node of byId.values()) node.children = ordered(node.children)
  return ordered(roots)
}

/** 최상위부터 이 문서까지의 폴더 사슬. 순환 참조가 생겨도 멈춘다. */
export function foldersTo(docId: string | undefined, { folders, docs }: DocTreeData): Folder[] {
  const doc = docId ? docs.find((d) => d.id === docId) : undefined
  if (!doc) return []

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: Folder[] = []
  const seen = new Set<string>()

  let current = byId.get(doc.folder_id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

/** 열려 있는 문서까지의 폴더 id들. 트리에서 그 경로를 펼쳐 두는 데 쓴다. */
export function ancestorsOf(docId: string | undefined, data: DocTreeData): string[] {
  return foldersTo(docId, data).map((folder) => folder.id)
}

/** 새 문서·새 폴더의 기본 자리. 최상위 폴더 중 첫 번째. */
export function defaultFolderId({ folders }: DocTreeData): string | undefined {
  return folders
    .filter((f) => f.parent_id === null)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))[0]?.id
}
