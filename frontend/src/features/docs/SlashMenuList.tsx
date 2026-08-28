import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { cn } from '@/lib/cn'
import type { EditorBlock } from './editorBlocks'

export type SlashListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean }

/** `/` 를 치면 뜨는 블록 목록. 키보드만으로 끝까지 고를 수 있어야 한다. */
export const SlashMenuList = forwardRef<
  SlashListHandle,
  SuggestionProps<EditorBlock, EditorBlock>
>(function SlashMenuList({ items, command }, ref) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // 질의가 바뀌면 목록이 통째로 갈리므로 선택도 처음으로 되돌린다.
  useEffect(() => setIndex(0), [items])

  // 화살표로 보이는 영역 밖까지 내려가면 스크롤이 따라와야 한다.
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false

      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[index])
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="border-line bg-surface text-subtle rounded-xl border px-3 py-2 text-sm shadow-lg">
        맞는 블록이 없습니다
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="블록 삽입"
      className="border-line bg-surface max-h-72 w-64 overflow-y-auto rounded-xl border p-1 shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(item)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
            i === index ? 'bg-surface-hover' : 'bg-transparent',
          )}
        >
          <span className="border-line text-muted grid size-8 shrink-0 place-items-center rounded-lg border">
            <item.icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="text-fg block truncate text-sm font-medium">{item.label}</span>
            <span className="text-subtle block truncate text-xs">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
})
