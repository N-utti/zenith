import { expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { rejected, topFolders } from './scope'

it('topFolders 는 부모가 없는 폴더만 남긴다. 트리가 아직 없으면 빈 목록', () => {
  const folder = (id: string, parent_id: string | null) => ({ id, parent_id, title: id, sort: 0 })
  const tree = { folders: [folder('a', null), folder('b', 'a'), folder('c', null)], docs: [] }
  expect(topFolders(tree).map((f) => f.id)).toEqual(['a', 'c'])
  expect(topFolders(undefined)).toEqual([])
})

it('rejected 는 사유가 문자열인 422 만 폴더 거절로 본다', () => {
  const body = { detail: '없는 폴더입니다.', code: 'VALIDATION' }
  expect(rejected(new ApiError(422, '없는 폴더입니다.', body))).toBe(true)
  // 스키마 검증 실패는 사유가 배열이다. 폴더와 무관하니 범위를 버리면 안 된다.
  const schema = { detail: [{ loc: ['body', 'message'], msg: 'too long' }], code: 'VALIDATION' }
  expect(rejected(new ApiError(422, '', schema))).toBe(false)
  expect(rejected(new ApiError(429, '요청이 많습니다.'))).toBe(false)
  expect(rejected(new Error('연결 실패'))).toBe(false)
})
