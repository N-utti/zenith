import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  addPostComment,
  canEdit,
  createPost,
  deletePost,
  editPostComment,
  findPost,
  listPostComments,
  listPosts,
  removePostComment,
  updatePost,
} from './boardDb'

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

  // 씨앗의 '경영지원팀' 글은 어느 데모 계정과도 id 가 맞지 않는다. 임원만 남는다.
  const byTeam = findPost('p-1')!
  expect(byTeam.author?.id).toBe('team-hr')
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

it('댓글은 쓴 사람만 고치고, 지우기는 쓴 사람과 임원이 한다. 글을 지우면 댓글도 사라진다', () => {
  const post = createPost(member, 'all', { title: '댓글 시험', body: '본문' })
  const comment = addPostComment(post.id, member, '처음 쓴 댓글')
  expect(listPostComments(post.id).map((c) => c.body)).toEqual(['처음 쓴 댓글'])

  // 고치기는 임원도 남의 것은 못 한다.
  expect(editPostComment(post.id, other, comment.id, '남이 고침')).toBe('forbidden')
  expect(editPostComment(post.id, exec, comment.id, '임원이 고침')).toBe('forbidden')
  expect(editPostComment(post.id, member, 'pc-없음', '글')).toBe('not_found')

  // 그대로 저장하면 「수정됨」이 붙지 않는다.
  expect(editPostComment(post.id, member, comment.id, '처음 쓴 댓글')).toMatchObject({
    edited_at: null,
  })
  expect(editPostComment(post.id, member, comment.id, '고친 댓글')).toMatchObject({
    body: '고친 댓글',
    edited_at: expect.any(String),
  })

  // 지우기는 남은 못 하고 임원은 한다.
  expect(removePostComment(post.id, other, comment.id)).toBe('forbidden')
  expect(removePostComment(post.id, exec, comment.id)).toBe('ok')
  expect(listPostComments(post.id)).toEqual([])
  expect(removePostComment(post.id, exec, comment.id)).toBe('not_found')

  addPostComment(post.id, other, '글과 같이 사라질 댓글')
  deletePost(post.id)
  expect(listPostComments(post.id)).toEqual([])
})
