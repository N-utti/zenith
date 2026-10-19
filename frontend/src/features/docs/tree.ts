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

/** 폴더만 위에서 아래로 편 목록과 깊이. 새 문서를 넣을 폴더를 고르는 목록이 쓴다. */
export function folderRows(tree: TreeNode[], depth = 0): { folder: Folder; depth: number }[] {
  return tree.flatMap((node) =>
    node.kind === 'folder'
      ? [{ folder: node.folder, depth }, ...folderRows(node.children, depth + 1)]
      : [],
  )
}

/** 사이드바 트리의 문서·폴더 하나. 끌어 옮기기와 우클릭 메뉴가 대상을 이것으로 가리킨다. */
export interface TreeItem {
  kind: 'doc' | 'folder'
  id: string
}

/**
 * 이것을 이 폴더로 옮길 수 있는지. `targetId` 가 null 이면 최상위다.
 *
 * 문서는 폴더 안에만 산다. 폴더는 자기 자신이나 자기 아래로 못 간다(서버도 422 로 막는다).
 * 이미 있는 자리는 옮길 것이 없으니 놓을 자리로 치지 않는다.
 */
export function canDrop(
  item: TreeItem,
  targetId: string | null,
  { folders, docs }: DocTreeData,
): boolean {
  if (item.kind === 'doc') {
    const doc = docs.find((d) => d.id === item.id)
    return !!doc && targetId !== null && doc.folder_id !== targetId
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const folder = byId.get(item.id)
  if (!folder || folder.parent_id === targetId) return false

  // 놓을 폴더에서 위로 올라가다 끌고 있는 폴더를 만나면 자기 아래다.
  const seen = new Set<string>()
  let current = targetId ? byId.get(targetId) : undefined
  while (current && !seen.has(current.id)) {
    if (current.id === item.id) return false
    seen.add(current.id)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return true
}

/** 최근 수정순. */
export const byRecent = (a: DocSummary, b: DocSummary) => b.updated_at.localeCompare(a.updated_at)

export type FolderNode = TreeNode & { kind: 'folder' }

/**
 * 트리에서 이 폴더의 노드. 폴더 목록 화면이 하위 폴더를 사이드바와 같은 순서·같은 고리 처리로
 * 그리려고 쓴다(`parent_id` 를 따로 거르면 고리가 있을 때 두 화면이 어긋난다).
 */
export function findFolder(tree: TreeNode[], id: string): FolderNode | undefined {
  for (const node of tree) {
    if (node.kind !== 'folder') continue
    if (node.folder.id === id) return node
    const found = findFolder(node.children, id)
    if (found) return found
  }
  return undefined
}

/** 폴더 줄에 적는 「폴더 2개 · 문서 3개」. 바로 아래 것만 센다. 둘 다 없으면 「비어 있음」. */
export function folderSummary(node: FolderNode): string {
  const folders = node.children.filter((c) => c.kind === 'folder').length
  const docs = node.children.length - folders
  return (
    [folders && `폴더 ${folders}개`, docs && `문서 ${docs}개`].filter(Boolean).join(' · ') ||
    '비어 있음'
  )
}

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

const MIN_ROLE_LABEL: Record<Folder['min_role'], string> = {
  member: '전원',
  lead: '팀장 이상',
  exec: '임원',
}

/**
 * 폴더에 직접 건 열람 제한(백엔드 #421)의 설명. 「전원 열람」이고 지정한 사람도 없으면 `null`.
 * 볼 수 있는 사람 = 등급이 기준 이상이거나 지정한 사람이다. 상위 폴더에서 물려받은 제한은 보지 않는다
 * (자물쇠는 직접 건 폴더에만 단다).
 */
export function folderAccessLabel(folder: Folder): string | null {
  const people = folder.allowed_users.length
  if (folder.min_role === 'member' && !people) return null
  const role = MIN_ROLE_LABEL[folder.min_role] ?? folder.min_role
  return `열람: ${role}${people ? ` + 지정한 ${people}명` : ''}`
}

/**
 * 열람 권한 창에서 고친 것 중 서버에 보낼 칸만. 안 바뀌었으면 `null`.
 *
 * 「전원」이면 사람 지정을 비운다. 등급이 전원이면 지정한 사람은 열람에 아무 뜻이 없고, 서버는 그
 * 폴더를 제한 폴더로 쳐서 이동만 임원으로 막는다. 사람 지정은 전체 교체라 화면 명단에 없는 사람
 * (비활성 계정, 나)도 `picked` 에 그대로 실려 와야 지워지지 않는다.
 */
export function folderAccessChange(
  folder: Folder,
  minRole: Folder['min_role'],
  picked: string[],
): { min_role?: Folder['min_role']; allowed_users?: string[] } | null {
  const people = minRole === 'member' ? [] : [...new Set(picked)].sort()
  const change: { min_role?: Folder['min_role']; allowed_users?: string[] } = {}
  if (minRole !== folder.min_role) change.min_role = minRole
  if (people.join() !== [...folder.allowed_users].sort().join()) change.allowed_users = people
  return Object.keys(change).length ? change : null
}
