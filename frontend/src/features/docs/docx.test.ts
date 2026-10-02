import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { buildDocx } from './docx'
import { columnWidths, exportFileStem, layoutTable, safeHref } from './exportContent'
import { PIXEL, SAMPLE } from './exportFixture'

function build() {
  const zip = unzipSync(
    buildDocx({
      title: '주간 <보고>',
      doc: SAMPLE,
      images: new Map([['/api/files/f1', PIXEL]]),
      origin: 'https://zenith.test',
    }),
  )
  return Object.fromEntries(
    Object.entries(zip).map(([name, bytes]) => [
      name,
      name.endsWith('.png') ? '' : strFromU8(bytes),
    ]),
  )
}

it('XML 이 전부 문법에 맞는다', () => {
  for (const [name, xml] of Object.entries(build())) {
    if (!xml) continue
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    expect(parsed.querySelector('parsererror'), name).toBeNull()
  }
})

it('제목·서식·정렬을 옮긴다', () => {
  const xml = build()['word/document.xml']
  expect(xml).toContain(
    '<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">주간 &lt;보고&gt;',
  )
  expect(xml).toContain('<w:pStyle w:val="Heading1"/>')
  expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">굵게</w:t>')
  expect(xml).toContain('<w:color w:val="E0483D"/>')
  expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="FEF08A"/>')
  expect(xml).toContain('code&lt;&amp;&gt;')
  expect(xml).toContain('<w:jc w:val="center"/>')
  // 코드 블록의 줄바꿈과 탭은 요소로 나간다.
  expect(xml).toContain('const a = 1</w:t><w:br/><w:tab/><w:t xml:space="preserve">const b = 2')
})

it('링크는 http·메일·전화만 건다', () => {
  const files = build()
  const rels = files['word/_rels/document.xml.rels']
  expect(rels).toContain('Target="https://example.com/a%20b" TargetMode="External"')
  expect(rels).not.toContain('javascript')
  // 걸러진 링크도 글자는 남는다.
  expect(files['word/document.xml']).toContain(' 위험한 링크')
  // 파일 칩은 서버의 그 파일로 건다. 올린 파일 주소가 아니면 이름만 남긴다.
  expect(rels).toContain('Target="https://zenith.test/api/files/f2"')
  expect(files['word/document.xml']).toContain('[첨부] 가짜')
})

it('번호 목록은 목록마다 시작 번호를 갖고, 안쪽 목록은 한 단계 더 들여 쓴다', () => {
  const files = build()
  expect(files['word/numbering.xml']).toContain(
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="3"/>',
  )
  expect(files['word/document.xml']).toContain(
    '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr><w:ind w:left="720" w:hanging="360"/>',
  )
  expect(files['word/document.xml']).toContain('☑</w:t><w:tab/>')
})

it('합친 칸: 가로는 gridSpan, 세로는 아래 행에 이어짐 칸을 채운다', () => {
  const { rows, columns } = layoutTable(SAMPLE.content![8])
  expect(columns.map((column) => column.width)).toEqual([200, null, null])
  expect(rows[2].map(({ node, col }) => [node === null, col])).toEqual([
    [true, 0],
    [false, 1],
    [false, 2],
  ])
  const xml = build()['word/document.xml']
  expect(xml).toContain('<w:gridSpan w:val="2"/>')
  expect(xml).toContain('<w:vMerge w:val="restart"/>')
  expect(xml).toContain('<w:vMerge/></w:tcPr><w:p/></w:tc>')
  // 너비가 적힌 열(200px)은 그대로, 나머지 둘이 남은 본문 폭을 나눠 갖는다.
  expect(xml).toContain(
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3013"/><w:gridCol w:w="3013"/></w:tblGrid>',
  )
})

it('너비가 안 적힌 열은 글이 긴 쪽이 더 넓게 갖는다(길이의 제곱근 비율)', () => {
  const widths = columnWidths(
    [
      { width: null, text: 36 },
      { width: null, text: 4 },
    ],
    100,
  )
  expect(widths).toEqual([75, 25])
})

it('끝의 빈 문단은 싣지 않는다', () => {
  const empty = { type: 'paragraph' }
  const zip = unzipSync(
    buildDocx({
      title: '제목',
      doc: { type: 'doc', content: [empty, { type: 'horizontalRule' }, empty, empty] },
      images: new Map(),
      origin: '',
    }),
  )
  // 제목, 가운데 낀 빈 문단, 구분선. 끝의 둘은 빠진다.
  expect(strFromU8(zip['word/document.xml']).match(/<w:p>/g)).toHaveLength(3)
})

it('받아 온 사진은 파일에 담고, 못 받은 사진은 안내 글로 남긴다', () => {
  const files = build()
  expect(Object.keys(files)).toContain('word/media/image1.png')
  expect(files['word/_rels/document.xml.rels']).toContain('Target="media/image1.png"')
  // 1200px 은 본문 폭(9026twip = 601.7px)에 맞춰 줄고 비율은 지킨다.
  expect(files['word/document.xml']).toContain('<wp:extent cx="5731510" cy="2865755"/>')
  expect(files['word/document.xml']).toContain('[사진을 불러오지 못했습니다]')
})

it('파일 이름에서 Windows 가 못 쓰는 글자를 바꾼다', () => {
  expect(exportFileStem('3/4분기: 계획?')).toBe('3_4분기_ 계획_')
  expect(exportFileStem(' . ')).toBe('문서')
})

it('남의 편집에서 온 비정상 속성도 워드가 여는 파일로 만든다', () => {
  const table = (colwidth: unknown) => ({
    type: 'table',
    content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colwidth } }] }],
  })
  const zip = unzipSync(
    buildDocx({
      title: '제목',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { textAlign: 'constructor' } },
          { type: 'heading', attrs: { level: 2.5 } },
          { type: 'orderedList', attrs: { start: 1.5 }, content: [{ type: 'listItem' }] },
          table([Infinity]),
          table(null),
        ],
      },
      images: new Map(),
      origin: '',
    }),
  )
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).not.toMatch(/NaN|Infinity|function|w:jc/)
  expect(xml).toContain('<w:pStyle w:val="Heading2"/>')
  expect(strFromU8(zip['word/numbering.xml'])).toContain('<w:startOverride w:val="1"/>')
  // 맞닿은 표 사이에는 빈 문단이 낀다. 없으면 워드가 한 표로 붙인다.
  expect(xml).toContain('</w:tbl><w:p/><w:tbl>')
})

it('메일·전화 링크는 공백이나 따옴표가 들면 걸지 않는다', () => {
  expect(safeHref('tel:010-1234-5678')).toBe('tel:010-1234-5678')
  expect(safeHref('tel:010 1234 5678')).toBeNull()
  expect(safeHref('mailto:a"b@c.kr')).toBeNull()
})
