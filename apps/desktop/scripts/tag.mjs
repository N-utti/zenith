// 새 버전을 서버에 올린 뒤에 돌린다: version 을 올린 커밋에 desktop-v{버전} 태그를 달고,
// 앞 버전 뒤로 들어온 프론트·앱 변경 목록을 GitHub 릴리스에 적는다. main 하나만 쓰므로 이것이 버전 기록이다.
// 사용: npm run tag   (무엇이 적힐지만 보려면 npm run tag -- --dry)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const conf = 'src-tauri/tauri.conf.json'
const { version } = JSON.parse(readFileSync(conf, 'utf8'))
const tag = `desktop-v${version}`
git('fetch', '--tags', '--quiet')

// 태그는 지금 커밋이 아니라 version 을 이 값으로 바꾼 커밋에 단다. 며칠 뒤에 누가 돌려도 같은 자리에 달린다.
const bump = git('log', '-1', '--format=%H', `-G"version": "${version}"`, '--', conf)
// 스쿼시 머지 전의 브랜치 커밋에 달면 그 태그는 main 에서 거슬러 올라가도 안 나온다. 다음 버전이 앞 버전을 못 찾는다.
try {
  git('merge-base', '--is-ancestor', bump, 'origin/main')
} catch {
  console.error(`version 을 올린 PR(${version})을 머지하고 main 을 당겨 온 뒤에 돌리세요.`)
  process.exit(1)
}

// 그 커밋에서 거슬러 올라가 처음 만나는 데스크톱 태그가 앞 버전이다.
const prev = git('describe', '--tags', '--abbrev=0', '--match', 'desktop-v*', bump)
if (prev === tag) {
  console.error(`${tag} 는 이미 있습니다. tauri.conf.json 의 version 을 올린 뒤에 돌리세요.`)
  process.exit(1)
}

// 설치본에 실리는 것은 웹앱과 셸뿐이다. 백엔드 변경은 서버 배포를 따라가므로 뺀다.
const notes = git('log', '--format=- %s', `${prev}..${bump}`, '--', ':/frontend', ':/apps')
console.log(`${tag} (${prev} 다음, ${bump.slice(0, 7)})\n${notes}`)
if (process.argv.includes('--dry')) process.exit(0)

execFileSync(
  'gh',
  ['release', 'create', tag, '--target', bump, '--title', `데스크톱 v${version}`, '--notes-file', '-'],
  { input: notes, stdio: ['pipe', 'inherit', 'inherit'] },
)
