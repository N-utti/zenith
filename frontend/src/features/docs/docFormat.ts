import { Extension, getStyleProperty } from '@tiptap/core'
import { Fragment, Slice, type Attrs, type Node as PmNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize } from '@tiptap/extension-text-style'

/**
 * 문서 서식 값(글꼴·크기·색·줄 간격·간격)을 거르는 곳. 편집기 화면과 내보내기가 같이 쓴다.
 *
 * 붙여넣은 HTML 과 남의 편집(Y.Doc, 서버 가져오기 포함)은 속성을 거르지 않고 싣는다. 그 값을 그대로
 * `style` 에 쓰면 `red;background-image:url(https://바깥/…)` 같은 값으로 문서를 여는 사람마다 바깥으로
 * 요청이 나간다(데스크톱 앱은 막지 않는다). 그래서 읽을 때와 그릴 때 둘 다 거른다.
 * 속성 이름·단위는 이슈 #574(서식 3차 계약)를 따른다.
 */

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i
// 글꼴 이름: 글자·숫자·빈칸·따옴표·쉼표·밑줄·하이픈만. 괄호·쌍점·세미콜론·빗금이 없으면 url() 도 선언 끊기도 못 한다.
const SAFE_FONT_FAMILY = /^[\p{L}\p{N} ,'"_-]{1,100}$/u
const SAFE_FONT_SIZE = /^\d{1,3}(\.\d{1,2})?(pt|px)$/

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const safeColor = (value: unknown) => {
  const v = str(value)
  return SAFE_COLOR.test(v) ? v : null
}
export const safeFontFamily = (value: unknown) => {
  const v = str(value)
  // 짝이 안 맞는 따옴표는 같은 style 의 뒤 선언(글자 크기 등)을 문자열로 삼켜 버린다.
  const even = (q: string) => v.split(q).length % 2 === 1
  return SAFE_FONT_FAMILY.test(v) && even('"') && even("'") ? v : null
}
const ALIGNS = ['left', 'center', 'right', 'justify']
/** 문단·칸 정렬. 원래 확장은 Y.Doc 값을 거르지 않고 style 에 써서, 다른 서식과 같은 구멍이 된다. */
export const safeAlign = (value: unknown) => (ALIGNS.includes(str(value)) ? str(value) : null)
/** 글자 크기. 0 은 글을 숨기고 너무 큰 값은 화면을 덮는다. 1~400 만 받는다. */
export const safeFontSize = (value: unknown) => {
  const v = str(value)
  const n = parseFloat(v)
  return SAFE_FONT_SIZE.test(v) && n >= 1 && n <= 400 ? v : null
}
/** 줄 간격 배수. 계약은 단위 없는 문자열(`"1.6"`)이다. 0.5~5 밖은 버린다. */
export const safeLineHeight = (value: unknown) => {
  const n = Number(typeof value === 'number' ? value : str(value) || NaN)
  return n >= 0.5 && n <= 5 ? String(n) : null
}
/** 들여쓰기·문단 간격 px 정수. 0~2000 밖은 버린다. */
export const safePx = (value: unknown) => {
  const n = typeof value === 'number' ? value : /^\d+$/.test(str(value)) ? Number(str(value)) : NaN
  return Number.isInteger(n) && n >= 0 && n <= 2000 ? n : null
}
/** style 의 `12px` 값을 px 정수로. 다른 단위(pt·em·%)는 크기가 달라지므로 버린다. */
const pxOf = (css: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(css?.trim() ?? '')
  return m ? safePx(Math.round(Number(m[1]))) : null
}

/** textStyle 마크의 한 속성을 거르는 판으로 바꾼다. 명령(setColor 등)은 원래 확장 것을 그대로 쓴다. */
function safeTextStyleAttr(name: string, css: string, safe: (v: unknown) => string | null) {
  return {
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            [name]: {
              default: null,
              // 원래 확장처럼 style 의 원래 표기를 먼저 읽는다(`el.style` 은 rgb()·큰따옴표로 바꾼다).
              parseHTML: (el: HTMLElement) =>
                safe(getStyleProperty(el, css) ?? el.style.getPropertyValue(css)),
              renderHTML: (attrs: Record<string, unknown>) => {
                const v = safe(attrs[name])
                return v ? { style: `${css}: ${v}` } : {}
              },
            },
          },
        },
      ]
    },
  }
}

export const SafeColor = Color.extend(safeTextStyleAttr('color', 'color', safeColor))
export const SafeFontFamily = FontFamily.extend(
  safeTextStyleAttr('fontFamily', 'font-family', safeFontFamily),
)
export const SafeFontSize = FontSize.extend(
  safeTextStyleAttr('fontSize', 'font-size', safeFontSize),
)

