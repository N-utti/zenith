/**
 * 사외 시연판에서 실제 직원 이름·메일을 가상 인물로 바꾸는 대응표.
 *
 * 목 데이터(users.json·src/mocks)는 실제 팀 명단으로 짜여 있다. 개발 모드는 그대로 두고,
 * 시연 빌드(`VITE_DEMO=true`)의 번들과 시연 서버(scripts/demo.js)의 채팅 명단에서만 바꾼다.
 * 목 데이터에 사람을 새로 넣으면 여기에도 한 줄 넣는다. 빠지면 시연판에 실명이 나간다.
 */
export const DEMO_PEOPLE = [
  ['진수연', 'suyeon', '이서연', 'seoyeon'],
  ['정성운', 'sungwoon', '박민준', 'minjun'],
  ['홍성완', 'sungwan', '조현우', 'hyunwoo'],
  ['장지윤', 'jiyun', '최지우', 'jiwoo'],
  ['안재호', 'jaeho', '강도현', 'dohyun'],
  ['김다인', 'dain', '윤하은', 'haeun'],
  ['김혜리', 'hyeri', '임수아', 'sua'],
  ['성예림', 'yerim', '한유나', 'yuna'],
  ['오유경', 'yukyung', '송지민', 'jimin'],
  ['신영훈', 'younghoon', '권태호', 'taeho'],
  ['신준희', 'junhee', '배정훈', 'junghoon'],
  ['김철성', 'chulsung', '서동욱', 'dongwook'],
  ['김창업', 'changup', '문상철', 'sangcheol'],
]

/**
 * 시연 빌드에 남은 실명을 찾는다. 성을 뗀 이름은 「수연님」처럼 부른 꼴만 본다(「창업」 같은 낱말과 안 겹치게).
 * 대응표에 없는 사람이 명단(users.json)에 있으면 그 이름도 낸다.
 */
export function findLeaks(text, roster) {
  const known = new Set(DEMO_PEOPLE.map(([name]) => name))
  const leaks = roster.map((u) => u.name).filter((name) => !known.has(name))
  for (const [name, mail] of DEMO_PEOPLE) {
    for (const token of [name, `${name.slice(1)}님`, `${mail}@`]) {
      if (text.includes(token)) leaks.push(token)
    }
  }
  return leaks
}

/** 이름은 성까지 붙은 세 글자로만, 메일은 주소 전체로만 바꾼다. 두 글자 이름만 쓴 곳은 못 잡는다(findLeaks 가 잡는다). */
export function swapNames(text) {
  let out = text
  for (const [name, mail, fakeName, fakeMail] of DEMO_PEOPLE) {
    out = out
      .replaceAll(name, fakeName)
      .replaceAll(`${mail}@zenith.co.kr`, `${fakeMail}@zenith.co.kr`)
  }
  return out
}
