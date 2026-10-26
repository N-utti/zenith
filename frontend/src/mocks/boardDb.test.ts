import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import {
  addPostComment,
  canDownloadPostAttachment,
  canEdit,
  canPin,
  checkPostAttachments,
  createPost,
  deletePost,
  editPostComment,
  findPost,
  listPostComments,
  listPosts,
  postAttachmentPrefix,
  recordPostAttachment,
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

it('첨부는 그 게시판에 올린 파일만 붙는다. 안 보내면 그대로 두고 빈 목록은 전부 뗀다', () => {
  recordPostAttachment('all', 'a-1', member.id)
  recordPostAttachment('exec', 'a-2', exec.id)
  const mine = { url: `${postAttachmentPrefix('all')}a-1/a.pdf`, name: 'a.pdf', size: 10 }

  expect(checkPostAttachments('all', undefined, member)).toBeNull()
  expect(checkPostAttachments('all', [mine], member)).toBeNull()
  // 임원 게시판에 올린 파일 id 를 전체 공지 경로에 끼워 넣거나, 그 url 을 그대로 붙이면 막힌다.
  // 뒤에 경로를 더 붙여 다른 곳을 가리키게 한 url 도 막힌다.
  for (const url of [
    `${postAttachmentPrefix('all')}a-2/a.pdf`,
    `${postAttachmentPrefix('exec')}a-2/a.pdf`,
    `${mine.url}/../../../exec/attachments/a-2/a.pdf`,
    `${mine.url}?x=1#y`,
    '/api/files/f-1',
  ]) {
    expect(checkPostAttachments('all', [{ ...mine, url }], member)).not.toBeNull()
  }
  // 칩에 보일 이름을 url 의 이름과 다르게 보내면 막힌다.
  expect(checkPostAttachments('all', [{ ...mine, name: '공지.pdf' }], member)).not.toBeNull()
  expect(checkPostAttachments('all', null, member)).not.toBeNull()
  expect(checkPostAttachments('all', [null], member)).not.toBeNull()
  expect(checkPostAttachments('all', Array(11).fill(mine), member)).not.toBeNull()

  // 남이 올린 파일을 새로 싣지 못한다(임원도). 이미 실려 있던 것은 그대로 둘 수 있다.
  expect(checkPostAttachments('all', [mine], other)).toBe('직접 올린 첨부만 붙일 수 있습니다.')
  expect(checkPostAttachments('all', [mine], exec)).toBe('직접 올린 첨부만 붙일 수 있습니다.')
  expect(checkPostAttachments('all', [mine], exec, [mine])).toBeNull()

  const post = createPost(member, 'all', { title: '첨부 글', body: '본문', attachments: [mine] })
  expect(post.attachments).toEqual([mine])
  const stored = findPost(post.id)!
  expect(updatePost(stored, { title: '제목만 고침' }).attachments).toEqual([mine])
  expect(updatePost(stored, { attachments: [] }).attachments).toEqual([])
  deletePost(post.id)
})

it('첨부는 살아 있는 글이 싣고 있을 때만 받는다', () => {
  recordPostAttachment('all', 'a-3', member.id)
  const url = `${postAttachmentPrefix('all')}a-3/b.pdf`
  const file = { url, name: 'b.pdf', size: 10 }

  // 올리기만 한 파일은 올린 사람도 못 받는다(글쓰기 창은 다시 받지 않는다).
  expect(canDownloadPostAttachment('all', url)).toBe(false)

  const post = createPost(member, 'all', { title: '받을 글', body: '본문', attachments: [file] })
  expect(canDownloadPostAttachment('all', url)).toBe(true)
  // 다른 게시판 경로에 같은 파일 id 를 끼워 넣으면 못 받는다.
  expect(canDownloadPostAttachment('exec', url.replace('/all/', '/exec/'))).toBe(false)

  // 글에서 떼면 남은 못 받는다. 다시 붙였다가 글을 지워도 같다.
  const stored = findPost(post.id)!
  updatePost(stored, { attachments: [] })
  expect(canDownloadPostAttachment('all', url)).toBe(false)
  updatePost(stored, { attachments: [file] })
  expect(canDownloadPostAttachment('all', url)).toBe(true)
  deletePost(post.id)
  expect(canDownloadPostAttachment('all', url)).toBe(false)
})

it('권한 밖 고정 글도 고정 표시를 단 채 맨 위에 온다. 백엔드와 같다', () => {
  // 고정 안 된 더 새 글이 있어도 오래된 고정 글(p-4)이 위다.
  const newer = createPost(exec, 'lead', { title: '새 글', body: '본문' })
  const [first, second] = listPosts(member, 'lead')
  expect(first).toMatchObject({ id: 'p-4', masked: true, pinned: true })
  expect(second.id).toBe(newer.id)
  deletePost(newer.id)
})

it('고정은 글쓴이라도 임원만', () => {
  const mine = findPost(createPost(member, 'all', { title: '내 글', body: '본문' }).id)!
  expect(canEdit(member, mine)).toBe(true)
  expect(canPin(member)).toBe(false)
  expect(canPin(exec)).toBe(true)
  deletePost(mine.id)
})
