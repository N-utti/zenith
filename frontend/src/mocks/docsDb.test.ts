import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  addComment,
  addVersion,
  createDoc,
  createFolder,
  docTree,
  editComment,
  findDoc,
  findVersion,
  listComments,
  listDocs,
  listTrash,
  listVersions,
  purgeDoc,
  removeComment,
  removeFolder,
  trashDoc,
  untrashDoc,
} from './docsDb'

const user = MOCK_USERS.find((u) => u.id === 'u-2')!
// 모듈 전역 배열을 공유하고 리셋이 없다. 케이스를 더할 때는 각자 새로 만든 문서로 한다.

it('휴지통에 든 문서는 목록·트리에서 빠지고, 되돌리면 돌아온다', () => {
  const doc = createDoc(user, 'f-1', '휴지통 시험')
  expect(listDocs('휴지통 시험')).toHaveLength(1)

  trashDoc(doc, user)
  expect(listDocs('휴지통 시험')).toHaveLength(0)
  expect(docTree().docs.some((d) => d.id === doc.id)).toBe(false)
  // 저장소에는 남아 있다. 되돌리기 전에 읽을 수 있어야 한다.
  expect(findDoc(doc.id)?.deleted_at).not.toBeNull()

  untrashDoc(doc, user)
  expect(listDocs('휴지통 시험')).toHaveLength(1)
  expect(findDoc(doc.id)?.deleted_at).toBeNull()

  purgeDoc(doc.id)
})

it('이미 휴지통에 있으면 시각을 다시 찍지 않는다', () => {
  const doc = createDoc(user, 'f-1', '두 번 삭제')
  trashDoc(doc, user)
  const first = doc.deleted_at
  expect(first).not.toBeNull()

  // 백엔드 `delete_doc` 도 `deleted_at` 이 이미 있으면 건드리지 않는다. 30일 시계가 밀리면 안 된다.
  trashDoc(doc, user)
  expect(doc.deleted_at).toBe(first)

  purgeDoc(doc.id)
})

it('버전 목록에는 스냅샷이 없다. 내용은 /restore 로 한 건씩 준다', () => {
  const doc = createDoc(user, 'f-1', '버전 목록 시험')
  addVersion(doc.id, user, 'c25hcHNob3Q=')

  // 목이 서버보다 많이 주면 미리보기가 목에서만 동작하고 실제 서버에서 죽는다. 그 회귀를 막는다.
  const [meta] = listVersions(doc.id)
  expect(meta).not.toHaveProperty('snapshot')
  expect(meta).toMatchObject({ author: { id: user.id }, label: null })

  expect(findVersion(doc.id, meta.id)?.snapshot).toBe('c25hcHNob3Q=')
  expect(findVersion(doc.id, '없는버전')).toBeUndefined()

  purgeDoc(doc.id)
})

it('같은 사람의 무명 버전은 하나로 접고, 라벨이 붙으면 따로 쌓인다', () => {
  const doc = createDoc(user, 'f-1', '버전 접기 시험')
  addVersion(doc.id, user, 'AAAA')
  addVersion(doc.id, user, 'BBBB')
  expect(listVersions(doc.id)).toHaveLength(1)
  expect(findVersion(doc.id, listVersions(doc.id)[0].id)?.snapshot).toBe('BBBB')

  addVersion(doc.id, user, 'CCCC', '되돌림')
  expect(listVersions(doc.id)).toHaveLength(2)
  expect(listVersions(doc.id)[0].label).toBe('되돌림')

  purgeDoc(doc.id)
})

it('영구 삭제는 버전·댓글까지 같이 지운다', () => {
  const doc = createDoc(user, 'f-1', '영구 삭제 시험')
  addVersion(doc.id, user, 'c25hcHNob3Q=')
  addComment(doc.id, user, '댓글 하나', null)
  expect(listVersions(doc.id)).toHaveLength(1)
  expect(listComments(doc.id)).toHaveLength(1)

  purgeDoc(doc.id)
  expect(findDoc(doc.id)).toBeUndefined()
  expect(listVersions(doc.id)).toHaveLength(0)
  expect(listComments(doc.id)).toHaveLength(0)
})

it('댓글의 block_id 를 저장했다가 그대로 돌려준다', () => {
  const doc = createDoc(user, 'f-1', '블록 댓글 시험')
  addComment(doc.id, user, '이 문단 확인', 'blk-1')
  addComment(doc.id, user, '문서 전체', null)
  expect(listComments(doc.id).map((c) => c.block_id)).toEqual(['blk-1', null])
  purgeDoc(doc.id)
})

