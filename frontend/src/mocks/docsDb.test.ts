import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  addComment,
  addVersion,
  createDoc,
  docTree,
  findDoc,
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
