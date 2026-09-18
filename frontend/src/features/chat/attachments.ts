/**
 * 메시지에 붙은 파일을 미리 보여 줄지.
 *
 * **이름의 확장자로 고른다.** 형식(`content_type`)은 2026-09-18 부터 응답에 오지만
 * 판정에 쓰지 않는다 — 서버가 URL 과 대조하는 것은 파일 이름뿐이고 형식은 **보낸 쪽 값**
 * 이다. 형식으로 갈아타면 `.html` 에 `image/png` 를 붙여 인라인 표시를 유도할 수 있다.
 *
 * 확장자 판정은 서버가 `inline` 으로 내주는 목록과 이미 같은 집합이라, 갈리는 경우는
 * 서버가 안 그려 주는 쪽뿐이다. 그때 화면은 파일 링크로 떨어뜨린다.
 *
 * 갈려도 위험하지는 않다. 서버가 png·jpeg·gif·webp 만 `inline` 으로 주고 나머지는
 * `attachment` + `nosniff` 라, 이름만 `.png` 인 HTML 을 브라우저가 실행하지 않는다.
 * SVG 는 같은 오리진에서 스크립트가 돌 수 있어 서버도 내려받기로만 준다.
 */
export function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name)
}
