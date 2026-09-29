import type { DocSummary, DocTreeData, Folder } from './types'

/**
 * 사이드바에 그릴 한 줄. 폴더는 자식을 담고, 문서는 잎이다.
 *
 * 서버는 폴더 목록과 문서 목록을 따로 준다(`GET /tree`). 화면이 그리려면 하나로 접어야 한다.
 */
export type TreeNode =
  { kind: 'folder'; folder: Folder; children: TreeNode[] } | { kind: 'doc'; doc: DocSummary }

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
  const source = new Map(folders.map((folder) => [folder.id, folder]))

  /*
   * 고리 안에 있는 폴더는 부모를 무시하고 최상위로 올린다.
   *
   * 서로를 부모로 삼은 폴더 둘은 각자 "부모가 있으니" 서로의 자식이 되어 최상위에 못 들어간다.
   * 그대로 두면 그 가지가 화면에서 사라지고, 게다가 자식을 따라 그리다 무한 재귀에 빠진다.
   * 서버가 막지만(`_assert_no_cycle`) 동시에 들어온 이동 두 건이 이미 고리를 만든 경우는
   * 서버도 인정한다. 고아 노드와 같은 취급으로 끌어올린다.
   */
  const inCycle = (folder: Folder): boolean => {
    const seen = new Set<string>([folder.id])
    let current = folder.parent_id ? source.get(folder.parent_id) : undefined
    while (current) {
      if (seen.has(current.id)) return true
      seen.add(current.id)
      current = current.parent_id ? source.get(current.parent_id) : undefined
    }
    return false
  }

  const byId = new Map<string, { kind: 'folder'; folder: Folder; children: TreeNode[] }>(
    folders.map((folder) => [folder.id, { kind: 'folder', folder, children: [] }]),
  )
  const roots: TreeNode[] = []

  for (const node of byId.values()) {
    const parentId = inCycle(node.folder) ? null : node.folder.parent_id
    const parent = parentId ? byId.get(parentId) : undefined
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

/** 최근 수정순. */
export const byRecent = (a: DocSummary, b: DocSummary) => b.updated_at.localeCompare(a.updated_at)

/**
 * 사이드바 폴더에 펼쳐 둘 문서. `limit` 개를 넘으면 최근 수정순으로 그만큼만 보이고 나머지는
 * 폴더 목록 화면(`/docs?folder=`)으로 넘긴다. 주간 보고처럼 매주 쌓이는 폴더가 사이드바를
 * 끝없이 늘이지 않게 한다. 지금 열린 문서는 오래됐어도 빼지 않는다. 빠지면 어디를 보고 있는지 잃는다.
 */
export function previewDocs(docs: DocSummary[], limit: number, openId?: string): DocSummary[] {
  if (docs.length <= limit) return docs
  const recent = [...docs].sort(byRecent)
  const shown = recent.slice(0, limit)
  const open = recent.find((d) => d.id === openId)
  if (open && !shown.includes(open)) shown.push(open)
  return shown
}
