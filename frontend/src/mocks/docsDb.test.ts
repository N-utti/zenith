import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  addComment,
  addVersion,
  createDoc,
  docTree,
  findDoc,
  findVersion,
  listComments,
  listDocs,
  listVersions,
  purgeDoc,
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
  addComment(doc.id, user, '댓글 하나')
  expect(listVersions(doc.id)).toHaveLength(1)
  expect(listComments(doc.id)).toHaveLength(1)

  purgeDoc(doc.id)
  expect(findDoc(doc.id)).toBeUndefined()
  expect(listVersions(doc.id)).toHaveLength(0)
  expect(listComments(doc.id)).toHaveLength(0)
})
