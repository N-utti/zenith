import { expect, it } from 'vitest'
import { ancestorsOf, buildTree, defaultFolderId, foldersTo, previewDocs } from './tree'
import type { DocSummary, DocTreeData, Folder } from './types'

const folder = (id: string, parent_id: string | null, title: string, sort = 0): Folder => ({
  id,
  parent_id,
  title,
  sort,
})
const doc = (
  id: string,
  folder_id: string,
  title: string,
  deleted_at: string | null = null,
): DocSummary => ({
  id,
  folder_id,
  title,
  updated_at: '2026-09-17T00:00:00Z',
  updated_by: null,
  deleted_at,
})

const data: DocTreeData = {
  folders: [
    folder('f-1', null, '회사 위키', 1),
    folder('f-0', null, '팀', 0),
    folder('f-2', 'f-1', '제품'),
  ],
  docs: [
    doc('d-1', 'f-2', '로드맵'),
    doc('d-2', 'f-1', '규정'),
    doc('d-3', 'f-1', '지운 것', '2026-09-16T00:00:00Z'),
  ],
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

it('순환 참조가 생겨도 멈추고, 그 가지가 화면에서 사라지지 않는다', () => {
  const loop: DocTreeData = {
    folders: [folder('a', 'b', 'A'), folder('b', 'a', 'B'), folder('self', 'self', '자기참조')],
    docs: [doc('d', 'a', '문서')],
  }
  expect(foldersTo('d', loop).length).toBeLessThanOrEqual(3)

  // 서로를 부모로 삼으면 둘 다 "부모가 있으니" 최상위에 못 들어간다. 그대로 두면 안의 문서까지
  // 열 방법이 없어진다. 최상위에서 닿지 않는 폴더는 끌어올린다.
  const tree = buildTree(loop)
  const titles = tree.map((n) => (n.kind === 'folder' ? n.folder.title : n.doc.title))
  expect(titles).toContain('자기참조')
  expect(titles.length).toBeGreaterThan(0)
  // 고리가 끊겨 있어야 한다. 남아 있으면 자식을 따라 그리다 무한 재귀에 빠진다.
  expect(titles).toEqual(expect.arrayContaining(['A', 'B', '자기참조']))
  const a = tree.find((n) => n.kind === 'folder' && n.folder.title === 'A')
  expect(a?.kind === 'folder' && a.children.some((c) => c.kind === 'doc')).toBe(true)
})

it('새 문서의 기본 자리는 최상위 폴더 중 첫 번째', () => {
  expect(defaultFolderId(data)).toBe('f-0')
  expect(defaultFolderId({ folders: [], docs: [] })).toBeUndefined()
})

it('previewDocs: 넘치면 최근 수정순으로 자르고, 열린 문서는 남긴다', () => {
  const at = (id: string, day: number): DocSummary => ({
    ...doc(id, 'f-1', id),
    updated_at: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`,
  })
  const docs = [at('a', 1), at('b', 5), at('c', 3), at('d', 4)]

  expect(previewDocs(docs, 5)).toBe(docs)
  expect(previewDocs(docs, 2).map((d) => d.id)).toEqual(['b', 'd'])
  expect(previewDocs(docs, 2, 'a').map((d) => d.id)).toEqual(['b', 'd', 'a'])
  // 이미 보이는 문서, 다른 폴더의 문서는 덧붙이지 않는다.
  expect(previewDocs(docs, 2, 'b').map((d) => d.id)).toEqual(['b', 'd'])
  expect(previewDocs(docs, 2, 'zz').map((d) => d.id)).toEqual(['b', 'd'])
  expect(previewDocs(docs, 4)).toBe(docs)
})
