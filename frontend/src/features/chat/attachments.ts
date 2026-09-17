/**
 * 메시지에 붙은 파일을 미리 보여 줄지.
 *
 * **이름의 확장자로 고른다.** 서버는 저장된 content-type 으로 `inline` 여부를 정하는데
 * 응답에 그 값이 없어 화면이 알 수가 없다(`AttachmentOut` 에 없다). 그래서 판정이 갈릴 수
 * 있고, 갈리면 그림이 깨진다. 화면은 그때 파일 링크로 떨어뜨린다.
 *
 * 갈려도 위험하지는 않다. 서버가 png·jpeg·gif·webp 만 `inline` 으로 주고 나머지는
 * `attachment` + `nosniff` 라, 이름만 `.png` 인 HTML 을 브라우저가 실행하지 않는다.
 * SVG 는 같은 오리진에서 스크립트가 돌 수 있어 서버도 내려받기로만 준다.
 */
export function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name)
}
