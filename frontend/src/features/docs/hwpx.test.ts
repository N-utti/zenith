import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { PIXEL, SAMPLE } from './exportFixture'
import { buildHwpx } from './hwpx'

const bytes = buildHwpx({
  title: '주간 <보고>',
  doc: SAMPLE,
  images: new Map([['/api/files/f1', PIXEL]]),
  origin: 'https://zenith.test',
})
const zip = unzipSync(bytes)
const header = strFromU8(zip['Contents/header.xml'])
const section = strFromU8(zip['Contents/section0.xml'])
const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0

it('mimetype 이 첫 항목이고 압축하지 않는다', () => {
  // zip 의 첫 지역 헤더: 8~9 번째 바이트가 압축 방식(0 = 무압축), 30 번째부터 이름.
  expect(bytes[8] | (bytes[9] << 8)).toBe(0)
  expect(strFromU8(bytes.slice(30, 38))).toBe('mimetype')
  expect(strFromU8(zip.mimetype)).toBe('application/hwp+zip')
})

it('XML 이 전부 문법에 맞는다', () => {
  for (const [name, part] of Object.entries(zip)) {
    if (!/\.(xml|hpf|rdf)$/.test(name)) continue
    const parsed = new DOMParser().parseFromString(strFromU8(part), 'application/xml')
    expect(parsed.querySelector('parsererror'), name).toBeNull()
  }
})

it('본문이 가리키는 글자·문단 모양이 header 에 전부 있고 개수 표시가 맞다', () => {
  const chars = count(header, /<hh:charPr /g)
  const paras = count(header, /<hh:paraPr /g)
  expect(header).toContain(`<hh:charProperties itemCnt="${chars}">`)
  expect(header).toContain(`<hh:paraProperties itemCnt="${paras}">`)
  expect(header).toContain(`<hh:borderFills itemCnt="${count(header, /<hh:borderFill /g)}">`)
  for (const [, ref] of section.matchAll(/charPrIDRef="(\d+)"/g)) {
    expect(Number(ref)).toBeLessThan(chars)
  }
  for (const [, ref] of section.matchAll(/paraPrIDRef="(\d+)"/g)) {
    expect(Number(ref)).toBeLessThan(paras)
  }
})

it('쪽 설정이 첫 문단 첫 run 에 들고 제목이 그 뒤에 온다', () => {
  expect(section).toMatch(
    /<hs:sec [^>]+><hp:p id="0" [^>]+><hp:run charPrIDRef="0"><hp:secPr .+?<\/hp:ctrl><\/hp:run><hp:run charPrIDRef="\d+"><hp:t>주간 &lt;보고&gt;<\/hp:t>/,
  )
})

it('글자 서식과 줄바꿈·탭을 옮긴다', () => {
  expect(header).toContain('textColor="#E0483D"')
  expect(header).toContain('shadeColor="#FEF08A"')
  expect(header).toContain('<hh:italic/>')
  expect(header).toContain('<hh:strikeout shape="SOLID"')
  // 줄바꿈과 탭은 글 요소 안에 든다. 밖에 두면 한글이 버린다.
  expect(section).toContain('<hp:t>const a = 1<hp:lineBreak/><hp:tab/>const b = 2</hp:t>')
  expect(section).toContain('code&lt;&amp;&gt;')
})

it('여백은 옛 판이 읽는 갈래에 두 배로 적는다', () => {
  // 인용문: 한 단계(24px = 1800) 들여 쓴다.
  expect(header).toMatch(
    /<hp:case [^>]+><hh:margin><hc:intent value="0" unit="HWPUNIT"\/><hc:left value="1800"(?:(?!<\/hh:paraPr>)[^])+?<hp:default><hh:margin><hc:intent value="0" unit="HWPUNIT"\/><hc:left value="3600"/,
  )
})

it('목록은 문단 모양의 기호 정의로 그리고, 번호 목록은 시작 번호를 따로 갖는다', () => {
  expect(header).toContain('<hh:heading type="BULLET" idRef="1" level="0"/>')
  expect(header).toContain('<hh:heading type="NUMBER" idRef="2" level="0"/>')
  expect(header).toContain('<hh:numbering id="2" start="3"><hh:paraHead start="3" level="1"')
  expect(header).toContain('<hh:numberings itemCnt="2">')
  expect(section).toContain('<hp:t>☑ </hp:t>')
})

it('합친 칸: 덮인 자리에는 칸을 만들지 않고 합친 칸이 넓이를 말한다', () => {
  expect(section).toContain('rowCnt="3" colCnt="3"')
  expect(count(section, /<hp:tc /g)).toBe(7)
  expect(section).toContain(
    '<hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/>',
  )
  expect(section).toContain(
    '<hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="2"/>',
  )
  // 너비가 적힌 열(200px = 15000)은 그대로, 합친 머리 칸은 나머지 두 열의 합.
  expect(section).toContain('<hp:cellSz width="15000" height="282"/>')
  expect(section).toMatch(/<hp:cellSz width="331[89]\d" height="282"\/>/)
})

