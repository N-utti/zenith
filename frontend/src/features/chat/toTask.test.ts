import { describe, expect, it } from 'vitest'
import { taskDraftFrom } from './toTask'
import type { ChatMessage } from './types'

const message = (over: Partial<ChatMessage>) =>
  ({
    id: 'm-1',
    channel_id: 'c-1',
    author: { id: 'u-4', name: '장지윤' },
    body: '',
    created_at: '2026-11-25T02:30:00Z',
    ...over,
  }) as ChatMessage

describe('메시지로 만드는 업무 초안', () => {
  it('제목은 첫 줄, 메모는 누가 언제 한 말인지와 글 전체', () => {
    const draft = taskDraftFrom(message({ body: '\n견적서 내일까지 부탁해요\n단가표 참고' }))
    expect(draft.title).toBe('견적서 내일까지 부탁해요')
    expect(draft.note.split('\n')[0]).toMatch(/^장지윤 · /)
    expect(draft.note).toContain('견적서 내일까지 부탁해요\n단가표 참고')
  })

  it('글 없이 파일만 보냈으면 첫 파일 이름이 제목', () => {
    const draft = taskDraftFrom(
      message({ attachments: [{ url: '/f/1', name: '단가표.xlsx', size: 10 }] }),
    )
    expect(draft.title).toBe('단가표.xlsx')
  })

  it('긴 글은 서버 상한에서 자른다', () => {
    const draft = taskDraftFrom(message({ body: '가'.repeat(5000) }))
    expect(draft.title.length).toBe(120)
    expect(draft.note.length).toBe(2000)
  })
})
