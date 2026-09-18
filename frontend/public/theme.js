// FOUC 방지: React 마운트 전에 테마를 확정한다.
//
// `<head>` 에서 defer 없이 부르므로 body 가 그려지기 전에 실행된다 — 인라인일 때와 같다.
// 인라인으로 두지 않는 이유는 CSP 다. 운영(`infra/caddy/Caddyfile`)은 `script-src 'self'` 에
// 인라인 해시를 하나 달아 두는데, 이 파일의 바이트가 한 글자만 달라져도(줄바꿈 포함) 스크립트가
// 막히고 **깜빡임이 아니라 다크모드가 통째로 사라진다**(lib/theme.ts 가 DOM 클래스만 읽는다).
// 데스크톱(`apps/desktop/src-tauri/tauri.conf.json`)은 아예 해시가 없어 인라인이면 늘 막힌다.
;(() => {
  const saved = localStorage.getItem('zenith.theme')
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
})()
