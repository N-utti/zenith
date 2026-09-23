// `npm run build` 뒤에 돌린다: 방금 만든 .msi 와 서명(.msi.sig)으로 업데이트 매니페스트를 만든다.
// 사용: npm run manifest -- https://zenith.사내도메인
// 결과: src-tauri/target/release/bundle/msi/latest.json → .msi 와 함께 서버의 /desktop/ 에 올린다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const origin = process.argv[2]?.replace(/\/+$/, '')
if (!origin?.startsWith('https://')) {
  console.error('서버 주소를 https:// 로 주세요. 예: npm run manifest -- https://zenith.example.co.kr')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const dir = 'src-tauri/target/release/bundle/msi'
const msi = readdirSync(dir).find((f) => f.endsWith('.msi') && f.includes(`_${version}_`))
if (!msi) {
  console.error(`${dir} 에 ${version} 버전 .msi 가 없습니다. npm run build 를 먼저.`)
  process.exit(1)
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(join(dir, `${msi}.sig`), 'utf8'),
      url: `${origin}/desktop/${encodeURIComponent(msi)}`,
    },
  },
}
writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2))
console.log(`${join(dir, 'latest.json')} ← ${msi}`)
