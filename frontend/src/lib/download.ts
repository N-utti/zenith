/**
 * 문자열을 파일로 내려받게 한다. 리포트 CSV 처럼 서버가 준 본문을 저장할 때.
 * BOM(U+FEFF)을 앞에 붙인다. 엑셀이 BOM 없는 UTF-8 CSV 의 한글을 깨뜨린다.
 * 이스케이프로 적는다. 보이지 않는 문자를 그대로 두면 편집기·도구가 조용히 지운다.
 * ponytail: 데스크톱 셸(Tauri)에서 a[download] 가 안 먹으면 그때 셸의 저장 대화상자로 옮긴다.
 */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 클릭이 다운로드를 시작하기 전에 URL 을 거두면 일부 브라우저가 중단한다. 한 틱 미룬다.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
