import type { JSONContent } from '@tiptap/core'
import type { ExportImage } from './exportContent'

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const t = (text: string, ...marks: NonNullable<JSONContent['marks']>): JSONContent => ({
  type: 'text',
  text,
  marks,
})
const cell = (text: string, attrs: object = {}, type = 'tableCell'): JSONContent => ({
  type,
  attrs,
  content: [p(t(text))],
})

/** 1x1 PNG. 크기는 바깥에서 잰 값을 준다. */
export const PIXEL: ExportImage = {
  bytes: Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  ),
  ext: 'png',
  width: 1200,
  height: 600,
}

/** 편집기가 만드는 블록을 한 번씩 다 넣은 문서. 변환기 테스트가 같이 쓰고, 실제 워드로 여는 확인도 이 문서로 했다. */
export const SAMPLE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('1. 개요')] },
    p(
      t('굵게', { type: 'bold' }),
      t(' 기울임', { type: 'italic' }),
      t(' 밑줄', { type: 'underline' }),
      t(' 취소선', { type: 'strike' }),
      t(' code<&>', { type: 'code' }),
      t(' 빨강', { type: 'textStyle', attrs: { color: '#e0483d' } }),
      t(' 형광', { type: 'highlight', attrs: { color: '#fef08a' } }),
      { type: 'hardBreak' },
      t('링크', { type: 'link', attrs: { href: 'https://example.com/a b' } }),
      t(' 위험한 링크', { type: 'link', attrs: { href: 'javascript:alert(1)' } }),
    ),
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('가운데')] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            p(t('글머리')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [{ type: 'listItem', content: [p(t('셋부터'))] }],
            },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(t('끝낸 일'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(t('남은 일'))] },
      ],
    },
    { type: 'blockquote', content: [p(t('인용'))] },
    { type: 'codeBlock', content: [t('const a = 1\n\tconst b = 2')] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            cell('항목', { colwidth: [200] }, 'tableHeader'),
            cell('값', { colspan: 2 }, 'tableHeader'),
          ],
        },
        { type: 'tableRow', content: [cell('세로', { rowspan: 2 }), cell('가'), cell('나')] },
        { type: 'tableRow', content: [cell('다'), cell('라')] },
      ],
    },
    { type: 'imageBlock', attrs: { src: '/api/files/f1', alt: '도면' }, content: [t('사진 설명')] },
    { type: 'imageBlock', attrs: { src: '/api/files/gone' } },
    p(
      { type: 'fileChip', attrs: { src: '/api/files/f2', name: '견적서.xlsx', size: 10 } },
      { type: 'fileChip', attrs: { src: 'javascript:alert(1)', name: '가짜', size: 1 } },
    ),
  ],
}