it('댓글은 쓴 사람만 지운다', () => {
  const other = MOCK_USERS.find((u) => u.id === 'u-1')!
  const doc = createDoc(user, 'f-1', '댓글 삭제 시험')
  const mine = addComment(doc.id, user, '지울 댓글', null)
  const kept = addComment(doc.id, user, '남길 댓글', 'blk-1')

  expect(removeComment(doc.id, other, mine.id)).toBe('forbidden')
  expect(listComments(doc.id)).toHaveLength(2)

  expect(removeComment(doc.id, user, mine.id)).toBe('ok')
  expect(listComments(doc.id).map((c) => c.id)).toEqual([kept.id])
  // 이미 지운 댓글과 다른 문서의 댓글은 없는 것이다.
  expect(removeComment(doc.id, user, mine.id)).toBe('not_found')
  expect(removeComment('d-2', user, kept.id)).toBe('not_found')
  purgeDoc(doc.id)
})

it('휴지통은 지운 지 최근 순이고 살아 있는 목록과 겹치지 않는다', () => {
  const older = createDoc(user, 'f-1', '먼저 지운 문서')
  const newer = createDoc(user, 'f-1', '나중에 지운 문서')
  trashDoc(older, user)
  trashDoc(newer, user)
  // 한 테스트 안에서는 같은 밀리초에 지워질 수 있다. 서버는 그때 id 로 가른다.
  newer.deleted_at = new Date(Date.parse(older.deleted_at!) + 1000).toISOString()

  expect(
    listTrash(200)
      .map((d) => d.id)
      .slice(0, 2),
  ).toEqual([newer.id, older.id])
  expect(listDocs('').map((d) => d.id)).not.toContain(older.id)

  untrashDoc(older, user)
  expect(listTrash(200).map((d) => d.id)).not.toContain(older.id)
  expect(listDocs('').map((d) => d.id)).toContain(older.id)

  purgeDoc(older.id)
  purgeDoc(newer.id)
})

it('지운 시각이 같으면 id 로 가른다 (서버의 두 번째 정렬 기준)', () => {
  const a = createDoc(user, 'f-1', '동시각 A')
  const b = createDoc(user, 'f-1', '동시각 B')
  trashDoc(a, user)
  trashDoc(b, user)
  // 문서 id 는 무작위(uuid)라 만든 순서와 사전순이 다르다. 비교 대상을 확정해 둔다.
  a.id = 'd-same-1'
  b.id = 'd-same-2'
  b.deleted_at = a.deleted_at

  expect(
    listTrash(200)
      .map((d) => d.id)
      .slice(0, 2),
  ).toEqual(['d-same-1', 'd-same-2'])

  purgeDoc(a.id)
  purgeDoc(b.id)
})

it('휴지통 목록은 limit 을 지킨다', () => {
  const docs = [1, 2, 3].map((n) => createDoc(user, 'f-1', `상한 시험 ${n}`))
  for (const doc of docs) trashDoc(doc, user)
  expect(listTrash(2)).toHaveLength(2)
  for (const doc of docs) purgeDoc(doc.id)
})

it('댓글은 쓴 사람만 고친다. 글이 그대로면 고친 것으로 치지 않는다', () => {
  const doc = createDoc(user, 'f-1', '댓글 고치기 시험')
  const other = MOCK_USERS.find((u) => u.id !== user.id)!
  const comment = addComment(doc.id, user, '처음 쓴 글', 'b-1')

  expect(editComment(doc.id, other, comment.id, '남이 고친 글')).toBe('forbidden')
  expect(editComment(doc.id, user, 'c-없는-댓글', '글')).toBe('not_found')

  // 그대로 저장하면 「수정됨」이 붙지 않는다.
  expect(editComment(doc.id, user, comment.id, '처음 쓴 글')).toMatchObject({ body: '처음 쓴 글' })
  expect(listComments(doc.id)[0].edited_at ?? null).toBeNull()

  const edited = editComment(doc.id, user, comment.id, '고친 글')
  expect(edited).toMatchObject({ id: comment.id, body: '고친 글', block_id: 'b-1' })
  expect(listComments(doc.id)[0].edited_at).toEqual(expect.any(String))
})

it('폴더는 비어 있을 때만 지워진다. 휴지통에 든 문서도 그 폴더의 것이다', () => {
  const folder = createFolder({ title: '지울 폴더' })
  const child = createFolder({ title: '안쪽 폴더', parent_id: folder.id })
  const doc = createDoc(user, folder.id, '폴더 안 문서')

  // 하위 폴더와 문서가 있으면 못 지운다.
  expect(removeFolder(folder)).toBe('not_empty')
  expect(removeFolder(child)).toBeNull()
  expect(removeFolder(folder)).toBe('not_empty')

  // 문서를 휴지통에 보내면 트리에서는 비어 보이지만, 되살릴 자리가 이 폴더라 아직 못 지운다.
  trashDoc(doc, user)
  expect(docTree().docs.some((d) => d.folder_id === folder.id)).toBe(false)
  expect(removeFolder(folder)).toBe('has_trashed')

  // 영구 삭제까지 하면 지워진다.
  purgeDoc(doc.id)
  expect(removeFolder(folder)).toBeNull()
  expect(docTree().folders.some((f) => f.id === folder.id)).toBe(false)
})