it('링크는 Command 에 주소를 감싸 적고, 걸러진 링크는 글자만 남긴다', () => {
  expect(section).toContain(
    '<hp:stringParam name="Command">https\\://example.com/a%20b;1;0;0;</hp:stringParam>',
  )
  expect(section).toContain('https\\://zenith.test/api/files/f2;1;0;0;')
  expect(section).not.toContain('javascript')
  expect(section).toContain(' 위험한 링크')
  expect(count(section, /<hp:fieldBegin /g)).toBe(count(section, /<hp:fieldEnd /g))
})

it('받아 온 사진은 파일에 담고, 못 받은 사진은 안내 글로 남긴다', () => {
  expect(Object.keys(zip)).toContain('BinData/image1.png')
  expect(strFromU8(zip['Contents/content.hpf'])).toContain(
    '<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>',
  )
  // 1200px 은 본문 폭(48190)에 맞춰 줄고 비율은 지킨다.
  expect(section).toContain('<hp:curSz width="48190" height="24095"/>')
  expect(section).toContain('<hc:img binaryItemIDRef="image1"')
  expect(section).toContain('[사진을 불러오지 못했습니다]')
})

it('빠지면 한글이 문서를 열지 않는 요소와 한글 고유의 철자를 지킨다', () => {
  expect(strFromU8(zip['version.xml'])).toContain('tagetApplication="WORDPROCESSOR"')
  expect(header).toContain('<hh:trackchageConfig flags="56"/>')
  for (const required of [
    '<hp:startNum ',
    '<hp:visibility ',
    '<hp:offset x="0" y="0"/>',
    '<hp:renderingInfo><hc:transMatrix ',
    '<hc:scaMatrix ',
    '<hc:rotMatrix ',
    '<hp:cellMargin ',
  ]) {
    expect(section.includes(required), required).toBe(true)
  }
  // 표는 글자처럼 취급하지 않아야 쪽에서 나뉜다.
  expect(section).toMatch(/<hp:tbl [^>]+><hp:sz [^>]+><hp:pos treatAsChar="0"/)
  // 링크의 끝 표시는 있는 시작 표시를 가리킨다.
  const begins = new Set([...section.matchAll(/<hp:fieldBegin id="(\d+)"/g)].map(([, id]) => id))
  for (const [, ref] of section.matchAll(/beginIDRef="(\d+)"/g)) expect(begins.has(ref)).toBe(true)
  // 문단·표·사진·링크에 준 번호는 겹치지 않는다.
  const ids = [...section.matchAll(/<hp:(?:p|tbl|pic|fieldBegin) id="(\d+)"/g)].map(([, id]) => id)
  expect(new Set(ids).size).toBe(ids.length)
})

it('틀어진 표와 비정상 값으로도 빈자리·겹침 없는 격자를 만든다', () => {
  const cell = (attrs: object = {}) => ({ type: 'tableCell', attrs })
  const link = { type: 'link', attrs: { href: 'https://a.kr/x|y?q=1;2#z' } }
  const odd = unzipSync(
    buildHwpx({
      title: '제목',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              // 둘째 행의 가로 합침이 위에서 내려온 세로 합침 자리를 덮고, 셋째 행은 한 칸이 모자란다.
              { type: 'tableRow', content: [cell({ colwidth: [1e308] }), cell({ rowspan: 2 })] },
              { type: 'tableRow', content: [cell({ colspan: 2 })] },
              { type: 'tableRow', content: [cell()] },
            ],
          },
          { type: 'orderedList', attrs: { start: 1.5 }, content: [{ type: 'listItem' }] },
          { type: 'orderedList', content: [{ type: 'listItem' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '줄\r\n바꿈', marks: [link] }] },
        ],
      },
      images: new Map(),
      origin: '',
    }),
  )
  const xml = strFromU8(odd['Contents/section0.xml'])
  const covered: string[] = []
  const cells = xml.matchAll(
    /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/><hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"/g,
  )
  for (const [, col, row, colSpan, rowSpan] of cells) {
    for (let r = 0; r < Number(rowSpan); r += 1) {
      for (let c = 0; c < Number(colSpan); c += 1)
        covered.push(`${Number(row) + r},${Number(col) + c}`)
    }
  }
  // 3행 2열의 여섯 자리가 한 번씩만 덮인다.
  expect(covered.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1'])
  expect(xml.includes('rowCnt="3" colCnt="2"')).toBe(true)
  expect(/NaN|Infinity|width="0"/.test(xml)).toBe(false)
  // 주소의 | 는 %7C 로 바꾸고 : ? ; # 는 감싼다. 복귀 글자는 줄바꿈으로 모은다.
  expect(xml.includes('https\\://a.kr/x%7Cy\\?q=1\\;2\\#z;1;0;0;')).toBe(true)
  expect(xml.includes('줄<hp:lineBreak/>바꿈')).toBe(true)
  // 번호 목록 둘은 번호 정의도 둘이고(개요 번호까지 셋), 소수 시작 번호는 정수가 된다.
  const head = strFromU8(odd['Contents/header.xml'])
  expect(head.includes('<hh:numberings itemCnt="3">')).toBe(true)
  expect(head.includes('<hh:numbering id="2" start="1">')).toBe(true)
})