export const SafeTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => safeAlign(el.style.textAlign),
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeAlign(attrs.textAlign)
              return v ? { style: `text-align: ${v}` } : {}
            },
          },
        },
      },
    ]
  },
})

/** 붙여넣기로는 받지 않는 서식 속성. 이 PR 의 새 서식만이다(글자색·형광펜·정렬은 예전처럼 받는다). */
const OUTSIDE_ATTRS = [
  'lineHeight',
  'indent',
  'spaceBefore',
  'spaceAfter',
  'backgroundColor',
  'borders',
  'fontFamily',
  'fontSize',
]

/** 조각 안의 노드·textStyle 마크에서 위 속성을 비운다. 다 빈 textStyle 마크는 뗀다. */
function clearOutsideAttrs(fragment: Fragment): Fragment {
  const clear = (attrs: Attrs) =>
    OUTSIDE_ATTRS.some((key) => attrs[key] != null)
      ? Object.fromEntries(
          Object.entries(attrs).map(([k, v]) => [k, OUTSIDE_ATTRS.includes(k) ? null : v]),
        )
      : attrs
  const nodes: PmNode[] = []
  fragment.forEach((node) => {
    const marks = node.marks.flatMap((mark) => {
      if (mark.type.name !== 'textStyle') return [mark]
      const attrs = clear(mark.attrs)
      return Object.values(attrs).every((v) => v == null) ? [] : [mark.type.create(attrs)]
    })
    nodes.push(
      node.isText
        ? node.mark(marks)
        : node.type.create(clear(node.attrs), clearOutsideAttrs(node.content), marks),
    )
  })
  return Fragment.from(nodes)
}

/**
 * 제니스 밖(웹·구글 문서·워드·엑셀)에서 붙여넣은 글의 간격·줄 간격·글꼴·크기·칸 배경·표 테두리를 비운다.
 * 웹 페이지는 계산된 `margin-top: 0`·`font-size: 14px` 를 인라인으로 싣는다. 그대로 받으면 붙여넣은
 * 문단이 앞 블록에 붙고, 그 값이 Enter 로 다음 문단까지 번진다(문단 속성은 나눌 때 물려준다).
 * 붙여넣기는 이 서식들이 생기기 전처럼 두고, 서식은 파일 가져오기(서버가 Y.Doc 에 바로 싣는다)로만 받는다.
 *
 * HTML 을 고치지 않고 읽은 뒤의 조각에서 비운다. HTML 의 style 을 지우면 묶음 속성(font)이 굵게·기울임까지
 * 지우고, 엑셀·워드가 싣는 `<style>` 은 HTML 단계 뒤에 요소마다 다시 써 넣어져 지운 값이 되살아난다.
 * 바깥인지는 HTML 단계에서 본다. 제니스에서 복사한 것은 ProseMirror 가 `data-pm-slice` 를 붙인다.
 */
function outsidePastePlugin() {
  let outside = false
  return new Plugin({
    props: {
      transformPastedHTML: (html) => {
        outside = !html.includes('data-pm-slice')
        return html
      },
      transformPasted: (slice) => {
        const strip = outside
        outside = false
        return strip
          ? new Slice(clearOutsideAttrs(slice.content), slice.openStart, slice.openEnd)
          : slice
      },
    },
  })
}

/**
 * 문단·제목의 줄 간격(배수)·왼쪽 들여쓰기·앞뒤 간격(px). 목록 항목 안의 들여쓰기는 목록이 맡는다.
 * 앞 간격이 있으면 본문의 블록 사이 기본 간격(index.css 의 mt-4)보다 인라인 값이 이긴다.
 */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addProseMirrorPlugins() {
    return [outsidePastePlugin()]
  },
  addGlobalAttributes() {
    const px = (name: string, css: 'margin-left' | 'margin-top' | 'margin-bottom') => ({
      [name]: {
        default: null,
        parseHTML: (el: HTMLElement) => pxOf(el.style.getPropertyValue(css)),
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = safePx(attrs[name])
          return v === null ? {} : { style: `${css}: ${v}px` }
        },
      },
    })
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            // 단위 없는 배수만 받는다. px·% 로 적힌 줄 간격은 글자 크기에 따라 배수가 달라 버린다.
            parseHTML: (el: HTMLElement) => {
              const v = el.style.lineHeight
              return /^\d+(\.\d+)?$/.test(v) ? safeLineHeight(v) : null
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeLineHeight(attrs.lineHeight)
              return v ? { style: `line-height: ${v}` } : {}
            },
          },
          ...px('indent', 'margin-left'),
          ...px('spaceBefore', 'margin-top'),
          ...px('spaceAfter', 'margin-bottom'),
        },
      },
    ]
  },
})
