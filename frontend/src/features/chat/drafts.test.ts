import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { clearDrafts, getDraft, setDraft, useHasDraft } from './drafts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('쓰다 만 채팅 글', () => {
  it('방마다 따로 남고, 공백만 남기면 지운다', () => {
    setDraft('a', '안녕')
    setDraft('b', '회의')
    expect(getDraft('a')).toBe('안녕')
    expect(getDraft('b')).toBe('회의')

    setDraft('a', '  \n')
    expect(getDraft('a')).toBe('')
    clearDrafts()
    expect(getDraft('b')).toBe('')
  })

  it('연필 표시는 글이 생기고 없어질 때만 다시 그린다', () => {
    let renders = 0
    let shown: boolean | undefined
    function Mark() {
      renders++
      shown = useHasDraft('c')
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Mark)))
    expect(shown).toBe(false)

    act(() => setDraft('c', '가'))
    expect(shown).toBe(true)
    const after = renders
    act(() => setDraft('c', '가나다'))
    expect(renders).toBe(after)

    act(() => clearDrafts())
    expect(shown).toBe(false)
    act(() => root.unmount())
  })
})
