/**
 * 뻗은 표의 오른쪽 끝과 문서 영역 끝 사이에 남기는 틈.
 * 행 옆 표 버튼(TableRowMenu: 버튼 46px + 틈 6px + 여유 4px)이 표를 덮지 않고 들어갈 자리다.
 */
const GUTTER = 56

/**
 * 본문 상자(글이 놓이는 가운데 열)에 `ref` 로 건다. 표가 본문보다 넓을 때 오른쪽 여백으로 얼마나 뻗을
 * 수 있는지를 재서 CSS 변수로 내려 준다. 그리는 것은 index.css 의 tableWrapper 규칙이다.
 *
 * - `--table-col`: 본문 폭(px). 너비 없는 열이 남은 표가 채우는 폭.
 * - `--table-bleed`: 본문 오른쪽 끝에서 문서 영역(본문 상자를 감싼 스크롤 영역) 끝까지, 틈을 뺀 폭.
 *
 * 표는 본문보다 넓어지면 이만큼까지는 스크롤 없이 오른쪽 여백으로 뻗고(노션과 같다), 그보다 넓어지면
 * 그때부터 표만 가로로 구른다. 변수가 없으면(값 0) 본문 폭 안에서 구른다.
 *
 * CSS 만으로는 못 구한다. 본문 폭은 문서마다 다르고(보통·넓게·꽉 차게) 가운데 정렬이라 남는 여백이
 * 화면 폭에 달렸다. 컨테이너 쿼리로는 구해지지만, 스크롤 영역을 컨테이너로 만들면 그 안에 떠 있는
 * 것들(글 선택 막대, 블록 손잡이)의 기준 상자가 바뀐다.
 */
export function tableBleedRef(column: HTMLElement | null) {
  const area = column?.parentElement
  if (!column || !area) return

  const measure = () => {
    const style = getComputedStyle(column)
    const padLeft = Number.parseFloat(style.paddingLeft)
    const padRight = Number.parseFloat(style.paddingRight)
    const box = column.getBoundingClientRect()
    // clientWidth 로 잰다. 세로 스크롤바가 차지한 폭은 문서 영역이 아니다.
    const areaRight = area.getBoundingClientRect().left + area.clientWidth
    const bleed = Math.max(0, areaRight - (box.right - padRight) - GUTTER)
    column.style.setProperty('--table-col', `${box.width - padLeft - padRight}px`)
    column.style.setProperty('--table-bleed', `${bleed}px`)
  }

  measure()
  // 창 크기, 옆 패널 여닫기, 본문 폭 단계가 바뀌면 다시 잰다.
  const observer = new ResizeObserver(measure)
  observer.observe(area)
  observer.observe(column)
  return () => observer.disconnect()
}
