import { expect, it } from 'vitest'
import { ancestorsOf, buildTree, defaultFolderId, foldersTo } from './tree'
import type { DocSummary, DocTreeData, Folder } from './types'

const folder = (id: string, parent_id: string | null, title: string, sort = 0): Folder => ({
  id,
  parent_id,
  title,
  sort,
})
const doc = (id: string, folder_id: string, title: string, deleted_at: string | null = null): DocSummary => ({
  id,
  folder_id,
  title,
  updated_at: '2026-09-17T00:00:00Z',
  updated_by: null,
  deleted_at,
})

const data: DocTreeData = {
  folders: [folder('f-1', null, '회사 위키', 1), folder('f-0', null, '팀', 0), folder('f-2', 'f-1', '제품')],
  docs: [doc('d-1', 'f-2', '로드맵'), doc('d-2', 'f-1', '규정'), doc('d-3', 'f-1', '지운 것', '2026-09-16T00:00:00Z')],
}

it('폴더가 폴더를 담고 문서는 폴더에만 담긴다. 폴더가 문서보다 위', () => {
  const tree = buildTree(data)
  // 최상위는 sort 순: 팀(0) → 회사 위키(1)
  expect(tree.map((n) => (n.kind === 'folder' ? n.folder.title : n.doc.title))).toEqual([
    '팀',
    '회사 위키',
  ])

  const wiki = tree[1]
  expect(wiki.kind).toBe('folder')
  if (wiki.kind !== 'folder') return
  // 폴더가 먼저, 그다음 문서. 휴지통에 든 문서는 빠진다.
  expect(wiki.children.map((n) => (n.kind === 'folder' ? n.folder.title : n.doc.title))).toEqual([
    '제품',
    '규정',
  ])
})

it('부모를 잃은 것은 최상위로 올린다. 트리에서 사라지면 열 방법이 없다', () => {
  const orphan: DocTreeData = {
    folders: [folder('f-9', 'f-없음', '떠도는 폴더')],
    docs: [doc('d-9', 'f-없음', '떠도는 문서')],
  }
  expect(buildTree(orphan)).toHaveLength(2)
})

it('문서까지의 폴더 사슬과 펼칠 폴더 id', () => {
  expect(foldersTo('d-1', data).map((f) => f.title)).toEqual(['회사 위키', '제품'])
  expect(ancestorsOf('d-1', data)).toEqual(['f-1', 'f-2'])
  expect(ancestorsOf(undefined, data)).toEqual([])
  // 없는 문서로 물어도 죽지 않는다.
  expect(foldersTo('d-없음', data)).toEqual([])
})

it('순환 참조가 생겨도 멈춘다', () => {
  const loop: DocTreeData = {
    folders: [folder('a', 'b', 'A'), folder('b', 'a', 'B')],
    docs: [doc('d', 'a', '문서')],
  }
  expect(foldersTo('d', loop).length).toBeLessThanOrEqual(2)
})

it('새 문서의 기본 자리는 최상위 폴더 중 첫 번째', () => {
  expect(defaultFolderId(data)).toBe('f-0')
  expect(defaultFolderId({ folders: [], docs: [] })).toBeUndefined()
})
