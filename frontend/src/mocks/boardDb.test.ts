import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import { canEdit, createPost, deletePost, findPost, listPosts, updatePost } from './boardDb'

const member = MOCK_USERS.find((u) => u.id === 'u-2')!
const other = MOCK_USERS.find((u) => u.id === 'u-1')!
const exec = MOCK_USERS.find((u) => u.role === 'exec')!
// 모듈 전역 배열을 공유하고 리셋이 없다. 케이스를 더할 때는 각자 새로 쓴 글로 한다.

it('수정·삭제는 글쓴이 본인과 임원만, 사람 아닌 이름으로 올라간 글은 임원만', () => {
  const mine = findPost(createPost(member, 'all', { title: '내 글', body: '본문' }).id)!
  expect(canEdit(member, mine)).toBe(true)
  expect(canEdit(other, mine)).toBe(false)
  // 임원은 남의 글도 건드린다. 백엔드 `_can_edit` 과 같은 판정이다.
  expect(canEdit(exec, mine)).toBe(true)

  // 씨앗의 '경영지원팀' 글은 글쓴이 id 가 없다. 아무도 본인이 될 수 없으니 임원만 남는다.
  const byTeam = findPost('p-1')!
  expect(byTeam.authorId).toBeNull()
  expect(canEdit(member, byTeam)).toBe(false)
  expect(canEdit(exec, byTeam)).toBe(true)

  deletePost(mine.id)
})

it('수정은 보낸 값만 바꾸고, 삭제하면 목록에서도 사라진다', () => {
  const created = createPost(member, 'all', { title: '고칠 글', body: '처음 본문' })
  const stored = findPost(created.id)!

  expect(updatePost(stored, { title: '고친 제목' })).toMatchObject({
    title: '고친 제목',
    body: '처음 본문',
  })
  expect(updatePost(stored, { body: '고친 본문' }).title).toBe('고친 제목')

  expect(listPosts(member, 'all').some((p) => p.id === created.id)).toBe(true)
  deletePost(created.id)
  expect(findPost(created.id)).toBeUndefined()
  expect(listPosts(member, 'all').some((p) => p.id === created.id)).toBe(false)
})
