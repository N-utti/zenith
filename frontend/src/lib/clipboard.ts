/**
 * 글자를 클립보드에 넣는다. 실패하면 던진다.
 *
 * `navigator.clipboard` 는 보안 컨텍스트(https·localhost) 전용이라 사내망 평문 주소
 * (`http://<LAN IP>:5180`, infra/README)로 열면 없다. 사무실 PC 가 그 주소로 들어오므로, 그때는
 * 숨긴 입력 칸을 골라 옛 방식(`execCommand`)으로 복사한다.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)

  const focused = document.activeElement
  const area = document.createElement('textarea')
  area.value = text
  // 화면이 움직이거나 깜빡이지 않게 자리만 잡고 안 보이게 둔다.
  area.style.position = 'fixed'
  area.style.opacity = '0'
  area.setAttribute('readonly', '')
  document.body.append(area)
  // `select()` 만으로는 초점이 오지 않는 브라우저가 있고, 초점 없는 선택은 복사되지 않는다.
  area.focus()
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  // 고르느라 옮겨 간 초점을 누른 버튼으로 돌려놓는다.
  if (focused instanceof HTMLElement) focused.focus()
  if (!copied) throw new Error('copy failed')
}
